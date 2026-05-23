import { createHash, randomBytes } from "node:crypto";
import {
  asRecord,
  readWorkspaceApiSettings,
  serializeWorkspaceApiSettings,
} from "@/lib/api-settings";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return asRecord(await request.json().catch(() => null));
  }
  const form = await request.formData().catch(() => null);
  if (!form) {
    return {};
  }
  return Object.fromEntries(form.entries());
}

export async function POST(request: Request) {
  const body = await readBody(request);
  if (body.grant_type !== "authorization_code") {
    return NextResponse.json(
      { error: "unsupported_grant_type" },
      { status: 400 },
    );
  }
  const code = typeof body.code === "string" ? body.code : "";
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  const clientSecret =
    typeof body.client_secret === "string" ? body.client_secret : "";
  const redirectUri =
    typeof body.redirect_uri === "string" ? body.redirect_uri : "";
  if (!code || !clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const workspaces = await db
    .select({ id: workspace.id, settings: workspace.settings })
    .from(workspace);
  const codeHash = hashSecret(code);
  const found = workspaces
    .map((item) => ({
      workspaceId: item.id,
      settings: asRecord(item.settings),
      api: readWorkspaceApiSettings(item.settings),
    }))
    .map((item) => ({
      ...item,
      codeRecord: item.api.oauthAuthorizationCodes.find(
        (record) => record.codeHash === codeHash,
      ),
    }))
    .find((item) => item.codeRecord);
  if (!found?.codeRecord) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }
  const application = found.api.oauthApplications.find(
    (app) =>
      app.clientId === clientId && app.id === found.codeRecord?.applicationId,
  );
  if (
    !application ||
    !application.clientSecretHash ||
    application.clientSecretHash !== hashSecret(clientSecret)
  ) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }
  if (
    found.codeRecord.redirectUri !== redirectUri ||
    new Date(found.codeRecord.expiresAt).getTime() < Date.now()
  ) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  const accessToken = `lin_oauth_at_${randomBytes(24).toString("hex")}`;
  const refreshToken = `lin_oauth_rt_${randomBytes(24).toString("hex")}`;
  const now = new Date();
  const nextSettings = {
    ...found.settings,
    api: serializeWorkspaceApiSettings({
      ...found.api,
      oauthAuthorizationCodes: found.api.oauthAuthorizationCodes.filter(
        (record) => record.codeHash !== codeHash,
      ),
      oauthTokens: [
        {
          id: `tok_${randomBytes(8).toString("hex")}`,
          tokenHash: hashSecret(accessToken),
          refreshTokenHash: hashSecret(refreshToken),
          applicationId: application.id,
          clientId,
          workspaceId: found.workspaceId,
          userId: found.codeRecord.userId,
          scopes: found.codeRecord.scopes,
          revokedAt: null,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        },
        ...found.api.oauthTokens,
      ],
    }),
  };
  await db
    .update(workspace)
    .set({ settings: nextSettings, updatedAt: new Date() })
    .where(eq(workspace.id, found.workspaceId));

  return NextResponse.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: found.codeRecord.scopes.join(" "),
  });
}
