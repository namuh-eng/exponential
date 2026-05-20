import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import {
  allowLocalSlackInstall,
  createLocalSlackIntegration,
  disconnectedSlackIntegration,
  isSlackOAuthConfigured,
  readWorkspaceIntegrations,
  withWorkspaceIntegrationSettings,
} from "@/lib/integration-settings";
import { isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

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

function slackAuthorizationUrl() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI;
  if (!clientId || !redirectUri) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "chat:write,commands,channels:read,groups:read",
    user_scope: "",
    redirect_uri: redirectUri,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function POST(request: Request) {
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
  if (!isWorkspaceAdminRole(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    localInstall?: boolean;
  };
  const integrations = readWorkspaceIntegrations(access.settings);

  if (body.localInstall) {
    if (!allowLocalSlackInstall()) {
      return NextResponse.json(
        { error: "Local Slack installation is unavailable in production." },
        { status: 403 },
      );
    }
    const nextIntegrations = createLocalSlackIntegration(integrations);
    await db
      .update(workspace)
      .set({
        settings: withWorkspaceIntegrationSettings(
          access.settings,
          nextIntegrations,
        ),
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, access.workspaceId));
    return NextResponse.json({ integration: nextIntegrations.slack });
  }

  if (!isSlackOAuthConfigured()) {
    return NextResponse.json(
      {
        code: "SLACK_CONFIGURATION_REQUIRED",
        error:
          "Slack OAuth credentials are not configured. Add SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_REDIRECT_URI to enable the install flow.",
        allowLocalSlackInstall: allowLocalSlackInstall(),
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ authorizationUrl: slackAuthorizationUrl() });
}

export async function DELETE() {
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
  if (!isWorkspaceAdminRole(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nextIntegrations = disconnectedSlackIntegration(
    readWorkspaceIntegrations(access.settings),
  );
  await db
    .update(workspace)
    .set({
      settings: withWorkspaceIntegrationSettings(
        access.settings,
        nextIntegrations,
      ),
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, access.workspaceId));

  return NextResponse.json({ integration: nextIntegrations.slack });
}
