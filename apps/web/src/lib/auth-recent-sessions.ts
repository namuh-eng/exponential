import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { authLoginEvent, member, user, workspace } from "@/lib/db/schema";
import { sendNewDeviceLoginEmail } from "@/lib/email";
import { getWorkspaceAuthPolicyForCallbackUrl } from "@/lib/workspace-auth-settings";
import { and, desc, eq, gte, or } from "drizzle-orm";

const FINGERPRINT_COOKIE = "exp_recent_session_fp";
const MAX_RECENT_SESSIONS = 5;

export type RecentSessionEntry = {
  id: string;
  workspaceName: string;
  actor: string;
  device: string;
  ipFamily: string;
  loggedInAt: string;
  currentOrigin: boolean;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function getRecentSessionFingerprintCookieName() {
  return FINGERPRINT_COOKIE;
}

export function getClientIpFromHeaders(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    forwarded ||
    "127.0.0.1"
  );
}

export function toIpFamily(ipOrHost: string | null | undefined) {
  const value = (ipOrHost ?? "").trim().toLowerCase();
  if (!value) return null;
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0/24`;
  if (value.includes(":"))
    return `${value.split(":").slice(0, 4).join(":")}::/64`;
  return value.slice(0, 120);
}

export function getBrowserFingerprint(headers: Headers) {
  const cookie = headers.get("cookie") ?? "";
  const match = cookie.match(
    new RegExp(`(?:^|; )${FINGERPRINT_COOKIE}=([^;]+)`),
  );
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function redactEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "Recent teammate";
  return `${local.slice(0, 2)}••@${domain}`;
}

function describeDevice(userAgent: string | null | undefined) {
  const ua = userAgent ?? "";
  const browser = /Firefox/i.test(ua)
    ? "Firefox"
    : /Edg/i.test(ua)
      ? "Edge"
      : /Chrome/i.test(ua)
        ? "Chrome"
        : /Safari/i.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Mac/i.test(ua)
    ? "macOS"
    : /Windows/i.test(ua)
      ? "Windows"
      : /Linux/i.test(ua)
        ? "Linux"
        : /iPhone|iPad/i.test(ua)
          ? "iOS"
          : "device";
  return `${browser} on ${os}`;
}

export async function getRecentSessionsForRequest(input: {
  headers: Headers;
  host: string | null;
  callbackUrl?: string | null;
  baseUrl?: string;
  limit?: number;
}) {
  const ipFamily = toIpFamily(
    input.host || getClientIpFromHeaders(input.headers),
  );
  const fingerprint = getBrowserFingerprint(input.headers);
  if (!ipFamily && !fingerprint)
    return { entries: [], recognizedOrigin: false };

  const fingerprintHash = fingerprint ? sha256(fingerprint) : null;
  const policy = await getWorkspaceAuthPolicyForCallbackUrl(
    input.callbackUrl,
    input.baseUrl,
  );
  const clauses = [];
  if (ipFamily && policy?.workspaceId) {
    clauses.push(
      and(
        eq(authLoginEvent.workspaceId, policy.workspaceId),
        eq(authLoginEvent.ipFamily, ipFamily),
      ),
    );
  }
  if (fingerprintHash) {
    clauses.push(eq(authLoginEvent.fingerprintHash, fingerprintHash));
  }
  if (clauses.length === 0) {
    return { entries: [], recognizedOrigin: false };
  }

  const rows = await db
    .select({
      id: authLoginEvent.id,
      workspaceId: authLoginEvent.workspaceId,
      workspaceName: workspace.name,
      email: user.email,
      userAgent: authLoginEvent.userAgent,
      ipFamily: authLoginEvent.ipFamily,
      createdAt: authLoginEvent.createdAt,
    })
    .from(authLoginEvent)
    .innerJoin(workspace, eq(workspace.id, authLoginEvent.workspaceId))
    .innerJoin(user, eq(user.id, authLoginEvent.userId))
    .where(
      and(
        or(...clauses),
        gte(
          authLoginEvent.createdAt,
          new Date(Date.now() - 1000 * 60 * 60 * 24 * 45),
        ),
      ),
    )
    .orderBy(desc(authLoginEvent.createdAt))
    .limit(Math.min(input.limit ?? MAX_RECENT_SESSIONS, MAX_RECENT_SESSIONS));

  return {
    recognizedOrigin: rows.some((row) => row.ipFamily === ipFamily),
    entries: rows.map((row) => ({
      id: row.id,
      workspaceName: row.workspaceName,
      actor: redactEmail(row.email),
      device: describeDevice(row.userAgent),
      ipFamily: row.ipFamily ?? "known browser",
      loggedInAt: row.createdAt.toISOString(),
      currentOrigin: row.ipFamily === ipFamily,
    })),
  };
}

export async function recordSuccessfulLogin(input: {
  userId: string;
  headers: Headers;
  sessionId?: string;
}) {
  const ipAddress = getClientIpFromHeaders(input.headers);
  const ipFamily = toIpFamily(ipAddress);
  const fingerprint = getBrowserFingerprint(input.headers);
  const fingerprintHash = fingerprint ? sha256(fingerprint) : null;
  const userAgent = input.headers.get("user-agent") ?? null;

  const memberships = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, input.userId));
  if (memberships.length === 0) return;

  const previous = await db
    .select({ id: authLoginEvent.id })
    .from(authLoginEvent)
    .where(
      and(
        eq(authLoginEvent.userId, input.userId),
        or(
          fingerprintHash
            ? eq(authLoginEvent.fingerprintHash, fingerprintHash)
            : eq(authLoginEvent.ipFamily, ipFamily ?? ""),
          eq(authLoginEvent.userAgent, userAgent ?? ""),
        ),
      ),
    )
    .limit(1);

  await db.insert(authLoginEvent).values(
    memberships.map((membership) => ({
      userId: input.userId,
      workspaceId: membership.workspaceId,
      sessionId: input.sessionId ?? null,
      ipFamily,
      fingerprintHash,
      userAgent,
    })),
  );

  if (previous.length === 0) {
    const [accountUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1);
    if (accountUser?.email) {
      await sendNewDeviceLoginEmail(accountUser.email, {
        device: describeDevice(userAgent),
        ipFamily: ipFamily ?? "unknown network",
      });
    }
  }
}
