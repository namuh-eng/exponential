import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import {
  type AgentSuggestionStatus,
  updateAgentSuggestion,
} from "@/lib/agent-runs";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import {
  canUseWorkspaceAgents,
  readWorkspaceAiSettings,
} from "@/lib/workspace-ai-settings";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const suggestionStatuses = new Set(["accepted", "declined"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const [access] = await db
    .select({ settings: workspace.settings, role: member.role })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, session.user.id),
      ),
    )
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const aiSettings = readWorkspaceAiSettings(access?.settings);
  if (!canUseWorkspaceAgents(access?.role, aiSettings)) {
    return NextResponse.json(
      {
        error: aiSettings.aiFeaturesEnabled
          ? "You do not have permission to review agent actions in this workspace"
          : "Workspace AI and agent features are disabled",
      },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const suggestionId =
    typeof body.suggestionId === "string" ? body.suggestionId : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!suggestionId || !suggestionStatuses.has(status)) {
    return NextResponse.json(
      { error: "Invalid suggestion action" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const run = updateAgentSuggestion(
    workspaceId,
    id,
    suggestionId,
    status as AgentSuggestionStatus,
    {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
    },
  );

  if (!run) {
    return NextResponse.json({ error: "Agent run not found" }, { status: 404 });
  }

  return NextResponse.json({ run });
}
