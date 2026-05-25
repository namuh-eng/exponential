import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { session as authSession, user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type KratosWhoami = {
  identity?: { traits?: { email?: unknown } };
};

export type WebSession = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
};

function kratosPublicUrl() {
  return (
    process.env.EXPONENTIAL_KRATOS_PUBLIC_URL ??
    process.env.EXPONENTIAL_API_KRATOS_URL ??
    "http://localhost:4433"
  ).replace(/\/$/, "");
}

export async function getKratosSession(
  headerList: Headers,
): Promise<WebSession | null> {
  const cookie = headerList.get("cookie") ?? "";
  const sessionToken = headerList.get("x-session-token")?.trim() ?? "";
  if (!cookie && !sessionToken) return null;

  const kratosHeaders = new Headers({ accept: "application/json" });
  if (cookie) kratosHeaders.set("cookie", cookie);
  if (sessionToken) kratosHeaders.set("x-session-token", sessionToken);

  const response = await fetch(`${kratosPublicUrl()}/sessions/whoami`, {
    headers: kratosHeaders,
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;

  const whoami = (await response
    .json()
    .catch(() => null)) as KratosWhoami | null;
  const email =
    typeof whoami?.identity?.traits?.email === "string"
      ? whoami.identity.traits.email.trim().toLowerCase()
      : "";
  if (!email) return null;

  const [record] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return record ? { user: record } : null;
}

function testSessionEnabled() {
  return (
    process.env.NODE_ENV === "test" || process.env.PLAYWRIGHT_TEST === "true"
  );
}

function devSessionSecret() {
  return (
    process.env.EXPONENTIAL_DEV_SESSION_SECRET ??
    "dev-only-kratos-session-secret-not-for-production"
  );
}

function signedSessionCookie(headerList: Headers) {
  const cookieHeader = headerList.get("cookie") ?? "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  for (const name of ["ory_kratos_session"]) {
    const prefix = `${name}=`;
    const found = cookies.find((cookie) => cookie.startsWith(prefix));
    if (found) return decodeURIComponent(found.slice(prefix.length));
  }
  return "";
}

function verifySignedSessionToken(value: string) {
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const rawToken = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = createHmac("sha256", devSessionSecret())
    .update(rawToken)
    .digest("base64");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }
  return rawToken;
}

async function getTestSession(headerList: Headers): Promise<WebSession | null> {
  if (!testSessionEnabled()) return null;
  const rawToken = verifySignedSessionToken(signedSessionCookie(headerList));
  if (!rawToken) return null;
  const [record] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(authSession)
    .innerJoin(user, eq(user.id, authSession.userId))
    .where(eq(authSession.token, rawToken))
    .limit(1);
  return record ? { user: record } : null;
}

export async function getWebSession(headerList: Headers) {
  const kratosSession = await getKratosSession(headerList);
  if (kratosSession) return kratosSession;

  const testSession = await getTestSession(headerList);
  if (testSession) return testSession;

  if (process.env.NODE_ENV === "test") {
    const { auth } = await import("test-auth");
    return auth.api.getSession({ headers: headerList });
  }

  return null;
}
