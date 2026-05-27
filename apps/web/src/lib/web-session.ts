import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { session as authSession, user } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type WebSession = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
};

const BROWSER_SESSION_COOKIE = "exponential_session";

function sessionSecret() {
  return (
    process.env.EXPONENTIAL_SESSION_SECRET ??
    process.env.EXPONENTIAL_DEV_SESSION_SECRET ??
    "dev-only-exponential-session-secret-not-for-production"
  );
}

function browserSessionCookie(headerList: Headers) {
  const cookieHeader = headerList.get("cookie") ?? "";
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const prefix = `${BROWSER_SESSION_COOKIE}=`;
  const found = cookies.find((cookie) => cookie.startsWith(prefix));
  if (found) return decodeURIComponent(found.slice(prefix.length));
  return headerList.get("x-session-token")?.trim() ?? "";
}

function verifySessionToken(value: string) {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return value;
  if (dot === 0 || dot === value.length - 1) return null;
  const rawToken = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = createHmac("sha256", sessionSecret())
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

async function getBrowserSession(
  headerList: Headers,
): Promise<WebSession | null> {
  const rawToken = verifySessionToken(browserSessionCookie(headerList));
  if (!rawToken) return null;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const [record] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(authSession)
    .innerJoin(user, eq(user.id, authSession.userId))
    .where(eq(authSession.tokenHash, tokenHash))
    .limit(1);
  return record ? { user: record } : null;
}

export async function getWebSession(headerList: Headers) {
  return getBrowserSession(headerList);
}
