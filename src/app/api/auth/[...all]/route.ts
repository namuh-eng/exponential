import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { passkey, user as userTable, verification } from "@/lib/db/schema";
import { isWorkspaceAuthMethodAllowedForEmail } from "@/lib/workspace-auth-settings";
import { toNextJsHandler } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const authHandlers = toNextJsHandler(auth);

function disabledAuthResponse(method: "google" | "emailPasskey") {
  const methodName = method === "google" ? "Google" : "Email and passkey";
  return NextResponse.json(
    {
      code: "WORKSPACE_AUTH_METHOD_DISABLED",
      message: `${methodName} authentication is disabled for this workspace. Use SAML SSO or contact a workspace admin.`,
    },
    { status: 403 },
  );
}

async function parseJsonBody(request: Request) {
  try {
    return (await request.clone().json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

async function emailFromMagicLinkToken(token: string | null) {
  if (!token) {
    return null;
  }

  const [record] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.identifier, token))
    .limit(1);

  if (!record) {
    return null;
  }

  try {
    const payload = JSON.parse(record.value) as { email?: unknown };
    return stringValue(payload.email);
  } catch {
    return null;
  }
}

async function userIdFromPasskeyCredential(credentialId: string | null) {
  if (!credentialId) {
    return null;
  }

  const [record] = await db
    .select({ userId: passkey.userId })
    .from(passkey)
    .where(eq(passkey.credentialID, credentialId))
    .limit(1);

  return record?.userId ?? null;
}

async function emailFromUserId(userId: string | null) {
  if (!userId) {
    return null;
  }

  const [record] = await db
    .select({ email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  return record?.email ?? null;
}

async function enforcePostAuthPolicy(request: Request) {
  const url = new URL(request.url);
  const body = await parseJsonBody(request);

  if (url.pathname.endsWith("/api/auth/sign-in/magic-link")) {
    const allowed = await isWorkspaceAuthMethodAllowedForEmail({
      method: "emailPasskey",
      callbackUrl: stringValue(body?.callbackURL),
      email: stringValue(body?.email),
      baseUrl: url.origin,
    });
    return allowed ? null : disabledAuthResponse("emailPasskey");
  }

  if (url.pathname.endsWith("/api/auth/sign-in/social")) {
    if (stringValue(body?.provider) !== "google") {
      return null;
    }

    const idToken =
      body?.idToken && typeof body.idToken === "object"
        ? (body.idToken as Record<string, unknown>)
        : null;
    const idTokenUser =
      idToken?.user && typeof idToken.user === "object"
        ? (idToken.user as Record<string, unknown>)
        : null;
    const allowed = await isWorkspaceAuthMethodAllowedForEmail({
      method: "google",
      callbackUrl: stringValue(body?.callbackURL),
      email: stringValue(idTokenUser?.email),
      baseUrl: url.origin,
    });
    return allowed ? null : disabledAuthResponse("google");
  }

  if (url.pathname.endsWith("/api/auth/passkey/verify-authentication")) {
    const responseBody =
      body?.response && typeof body.response === "object"
        ? (body.response as Record<string, unknown>)
        : null;
    const userId = await userIdFromPasskeyCredential(
      stringValue(responseBody?.id),
    );
    const allowed = await isWorkspaceAuthMethodAllowedForEmail({
      method: "emailPasskey",
      callbackUrl: request.headers.get("x-auth-callback-url"),
      email: await emailFromUserId(userId),
      baseUrl: url.origin,
    });
    return allowed ? null : disabledAuthResponse("emailPasskey");
  }

  return null;
}

async function enforceGetAuthPolicy(request: Request) {
  const url = new URL(request.url);
  if (!url.pathname.endsWith("/api/auth/magic-link/verify")) {
    return null;
  }

  const allowed = await isWorkspaceAuthMethodAllowedForEmail({
    method: "emailPasskey",
    callbackUrl: url.searchParams.get("callbackURL"),
    email: await emailFromMagicLinkToken(url.searchParams.get("token")),
    baseUrl: url.origin,
  });

  return allowed ? null : disabledAuthResponse("emailPasskey");
}

export async function GET(request: Request) {
  return (await enforceGetAuthPolicy(request)) ?? authHandlers.GET(request);
}

export async function POST(request: Request) {
  return (await enforcePostAuthPolicy(request)) ?? authHandlers.POST(request);
}
