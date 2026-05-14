import { randomBytes } from "node:crypto";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { createApiKeyHash, requireApiSession } from "@/lib/api-auth";
import {
  asRecord,
  canMemberCreateApiKeys,
  readPermissionLevel,
} from "@/lib/api-settings";
import { db } from "@/lib/db";
import {
  account,
  apiKey,
  member,
  passkey,
  session as sessionTable,
  user,
  workspace,
} from "@/lib/db/schema";
import { isPasskeyAuthEnabled } from "@/lib/passkeys";
import { and, desc, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

type AuthSession = {
  user: { id: string };
  session?: { id?: string | null } | null;
  apiKey?: { workspaceId: string };
};

type AccountSecurityAction =
  | { action?: "createApiKey"; name?: unknown }
  | { action?: "revokePasskey"; passkeyId?: unknown }
  | { action?: "revokeSession"; sessionId?: unknown }
  | { action?: "revokeAllOtherSessions" }
  | { action?: "revokeApiKey"; apiKeyId?: unknown }
  | { action?: "revokeAuthorizedApplication"; applicationId?: unknown }
  | null;

const API_KEY_PREFIX = "lin_api";

function getCurrentSessionId(authSession: AuthSession) {
  return typeof authSession.session?.id === "string"
    ? authSession.session.id
    : null;
}

function createSecret(prefix: string) {
  return `${prefix}_${randomBytes(24).toString("hex")}`;
}

function serializeDate(value: Date | string | null) {
  if (!value) {
    return null;
  }

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

async function currentUserExists(userId: string) {
  const [currentUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return Boolean(currentUser);
}

async function getWorkspaceAccess(authSession: AuthSession) {
  const workspaceId =
    authSession.apiKey?.workspaceId ??
    (await resolveActiveWorkspaceId(authSession.user.id));

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
        eq(member.userId, authSession.user.id),
      ),
    )
    .limit(1);

  return access ?? null;
}

async function buildSecurityPayload(authSession: AuthSession) {
  const currentSessionId = getCurrentSessionId(authSession);
  const workspaceAccess = await getWorkspaceAccess(authSession);

  const [sessions, providers, userPasskeys, personalApiKeys] =
    await Promise.all([
      db
        .select({
          id: sessionTable.id,
          userAgent: sessionTable.userAgent,
          ipAddress: sessionTable.ipAddress,
          createdAt: sessionTable.createdAt,
          updatedAt: sessionTable.updatedAt,
          expiresAt: sessionTable.expiresAt,
        })
        .from(sessionTable)
        .where(eq(sessionTable.userId, authSession.user.id))
        .orderBy(desc(sessionTable.updatedAt)),
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
          id: apiKey.id,
          name: apiKey.name,
          keyPrefix: apiKey.keyPrefix,
          createdAt: apiKey.createdAt,
          lastUsedAt: apiKey.lastUsedAt,
          workspaceId: apiKey.workspaceId,
          workspaceName: workspace.name,
        })
        .from(apiKey)
        .innerJoin(workspace, eq(apiKey.workspaceId, workspace.id))
        .where(eq(apiKey.userId, authSession.user.id))
        .orderBy(desc(apiKey.createdAt)),
    ]);

  const permissionLevel = readPermissionLevel(
    asRecord(asRecord(asRecord(workspaceAccess?.settings).security).permissions)
      .apiKeyCreationRole,
    "admins",
  );
  const canCreateApiKeys = workspaceAccess
    ? canMemberCreateApiKeys(workspaceAccess.memberRole, permissionLevel)
    : false;
  return {
    sessions: sessions.map((deviceSession) => ({
      id: deviceSession.id,
      isCurrent: currentSessionId
        ? deviceSession.id === currentSessionId
        : false,
      userAgent: deviceSession.userAgent,
      ipAddress: deviceSession.ipAddress,
      source: deviceSession.userAgent ? "Browser" : "Unknown source",
      location: deviceSession.ipAddress
        ? "Approximate location unavailable"
        : "Unknown location",
      createdAt: serializeDate(deviceSession.createdAt),
      updatedAt: serializeDate(deviceSession.updatedAt),
      expiresAt: serializeDate(deviceSession.expiresAt),
    })),
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
    apiKeys: personalApiKeys.map((item) => ({
      id: item.id,
      name: item.name,
      keyPrefix: item.keyPrefix,
      workspaceId: item.workspaceId,
      workspaceName: item.workspaceName,
      createdAt: serializeDate(item.createdAt),
      lastUsedAt: serializeDate(item.lastUsedAt),
    })),
    authorizedApplications: [],
    providers,
    passkeyEnabled: isPasskeyAuthEnabled(),
    canCreateApiKeys,
    activeWorkspace: workspaceAccess
      ? { id: workspaceAccess.workspaceId, name: workspaceAccess.workspaceName }
      : null,
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
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "API key name is required." },
        { status: 400 },
      );
    }

    const workspaceAccess = await getWorkspaceAccess(authSession);
    if (!workspaceAccess) {
      return NextResponse.json(
        { error: "No active workspace found for API key creation." },
        { status: 404 },
      );
    }

    const permissionLevel = readPermissionLevel(
      asRecord(
        asRecord(asRecord(workspaceAccess.settings).security).permissions,
      ).apiKeyCreationRole,
      "admins",
    );
    if (!canMemberCreateApiKeys(workspaceAccess.memberRole, permissionLevel)) {
      return NextResponse.json(
        { error: "You do not have permission to create API keys." },
        { status: 403 },
      );
    }

    const secret = createSecret(API_KEY_PREFIX);
    await db.insert(apiKey).values({
      name,
      keyHash: createApiKeyHash(secret),
      keyPrefix: `${secret.slice(0, 12)}…`,
      userId: authSession.user.id,
      workspaceId: workspaceAccess.workspaceId,
    });

    return NextResponse.json({
      ...(await buildSecurityPayload(authSession)),
      createdApiKey: {
        label: `${name} API key`,
        token: secret,
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
    return NextResponse.json(
      {
        error:
          "OAuth application grants are not configured for this workspace.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
