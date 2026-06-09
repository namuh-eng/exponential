import { randomBytes } from "node:crypto";
import { requireApiSession } from "@/lib/api-auth";
import { getConfiguredAppUrl } from "@/lib/app-url";
import { getGoogleOAuthConfig } from "@/lib/auth-providers";
import {
  GOOGLE_SHEETS_SCOPES,
  hasEnabledGoogleSheetsScope,
  normalizeGoogleSheetsSettings,
  serializeGoogleSheetsIntegration,
  upsertGoogleSheetsIntegration,
} from "@/lib/google-sheets-sync";
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

  const settings = normalizeGoogleSheetsSettings(
    await request.json().catch(() => ({})),
  );
  if (!hasEnabledGoogleSheetsScope(settings)) {
    return NextResponse.json(
      { error: "Select at least one Google Sheets export scope." },
      { status: 400 },
    );
  }

  const google = getGoogleOAuthConfig();
  if (!google) {
    const { metadata } = await upsertGoogleSheetsIntegration(
      access,
      session.user.id,
      settings,
      "development",
    );
    return NextResponse.json({
      integration: serializeGoogleSheetsIntegration(
        {
          id: "google_sheets",
          provider: "google_sheets",
          status: "connected",
          displayName: metadata.spreadsheetTitle,
          externalId: metadata.spreadsheetId,
          connectedAt: new Date(),
          metadata,
        },
        access,
      ),
    });
  }

  const nonce = randomBytes(18).toString("base64url");
  const state = Buffer.from(
    JSON.stringify({ nonce, workspaceSlug: access.workspaceSlug, settings }),
  ).toString("base64url");
  const redirectUri = `${getConfiguredAppUrl()}/api/integrations/google-sheets/oauth/callback`;
  const authorizationUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  authorizationUrl.searchParams.set("client_id", google.clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", GOOGLE_SHEETS_SCOPES.join(" "));
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("state", state);

  return NextResponse.json({
    authorizationUrl: authorizationUrl.toString(),
    state,
    workspaceSlug: access.workspaceSlug,
  });
}
