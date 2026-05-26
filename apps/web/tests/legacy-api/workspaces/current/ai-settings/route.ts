import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import {
  createHeadlessWorkspacesClient,
  headlessWorkspacesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import {
  WORKSPACE_AGENT_GUIDANCE_MAX_LENGTH,
  buildWorkspaceAiSettingsPatch,
  canUseWorkspaceAgents,
  readWorkspaceAiSettings,
  serializeWorkspaceAiSettings,
} from "@/lib/workspace-ai-settings";
import { asRecord, isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type CurrentWorkspaceRecord = {
  id: string;
  settings: unknown;
  role: string;
};

async function findCurrentWorkspace(userId: string) {
  const activeWorkspaceId = await resolveActiveWorkspaceId(userId);
  if (!activeWorkspaceId) {
    return null;
  }

  const [currentWorkspace] = await db
    .select({
      id: workspace.id,
      settings: workspace.settings,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, userId),
        eq(member.workspaceId, activeWorkspaceId),
      ),
    )
    .limit(1);

  return (currentWorkspace as CurrentWorkspaceRecord | undefined) ?? null;
}

function buildResponse(currentWorkspace: CurrentWorkspaceRecord) {
  const aiSettings = readWorkspaceAiSettings(currentWorkspace.settings);

  return {
    aiSettings,
    capabilities: {
      canManageAiSettings: isWorkspaceAdminRole(currentWorkspace.role),
      canUseAgents: canUseWorkspaceAgents(currentWorkspace.role, aiSettings),
    },
    limits: {
      workspaceAgentGuidanceMaxLength: WORKSPACE_AGENT_GUIDANCE_MAX_LENGTH,
    },
  };
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  if (headlessWorkspacesEnabled()) {
    const workspaceId = await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.GET(
        "/workspaces/current/ai-settings",
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const currentWorkspace = await findCurrentWorkspace(session.user.id);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  return NextResponse.json(buildResponse(currentWorkspace));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  if (headlessWorkspacesEnabled()) {
    const workspaceId = await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const body = await request.json().catch(() => null);
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.PATCH(
        "/workspaces/current/ai-settings",
        { body: body as never },
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const currentWorkspace = await findCurrentWorkspace(session.user.id);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (!isWorkspaceAdminRole(currentWorkspace.role)) {
    return NextResponse.json(
      { error: "You do not have permission to manage workspace AI settings" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    aiSettings?: unknown;
  } | null;
  if (!body || !isPlainObject(body.aiSettings)) {
    return NextResponse.json(
      { error: "aiSettings is required" },
      { status: 400 },
    );
  }

  if (
    body.aiSettings.workspaceAgentGuidance !== undefined &&
    typeof body.aiSettings.workspaceAgentGuidance !== "string"
  ) {
    return NextResponse.json(
      { error: "Workspace agent guidance must be text" },
      { status: 400 },
    );
  }

  if (
    typeof body.aiSettings.workspaceAgentGuidance === "string" &&
    body.aiSettings.workspaceAgentGuidance.length >
      WORKSPACE_AGENT_GUIDANCE_MAX_LENGTH
  ) {
    return NextResponse.json(
      {
        error: `Workspace agent guidance must be ${WORKSPACE_AGENT_GUIDANCE_MAX_LENGTH} characters or fewer`,
      },
      { status: 400 },
    );
  }

  const currentAiSettings = readWorkspaceAiSettings(currentWorkspace.settings);
  const nextAiSettings = buildWorkspaceAiSettingsPatch(
    currentAiSettings,
    body.aiSettings,
  );
  const settings = {
    ...asRecord(currentWorkspace.settings),
    ai: serializeWorkspaceAiSettings(nextAiSettings),
  };

  await db
    .update(workspace)
    .set({ settings, updatedAt: new Date() })
    .where(eq(workspace.id, currentWorkspace.id));

  return NextResponse.json(buildResponse({ ...currentWorkspace, settings }));
}
