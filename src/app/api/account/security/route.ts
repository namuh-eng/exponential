import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  account,
  authorizedApplicationGrant,
  passkey,
  session as sessionTable,
  user,
} from "@/lib/db/schema";
import { isPasskeyAuthEnabled } from "@/lib/passkeys";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

type AuthSession = {
  user: { id: string };
  session?: { id?: string | null } | null;
};

type AccountSecurityAction = {
  action?: string;
  passkeyId?: unknown;
  sessionId?: unknown;
  applicationId?: unknown;
  apiKeyId?: unknown;
  name?: unknown;
} | null;

const SESSION_QUERY_LIMIT = 50;
const SESSION_VISIBLE_LIMIT = 10;

type RawSecuritySession = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  expiresAt: Date | string | null;
};

type RawAuthorizedApplication = {
  id: string;
  appId: string;
  clientId: string;
  name: string;
  imageUrl: string | null;
  scopes: unknown;
  webhooksEnabled: boolean;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

function getCurrentSessionId(authSession: AuthSession) {
  return typeof authSession.session?.id === "string"
    ? authSession.session.id
    : null;
}

function serializeDate(value: Date | string | null) {
  if (!value) {
    return null;
  }

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function normalizeScopes(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter(
      (scope): scope is string =>
        typeof scope === "string" && scope.trim() !== "",
    );
  }

  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  return [];
}

function serializeAuthorizedApplication(application: RawAuthorizedApplication) {
  return {
    id: application.id,
    appId: application.appId,
    clientId: application.clientId,
    name: application.name,
    imageUrl: application.imageUrl,
    scopes: normalizeScopes(application.scopes),
    webhooksEnabled: application.webhooksEnabled,
    createdAt: serializeDate(application.createdAt),
    updatedAt: serializeDate(application.updatedAt),
  };
}

function normalizeSessionMetadata(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function sessionTimestamp(value: Date | string | null) {
  if (!value) {
    return 0;
  }

  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function isUnknownDeviceSession(session: RawSecuritySession) {
  return (
    !normalizeSessionMetadata(session.userAgent) &&
    !normalizeSessionMetadata(session.ipAddress)
  );
}

function sessionDedupeKey(session: RawSecuritySession) {
  return isUnknownDeviceSession(session) ? "unknown-device" : session.id;
}

function summarizeSessionSource(
  session: RawSecuritySession,
  isCurrent: boolean,
) {
  const userAgent = normalizeSessionMetadata(session.userAgent);
  if (userAgent) {
    return "Browser";
  }

  return isCurrent ? "Current browser session" : "Browser session";
}

function summarizeSessionLocation(session: RawSecuritySession) {
  return normalizeSessionMetadata(session.ipAddress)
    ? "Approximate location unavailable"
    : "Unknown location";
}

function prepareVisibleSessions(
  rows: RawSecuritySession[],
  currentSessionId: string | null,
) {
  const sorted = [...rows].sort((a, b) => {
    if (currentSessionId) {
      if (a.id === currentSessionId) return -1;
      if (b.id === currentSessionId) return 1;
    }

    return sessionTimestamp(b.updatedAt) - sessionTimestamp(a.updatedAt);
  });
  const seen = new Set<string>();
  const visible: RawSecuritySession[] = [];

  for (const row of sorted) {
    const key = sessionDedupeKey(row);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    visible.push(row);

    if (visible.length >= SESSION_VISIBLE_LIMIT) {
      break;
    }
  }

  return visible;
}

async function currentUserExists(userId: string) {
  const [currentUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return Boolean(currentUser);
}

async function loadVisibleSessionCandidates(
  userId: string,
  currentSessionId: string | null,
) {
  const recentSessions = await db
    .select({
      id: sessionTable.id,
      userAgent: sessionTable.userAgent,
      ipAddress: sessionTable.ipAddress,
      createdAt: sessionTable.createdAt,
      updatedAt: sessionTable.updatedAt,
      expiresAt: sessionTable.expiresAt,
    })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, userId),
        gt(sessionTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(sessionTable.updatedAt))
    .limit(SESSION_QUERY_LIMIT);

  if (
    !currentSessionId ||
    recentSessions.some(
      (deviceSession) => deviceSession.id === currentSessionId,
    )
  ) {
    return recentSessions;
  }

  const [currentSession] = await db
    .select({
      id: sessionTable.id,
      userAgent: sessionTable.userAgent,
      ipAddress: sessionTable.ipAddress,
      createdAt: sessionTable.createdAt,
      updatedAt: sessionTable.updatedAt,
      expiresAt: sessionTable.expiresAt,
    })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, userId),
        eq(sessionTable.id, currentSessionId),
        gt(sessionTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return currentSession ? [currentSession, ...recentSessions] : recentSessions;
}

async function buildSecurityPayload(authSession: AuthSession) {
  const currentSessionId = getCurrentSessionId(authSession);
  const [sessions, providers, userPasskeys, authorizedApplications] =
    await Promise.all([
      loadVisibleSessionCandidates(authSession.user.id, currentSessionId),
      db
        .select({
          id: account.id,
          providerId: account.providerId,
          accountId: account.accountId,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        })
        .from(account)
        .where(eq(account.userId, authSession.user.id))
        .orderBy(desc(account.updatedAt)),
      db
        .select({
          id: passkey.id,
          name: passkey.name,
          credentialID: passkey.credentialID,
          deviceType: passkey.deviceType,
          backedUp: passkey.backedUp,
          transports: passkey.transports,
          createdAt: passkey.createdAt,
        })
        .from(passkey)
        .where(eq(passkey.userId, authSession.user.id))
        .orderBy(desc(passkey.createdAt)),
      db
        .select({
          id: authorizedApplicationGrant.id,
          appId: authorizedApplicationGrant.appId,
          clientId: authorizedApplicationGrant.clientId,
          name: authorizedApplicationGrant.name,
          imageUrl: authorizedApplicationGrant.imageUrl,
          scopes: authorizedApplicationGrant.scopes,
          webhooksEnabled: authorizedApplicationGrant.webhooksEnabled,
          createdAt: authorizedApplicationGrant.createdAt,
          updatedAt: authorizedApplicationGrant.updatedAt,
        })
        .from(authorizedApplicationGrant)
        .where(eq(authorizedApplicationGrant.userId, authSession.user.id))
        .orderBy(desc(authorizedApplicationGrant.updatedAt)),
    ]);

  return {
    sessions: prepareVisibleSessions(sessions, currentSessionId).map(
      (deviceSession) => {
        const isCurrent = currentSessionId
          ? deviceSession.id === currentSessionId
          : false;

        return {
          id: deviceSession.id,
          isCurrent,
          userAgent: normalizeSessionMetadata(deviceSession.userAgent),
          ipAddress: normalizeSessionMetadata(deviceSession.ipAddress),
          source: summarizeSessionSource(deviceSession, isCurrent),
          location: summarizeSessionLocation(deviceSession),
          createdAt: serializeDate(deviceSession.createdAt),
          updatedAt: serializeDate(deviceSession.updatedAt),
          expiresAt: serializeDate(deviceSession.expiresAt),
        };
      },
    ),
    passkeys: userPasskeys.map((item) => ({
      id: item.id,
      name: item.name ?? "Unnamed passkey",
      credentialId: item.credentialID,
      deviceType: item.deviceType,
      backedUp: item.backedUp,
      transports: item.transports
        ? item.transports.split(",").filter(Boolean)
        : [],
      createdAt: serializeDate(item.createdAt),
    })),
    authorizedApplications: authorizedApplications.map(
      serializeAuthorizedApplication,
    ),
    providers,
    passkeyEnabled: isPasskeyAuthEnabled(),
  };
}

async function loadAuthenticatedUser() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return { error: authResponse, authSession: null };
  }

  const authSession = session as AuthSession;
  if (!(await currentUserExists(authSession.user.id))) {
    return {
      error: NextResponse.json({ error: "User not found" }, { status: 404 }),
      authSession: null,
    };
  }

  return { error: null, authSession };
}

export async function GET() {
  const { error, authSession } = await loadAuthenticatedUser();
  if (error || !authSession) {
    return error;
  }

  return NextResponse.json(await buildSecurityPayload(authSession));
}

export async function POST(request: Request) {
  const { error, authSession } = await loadAuthenticatedUser();
  if (error || !authSession) {
    return error;
  }

  const body = (await request
    .json()
    .catch(() => null)) as AccountSecurityAction;
  if (!body?.action) {
    return NextResponse.json({ error: "Action is required." }, { status: 400 });
  }

  const currentSessionId = getCurrentSessionId(authSession);

  if (body.action === "revokeSession") {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) {
      return NextResponse.json(
        { error: "Session id is required." },
        { status: 400 },
      );
    }
    if (currentSessionId && sessionId === currentSessionId) {
      return NextResponse.json(
        { error: "You cannot revoke your current session from here." },
        { status: 400 },
      );
    }

    await db
      .delete(sessionTable)
      .where(
        and(
          eq(sessionTable.id, sessionId),
          eq(sessionTable.userId, authSession.user.id),
        ),
      );

    return NextResponse.json(await buildSecurityPayload(authSession));
  }

  if (body.action === "revokeAllOtherSessions") {
    if (!currentSessionId) {
      return NextResponse.json(
        { error: "Current session could not be identified." },
        { status: 400 },
      );
    }

    await db
      .delete(sessionTable)
      .where(
        and(
          eq(sessionTable.userId, authSession.user.id),
          ne(sessionTable.id, currentSessionId),
        ),
      );

    return NextResponse.json(await buildSecurityPayload(authSession));
  }

  if (body.action === "revokePasskey") {
    const passkeyId = typeof body.passkeyId === "string" ? body.passkeyId : "";
    if (!passkeyId) {
      return NextResponse.json(
        { error: "Passkey id is required." },
        { status: 400 },
      );
    }

    await db
      .delete(passkey)
      .where(
        and(eq(passkey.id, passkeyId), eq(passkey.userId, authSession.user.id)),
      );

    return NextResponse.json(await buildSecurityPayload(authSession));
  }

  if (body.action === "createApiKey" || body.action === "revokeApiKey") {
    return NextResponse.json(
      { error: "API key actions are not supported on account security." },
      { status: 404 },
    );
  }

  if (body.action === "revokeAuthorizedApplication") {
    const applicationId =
      typeof body.applicationId === "string" ? body.applicationId : "";
    if (!applicationId) {
      return NextResponse.json(
        { error: "Authorized application id is required." },
        { status: 400 },
      );
    }

    await db
      .delete(authorizedApplicationGrant)
      .where(
        and(
          eq(authorizedApplicationGrant.id, applicationId),
          eq(authorizedApplicationGrant.userId, authSession.user.id),
        ),
      );

    return NextResponse.json(await buildSecurityPayload(authSession));
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
