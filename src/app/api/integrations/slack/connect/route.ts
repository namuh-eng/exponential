import { randomBytes } from "node:crypto";
import { requireApiSession } from "@/lib/api-auth";
import { getConfiguredAppUrl } from "@/lib/app-url";
import { getSlackOAuthConfig } from "@/lib/auth-providers";
import {
  canManageIntegrations,
  getWorkspaceAccess,
} from "@/lib/workspace-integrations";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await getWorkspaceAccess(session, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }
  if (!canManageIntegrations(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const slack = getSlackOAuthConfig();
  if (!slack) {
    return NextResponse.json(
      {
        error: "Slack OAuth is not configured",
        message:
          "Add AUTH_SLACK_ID and AUTH_SLACK_SECRET to enable Slack installation for this workspace.",
      },
      { status: 412 },
    );
  }

  const state = randomBytes(18).toString("base64url");
  const redirectUri = `${getConfiguredAppUrl()}/api/integrations/slack/oauth/callback`;
  const authorizationUrl = new URL("https://slack.com/oauth/v2/authorize");
  authorizationUrl.searchParams.set("client_id", slack.clientId);
  authorizationUrl.searchParams.set(
    "scope",
    "channels:read,chat:write,commands",
  );
  authorizationUrl.searchParams.set("user_scope", "");
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);

  return NextResponse.json({
    authorizationUrl: authorizationUrl.toString(),
    state,
    workspaceSlug: access.workspaceSlug,
  });
}
