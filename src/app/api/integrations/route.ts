import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import {
  allowLocalSlackInstall,
  isSlackOAuthConfigured,
  readWorkspaceIntegrations,
} from "@/lib/integration-settings";
import { isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const CATALOG = [
  {
    provider: "github",
    name: "GitHub",
    description: "Sync pull requests, commits, and issue links with Linear.",
  },
  {
    provider: "slack",
    name: "Slack",
    description: "Send issue updates and create issues from Slack messages.",
  },
  {
    provider: "zendesk",
    name: "Zendesk",
    description:
      "Connect support tickets to product work and customer requests.",
  },
] as const;

async function getWorkspaceAccess(
  userId: string,
  workspaceIdOverride?: string,
) {
  const workspaceId =
    workspaceIdOverride ?? (await resolveActiveWorkspaceId(userId));
  if (!workspaceId) return null;

  const [row] = await db
    .select({
      workspaceId: workspace.id,
      workspaceSlug: workspace.urlSlug,
      settings: workspace.settings,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.workspaceId, workspaceId),
        eq(member.userId, userId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await getWorkspaceAccess(
    session.user.id,
    "apiKey" in session ? session.apiKey.workspaceId : undefined,
  );
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  const integrations = readWorkspaceIntegrations(access.settings);
  const canManageIntegrations = isWorkspaceAdminRole(access.role);

  return NextResponse.json({
    workspaceSlug: access.workspaceSlug,
    canManageIntegrations,
    slackOAuthConfigured: isSlackOAuthConfigured(),
    allowLocalSlackInstall: allowLocalSlackInstall(),
    integrations: CATALOG.map((entry) => ({
      ...entry,
      state: integrations[entry.provider],
    })),
  });
}
