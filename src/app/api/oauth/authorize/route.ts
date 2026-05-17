import { createHash, randomBytes } from "node:crypto";
import { requireApiSession } from "@/lib/api-auth";
import {
  asRecord,
  hasUnsupportedOAuthScopes,
  parseRequestedOAuthScopes,
  readWorkspaceApiSettings,
  serializeWorkspaceApiSettings,
} from "@/lib/api-settings";
import { db } from "@/lib/db";
import { authorizedApplicationGrant, workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function makeCode() {
  return `lincode_${randomBytes(24).toString("hex")}`;
}

function errorRedirect(
  redirectUri: string | null,
  error: string,
  state: string | null,
) {
  if (!redirectUri) {
    return NextResponse.json({ error }, { status: 400 });
  }
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) {
    url.searchParams.set("state", state);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse || !session) {
    return authResponse;
  }

  const url = new URL(request.url);
  const responseType = url.searchParams.get("response_type");
  const clientId = url.searchParams.get("client_id")?.trim() ?? "";
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const scopeParam = url.searchParams.get("scope") ?? "";

  if (responseType !== "code") {
    return errorRedirect(redirectUri, "unsupported_response_type", state);
  }
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (hasUnsupportedOAuthScopes(scopeParam)) {
    return errorRedirect(redirectUri, "invalid_scope", state);
  }

  const workspaces = await db
    .select({ id: workspace.id, settings: workspace.settings })
    .from(workspace);
  const found = workspaces
    .map((item) => ({
      workspaceId: item.id,
      settings: asRecord(item.settings),
      api: readWorkspaceApiSettings(item.settings),
    }))
    .flatMap((item) =>
      item.api.oauthApplications.map((application) => ({
        ...item,
        application,
      })),
    )
    .find((item) => item.application.clientId === clientId);

  if (!found) {
    return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  }
  const allowedRedirectUrls = found.application.redirectUrls ?? [
    found.application.redirectUrl,
  ];
  const allowedScopes = found.application.scopes ?? ["read"];
  if (!allowedRedirectUrls.includes(redirectUri)) {
    return errorRedirect(redirectUri, "invalid_redirect_uri", state);
  }

  const requestedScopes = parseRequestedOAuthScopes(scopeParam);
  const scopes = requestedScopes.length ? requestedScopes : allowedScopes;
  if (scopes.some((scope) => !allowedScopes.includes(scope))) {
    return errorRedirect(redirectUri, "invalid_scope", state);
  }

  const code = makeCode();
  const now = new Date();
  const nextSettings = {
    ...found.settings,
    api: serializeWorkspaceApiSettings({
      ...found.api,
      oauthAuthorizationCodes: [
        {
          codeHash: hashSecret(code),
          applicationId: found.application.id,
          clientId,
          workspaceId: found.workspaceId,
          userId: session.user.id,
          redirectUri,
          scopes,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        },
        ...found.api.oauthAuthorizationCodes,
      ],
    }),
  };
  await db
    .update(workspace)
    .set({ settings: nextSettings, updatedAt: new Date() })
    .where(eq(workspace.id, found.workspaceId));

  await db
    .insert(authorizedApplicationGrant)
    .values({
      id: `grant_${randomBytes(8).toString("hex")}`,
      userId: session.user.id,
      appId: found.application.id,
      clientId,
      name: found.application.name,
      scopes,
    })
    .onConflictDoUpdate({
      target: [
        authorizedApplicationGrant.userId,
        authorizedApplicationGrant.appId,
      ],
      set: { name: found.application.name, scopes, updatedAt: new Date() },
    });

  const callback = new URL(redirectUri);
  callback.searchParams.set("code", code);
  if (state) {
    callback.searchParams.set("state", state);
  }
  return NextResponse.redirect(callback);
}
