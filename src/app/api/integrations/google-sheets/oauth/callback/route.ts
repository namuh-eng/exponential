import { requireApiSession } from "@/lib/api-auth";
import { getConfiguredAppUrl } from "@/lib/app-url";
import { getGoogleOAuthConfig } from "@/lib/auth-providers";
import {
  GOOGLE_SHEETS_SCOPES,
  normalizeGoogleSheetsSettings,
  upsertGoogleSheetsIntegration,
} from "@/lib/google-sheets-sync";
import {
  canManageIntegrations,
  getWorkspaceAccessForSlug,
} from "@/lib/workspace-integrations";
import { NextResponse } from "next/server";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

type GoogleSheetsOAuthState = {
  workspaceSlug: string;
  settings: ReturnType<typeof normalizeGoogleSheetsSettings>;
};

function redirectToSettings(
  request: Request,
  workspaceSlug?: string,
  error?: string,
) {
  const path = workspaceSlug
    ? `/${workspaceSlug}/settings/integrations`
    : "/settings/integrations";
  const url = new URL(path, request.url);
  if (error) url.searchParams.set("googleSheetsError", error);
  else url.searchParams.set("googleSheets", "connected");
  return NextResponse.redirect(url);
}

function decodeState(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.workspaceSlug !== "string"
    ) {
      return null;
    }
    return {
      workspaceSlug: parsed.workspaceSlug,
      settings: normalizeGoogleSheetsSettings(parsed.settings),
    } satisfies GoogleSheetsOAuthState;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse)
    return redirectToSettings(request, undefined, "unauthorized");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = decodeState(url.searchParams.get("state"));
  const workspaceSlug = state?.workspaceSlug;
  if (!code)
    return redirectToSettings(
      request,
      workspaceSlug ?? undefined,
      "missing_code",
    );

  const access = workspaceSlug
    ? await getWorkspaceAccessForSlug(session, workspaceSlug)
    : null;
  if (!access || !canManageIntegrations(access.role)) {
    return redirectToSettings(request, workspaceSlug ?? undefined, "forbidden");
  }

  const google = getGoogleOAuthConfig();
  if (!google) {
    return redirectToSettings(
      request,
      access.workspaceSlug,
      "configuration_required",
    );
  }

  const redirectUri = `${getConfiguredAppUrl()}/api/integrations/google-sheets/oauth/callback`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: google.clientId,
      client_secret: google.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenResponse.ok) {
    return redirectToSettings(
      request,
      access.workspaceSlug,
      "token_exchange_failed",
    );
  }
  const token = (await tokenResponse.json()) as GoogleTokenResponse;
  if (!token.access_token) {
    return redirectToSettings(
      request,
      access.workspaceSlug,
      "missing_access_token",
    );
  }

  await upsertGoogleSheetsIntegration(
    access,
    session.user.id,
    {
      ...state?.settings,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessTokenExpiresAt: new Date(
        Date.now() + (token.expires_in ?? 3600) * 1000,
      ).toISOString(),
      oauthScopes: token.scope?.split(" ") ?? [...GOOGLE_SHEETS_SCOPES],
    },
    "workspace_oauth",
  );

  return redirectToSettings(request, access.workspaceSlug);
}
