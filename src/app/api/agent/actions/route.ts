import {
  getAgentActionsProviderState,
  parseExternalAgentAction,
  providerMissingState,
} from "@/lib/agent-actions";
import { resolveEffectiveAgentGuidance } from "@/lib/agent-guidance";
import { createExternalAgentRun } from "@/lib/agent-runs";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { workspace, workspaceIntegration } from "@/lib/db/schema";
import { resolveIntegrationActorUserId } from "@/lib/integration-attribution";
import { findAccessibleTeam } from "@/lib/teams";
import {
  canUseWorkspaceAgents,
  readWorkspaceAiSettings,
} from "@/lib/workspace-ai-settings";
import { getWorkspaceAccess } from "@/lib/workspace-integrations";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function disabledResponse(
  state: ReturnType<typeof getAgentActionsProviderState>,
  status = 409,
) {
  return NextResponse.json(state, { status });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const access = await getWorkspaceAccess(session, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseExternalAgentAction(body);
  if ("status" in parsed) {
    return NextResponse.json(parsed, { status: 400 });
  }

  const providerState = getAgentActionsProviderState();
  if (providerState.status === "disabled") {
    return disabledResponse(providerState);
  }

  const [workspaceRecord] = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, access.workspaceId))
    .limit(1);
  const aiSettings = readWorkspaceAiSettings(workspaceRecord?.settings);
  if (!canUseWorkspaceAgents(access.role, aiSettings)) {
    return NextResponse.json(
      {
        status: "disabled",
        code: aiSettings.aiFeaturesEnabled
          ? "permission_denied"
          : "workspace_ai_disabled",
        message: aiSettings.aiFeaturesEnabled
          ? "This actor cannot create agent actions in the workspace."
          : "Workspace AI and agent features are disabled.",
      },
      { status: 403 },
    );
  }

  const [integration] = await db
    .select({
      id: workspaceIntegration.id,
      status: workspaceIntegration.status,
    })
    .from(workspaceIntegration)
    .where(
      and(
        eq(workspaceIntegration.workspaceId, access.workspaceId),
        eq(workspaceIntegration.provider, parsed.source.provider),
      ),
    )
    .limit(1);
  if (!integration || integration.status !== "connected") {
    return disabledResponse(providerMissingState(parsed.source.provider));
  }

  let resolvedTeamKey = parsed.teamKey;
  if (parsed.teamKey) {
    const teamRecord = await findAccessibleTeam(
      parsed.teamKey,
      session.user.id,
      {
        request,
      },
    );
    if (!teamRecord) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    resolvedTeamKey = teamRecord.key;
  }

  const mappedUserId = await resolveIntegrationActorUserId({
    provider: parsed.source.provider,
    externalAccountId: parsed.actor.externalUserId,
  });
  const guidance = await resolveEffectiveAgentGuidance({
    workspaceId: access.workspaceId,
    userId: mappedUserId ?? session.user.id,
    teamKey: resolvedTeamKey,
  });

  const run = createExternalAgentRun(access.workspaceId, {
    ...parsed,
    teamKey: resolvedTeamKey,
    actor: {
      ...parsed.actor,
      mappedUserId,
    },
    guidance,
  });

  return NextResponse.json(
    {
      status: run.status,
      run,
      action: {
        type: parsed.actionType,
        provider: parsed.source.provider,
        source: run.source,
        actor: run.actor,
        reviewGate: run.reviewGate,
      },
    },
    { status: 201 },
  );
}
