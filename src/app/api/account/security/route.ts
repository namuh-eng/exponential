import { randomBytes } from "node:crypto";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { createApiKeyHash } from "@/lib/api-auth";
import {
  type PermissionLevel,
  type WorkspaceMemberRole,
  asRecord,
  canMemberCreateApiKeys,
  readPermissionLevel,
} from "@/lib/api-settings";
import { db } from "@/lib/db";
import {
  account,
  apiKey,
  authorizedApplicationGrant,
  member,
  passkey,
  session as sessionTable,
  user,
  workspace,
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
const PERSONAL_API_KEY_NAME_MAX_LENGTH = 255;

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

const SCOPE_PRESENTATION: Record<
  string,
  { group: string; description: string }
> = {
  read: {
    group: "Workspace data",
    description: "View workspace and account information",
  },
  write: {
    group: "Workspace data",
    description: "Create and update workspace data",
  },
  "issues:read": {
    group: "Issues",
    description: "View issues and related metadata",
  },
  "issues:write": {
    group: "Issues",
    description: "Create and update issues",
  },
  "comments:read": {
    group: "Comments",
    description: "View comments",
  },
  "comments:write": {
    group: "Comments",
    description: "Create and update comments",
  },
  "webhooks:read": {
    group: "Webhooks",
    description: "View webhook subscriptions",
  },
  "webhooks:write": {
    group: "Webhooks",
    description: "Manage webhook subscriptions",
  },
};

type WorkspaceAccess = {
  workspaceId: string;
  workspaceName: string;
  settings: unknown;
  memberRole: WorkspaceMemberRole;
};

type RawPersonalApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  workspaceName: string;
  createdAt: Date | string | null;
  lastUsedAt: Date | string | null;
};

function createPersonalApiKeySecret() {
  return `lin_api_${randomBytes(24).toString("hex")}`;
}

function serializePersonalApiKey(item: RawPersonalApiKey) {
  return {
    id: item.id,
    name: item.name,
    keyPrefix: item.keyPrefix,
    workspaceName: item.workspaceName,
    accessLevel: "Member" as const,
    createdAt: serializeDate(item.createdAt),
    lastUsedAt: serializeDate(item.lastUsedAt),
  };
}

function getApiKeyCreationPermission(settings: unknown): PermissionLevel {
  const securitySettings = asRecord(asRecord(settings).security);
  return readPermissionLevel(
    asRecord(securitySettings.permissions).apiKeyCreationRole,
    "admins",
  );
}

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

function providerDisplayName(providerId: string, accountId: string) {
  if (providerId === "google" && accountId.includes("@")) {
    return accountId.split("@")[0];
  }
  return accountId;
}

function serializeAccountProvider(item: {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}) {
  const isEmail = item.accountId.includes("@");
  return {
    id: item.id,
    providerId: item.providerId,
    accountId: item.accountId,
    displayName: providerDisplayName(item.providerId, item.accountId),
    handle: isEmail ? null : item.accountId,
    email: isEmail ? item.accountId : null,
    avatarUrl: null,
    createdAt: serializeDate(item.createdAt),
    updatedAt: serializeDate(item.updatedAt),
  };
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

function humanizeScope(scope: string) {
  return scope
    .split(/[:_.-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildPermissionGroups(scopes: string[]) {
  const groups = new Map<string, string[]>();

  for (const scope of scopes) {
    const known = SCOPE_PRESENTATION[scope];
    const group = known?.group ?? "Additional access";
    const description = known?.description ?? humanizeScope(scope);
    groups.set(group, [...(groups.get(group) ?? []), description]);
  }

  return [...groups].map(([label, descriptions]) => ({ label, descriptions }));
}

function serializeAuthorizedApplication(application: RawAuthorizedApplication) {
  const scopes = normalizeScopes(application.scopes);

  return {
    id: application.id,
    appId: application.appId,
    clientId: application.clientId,
    name: application.name,
    imageUrl: application.imageUrl,
    publisher: null,
    scopes,
    permissionGroups: buildPermissionGroups(scopes),
    webhooksEnabled: application.webhooksEnabled,
    createdAt: serializeDate(application.createdAt),
    updatedAt: serializeDate(application.updatedAt),
    lastUsedAt: null,
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

async function getWorkspaceAccess(
  userId: string,
): Promise<WorkspaceAccess | null> {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const [access] = await db
    .select({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      settings: workspace.settings,
      memberRole: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.workspaceId, workspaceId),
        eq(member.userId, userId),
      ),
    )
    .limit(1);

  return access
    ? {
        workspaceId: access.workspaceId,
        workspaceName: access.workspaceName,
        settings: access.settings,
        memberRole: access.memberRole,
      }
    : null;
}

async function loadPersonalApiKeys(userId: string) {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) {
    return [];
  }

  return db
    .select({
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      workspaceName: workspace.name,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
    })
    .from(apiKey)
    .innerJoin(workspace, eq(workspace.id, apiKey.workspaceId))
    .where(and(eq(apiKey.userId, userId), eq(apiKey.workspaceId, workspaceId)))
    .orderBy(desc(apiKey.createdAt));
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
  const [
    sessions,
    providers,
    userPasskeys,
    authorizedApplications,
    personalApiKeys,
    workspaceAccess,
  ] = await Promise.all([
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
    loadPersonalApiKeys(authSession.user.id),
    getWorkspaceAccess(authSession.user.id),
  ]);

  const apiKeyCreationPermission = workspaceAccess
    ? getApiKeyCreationPermission(workspaceAccess.settings)
    : "admins";

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
    apiKeys: personalApiKeys.map(serializePersonalApiKey),
    canCreateApiKeys: workspaceAccess
      ? canMemberCreateApiKeys(
          workspaceAccess.memberRole,
          apiKeyCreationPermission,
        )
      : false,
    providers: providers.map(serializeAccountProvider),
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

  if (body.action === "createApiKey") {
    const workspaceAccess = await getWorkspaceAccess(authSession.user.id);
    if (!workspaceAccess) {
      return NextResponse.json(
        { error: "No active workspace found." },
        { status: 404 },
      );
    }

    const permissionLevel = getApiKeyCreationPermission(
      workspaceAccess.settings,
    );
    if (!canMemberCreateApiKeys(workspaceAccess.memberRole, permissionLevel)) {
      return NextResponse.json(
        { error: "You do not have permission to create API keys." },
        { status: 403 },
      );
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "API key name is required." },
        { status: 400 },
      );
    }
    if (name.length > PERSONAL_API_KEY_NAME_MAX_LENGTH) {
      return NextResponse.json(
        { error: "API key name must be 255 characters or fewer." },
        { status: 400 },
      );
    }

    const secret = createPersonalApiKeySecret();
    await db.insert(apiKey).values({
      name,
      keyHash: createApiKeyHash(secret),
      keyPrefix: `${secret.slice(0, 12)}…`,
      userId: authSession.user.id,
      workspaceId: workspaceAccess.workspaceId,
    });

    return NextResponse.json({
      ...(await buildSecurityPayload(authSession)),
      createdCredential: {
        kind: "apiKey",
        label: `${name} API key`,
        secret,
      },
    });
  }

  if (body.action === "revokeApiKey") {
    const apiKeyId = typeof body.apiKeyId === "string" ? body.apiKeyId : "";
    if (!apiKeyId) {
      return NextResponse.json(
        { error: "API key id is required." },
        { status: 400 },
      );
    }

    await db
      .delete(apiKey)
      .where(
        and(eq(apiKey.id, apiKeyId), eq(apiKey.userId, authSession.user.id)),
      );

    return NextResponse.json(await buildSecurityPayload(authSession));
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
