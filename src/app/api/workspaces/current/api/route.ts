import { randomBytes } from "node:crypto";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { createApiKeyHash, requireApiSession } from "@/lib/api-auth";
import {
  GRAPHQL_DOCS_URL,
  OAUTH_APPLICATIONS_DOCS_URL,
  type PermissionLevel,
  WEBHOOKS_DOCS_URL,
  type WorkspaceMemberRole,
  asRecord,
  canManageWorkspaceApi,
  canMemberCreateApiKeys,
  isPermissionLevel,
  normalizeWebhookEvents,
  readPermissionLevel,
  readWorkspaceApiSettings,
  serializeWorkspaceApiSettings,
  validateOAuthRedirectUrl,
} from "@/lib/api-settings";
import { db } from "@/lib/db";
import { apiKey, member, user, webhook, workspace } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type WorkspaceAccess = {
  workspaceId: string;
  settings: unknown;
  memberRole: WorkspaceMemberRole;
  userId: string;
};

function createId(prefix: string) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function createOAuthClientId() {
  return `lin_${randomBytes(12).toString("hex")}`;
}

function createSecret(prefix: string) {
  return `${prefix}_${randomBytes(24).toString("hex")}`;
}

function normalizeAbsoluteUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

async function getWorkspaceAccess(
  userId: string,
  workspaceIdOverride?: string,
): Promise<WorkspaceAccess | null> {
  const workspaceId =
    workspaceIdOverride ?? (await resolveActiveWorkspaceId(userId));
  if (!workspaceId) {
    return null;
  }

  const [access] = await db
    .select({
      workspaceId: workspace.id,
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

  if (!access) {
    return null;
  }

  return {
    workspaceId: access.workspaceId,
    settings: access.settings,
    memberRole: access.memberRole,
    userId,
  };
}

async function buildApiPayload(access: WorkspaceAccess) {
  const workspaceApiSettings = readWorkspaceApiSettings(access.settings);
  const securitySettings = asRecord(asRecord(access.settings).security);
  const permissionLevel = readPermissionLevel(
    asRecord(securitySettings.permissions).apiKeyCreationRole,
    "admins",
  );

  const [webhooks, apiKeys] = await Promise.all([
    db
      .select({
        id: webhook.id,
        label: webhook.label,
        url: webhook.url,
        enabled: webhook.enabled,
        events: webhook.events,
        createdAt: webhook.createdAt,
        updatedAt: webhook.updatedAt,
      })
      .from(webhook)
      .where(eq(webhook.workspaceId, access.workspaceId))
      .orderBy(desc(webhook.createdAt)),
    db
      .select({
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        createdAt: apiKey.createdAt,
        lastUsedAt: apiKey.lastUsedAt,
        creatorName: user.name,
        creatorEmail: user.email,
        creatorImage: user.image,
      })
      .from(apiKey)
      .innerJoin(user, eq(apiKey.userId, user.id))
      .where(eq(apiKey.workspaceId, access.workspaceId))
      .orderBy(desc(apiKey.createdAt)),
  ]);

  return {
    permissionLevel,
    viewerRole: access.memberRole,
    canManageWorkspaceApi: canManageWorkspaceApi(access.memberRole),
    canCreateApiKeys: canMemberCreateApiKeys(
      access.memberRole,
      permissionLevel,
    ),
    docs: {
      graphql: GRAPHQL_DOCS_URL,
      oauthApplications: OAUTH_APPLICATIONS_DOCS_URL,
      webhooks: WEBHOOKS_DOCS_URL,
    },
    oauthApplications: workspaceApiSettings.oauthApplications,
    webhooks: webhooks.map((item) => ({
      id: item.id,
      label: item.label,
      url: item.url,
      events: normalizeWebhookEvents(item.events),
      enabled: item.enabled ?? true,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    apiKeys: apiKeys.map((item) => ({
      id: item.id,
      name: item.name,
      keyPrefix: item.keyPrefix,
      accessLevel: "Member" as const,
      createdAt: item.createdAt.toISOString(),
      lastUsedAt: item.lastUsedAt ? item.lastUsedAt.toISOString() : null,
      creator: {
        name: item.creatorName,
        email: item.creatorEmail,
        image: item.creatorImage,
      },
    })),
  };
}

async function loadAuthenticatedAccess() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return {
      error: authResponse,
      access: null,
    };
  }

  const access = await getWorkspaceAccess(
    session.user.id,
    "apiKey" in session ? session.apiKey.workspaceId : undefined,
  );
  if (!access) {
    return {
      error: NextResponse.json(
        { error: "No active workspace found" },
        { status: 404 },
      ),
      access: null,
    };
  }

  return { error: null, access };
}

export async function GET() {
  const { error, access } = await loadAuthenticatedAccess();
  if (error || !access) {
    return error;
  }

  return NextResponse.json({
    api: await buildApiPayload(access),
  });
}

export async function PATCH(request: Request) {
  const { error, access } = await loadAuthenticatedAccess();
  if (error || !access) {
    return error;
  }

  if (!canManageWorkspaceApi(access.memberRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    permissionLevel?: unknown;
  } | null;

  if (!body || !isPermissionLevel(body.permissionLevel)) {
    return NextResponse.json(
      { error: "A valid permission level is required." },
      { status: 400 },
    );
  }
  const permissionLevel = body.permissionLevel;

  const currentSettings = asRecord(access.settings);
  const currentSecurity = asRecord(currentSettings.security);
  const currentPermissions = asRecord(currentSecurity.permissions);

  await db
    .update(workspace)
    .set({
      settings: {
        ...currentSettings,
        security: {
          ...currentSecurity,
          permissions: {
            ...currentPermissions,
            apiKeyCreationRole: permissionLevel,
          },
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, access.workspaceId));

  return NextResponse.json({
    api: await buildApiPayload({
      ...access,
      settings: {
        ...currentSettings,
        security: {
          ...currentSecurity,
          permissions: {
            ...currentPermissions,
            apiKeyCreationRole: permissionLevel,
          },
        },
      },
    }),
  });
}

export async function POST(request: Request) {
  const { error, access } = await loadAuthenticatedAccess();
  if (error || !access) {
    return error;
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: "createOAuthApplication";
        name?: unknown;
        redirectUrl?: unknown;
      }
    | {
        action?: "deleteOAuthApplication";
        id?: unknown;
      }
    | {
        action?: "createWebhook";
        label?: unknown;
        url?: unknown;
        events?: unknown;
      }
    | {
        action?: "updateWebhook";
        id?: unknown;
        enabled?: unknown;
      }
    | {
        action?: "deleteWebhook";
        id?: unknown;
      }
    | {
        action?: "createApiKey";
        name?: unknown;
      }
    | {
        action?: "deleteApiKey";
        id?: unknown;
      }
    | null;

  if (!body?.action) {
    return NextResponse.json({ error: "Action is required." }, { status: 400 });
  }

  const permissionLevel = readPermissionLevel(
    asRecord(asRecord(asRecord(access.settings).security).permissions)
      .apiKeyCreationRole,
    "admins",
  );

  if (body.action === "createOAuthApplication") {
    if (!canManageWorkspaceApi(access.memberRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json(
        { error: "Application name is required." },
        { status: 400 },
      );
    }

    const redirectUrlValidation = validateOAuthRedirectUrl(body.redirectUrl);
    if (!redirectUrlValidation.ok) {
      return NextResponse.json(
        { error: redirectUrlValidation.error },
        { status: 400 },
      );
    }
    const redirectUrl = redirectUrlValidation.url;

    const clientId = createOAuthClientId();
    const clientSecret = createSecret("linsec");
    const currentSettings = asRecord(access.settings);
    const currentApiSettings = readWorkspaceApiSettings(currentSettings);
    const nextSettings = {
      ...currentSettings,
      api: serializeWorkspaceApiSettings({
        oauthApplications: [
          {
            id: createId("oauth"),
            name,
            clientId,
            clientSecretPreview: `${clientSecret.slice(0, 12)}…`,
            redirectUrl,
            createdAt: new Date().toISOString(),
          },
          ...currentApiSettings.oauthApplications,
        ],
      }),
    };

    await db
      .update(workspace)
      .set({
        settings: nextSettings,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, access.workspaceId));

    return NextResponse.json({
      api: await buildApiPayload({ ...access, settings: nextSettings }),
      createdCredential: {
        kind: "oauthApplication",
        label: `${name} client secret`,
        secret: clientSecret,
      },
    });
  }

  if (body.action === "deleteOAuthApplication") {
    if (!canManageWorkspaceApi(access.memberRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json(
        { error: "OAuth application id is required." },
        { status: 400 },
      );
    }

    const currentSettings = asRecord(access.settings);
    const currentApiSettings = readWorkspaceApiSettings(currentSettings);
    const nextOauthApplications = currentApiSettings.oauthApplications.filter(
      (application) => application.id !== id,
    );

    if (
      nextOauthApplications.length ===
      currentApiSettings.oauthApplications.length
    ) {
      return NextResponse.json(
        { error: "OAuth application not found." },
        { status: 404 },
      );
    }

    const nextSettings = {
      ...currentSettings,
      api: serializeWorkspaceApiSettings({
        oauthApplications: nextOauthApplications,
      }),
    };

    await db
      .update(workspace)
      .set({
        settings: nextSettings,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, access.workspaceId));

    return NextResponse.json({
      api: await buildApiPayload({ ...access, settings: nextSettings }),
    });
  }

  if (body.action === "createWebhook") {
    if (!canManageWorkspaceApi(access.memberRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = normalizeAbsoluteUrl(body.url);
    const events = normalizeWebhookEvents(body.events);
    const label = typeof body.label === "string" ? body.label.trim() : "";

    if (!url || events.length === 0) {
      return NextResponse.json(
        { error: "A webhook URL and at least one event are required." },
        { status: 400 },
      );
    }

    await db.insert(webhook).values({
      url,
      label: label || null,
      workspaceId: access.workspaceId,
      secret: createSecret("whsec"),
      enabled: true,
      events,
    });

    return NextResponse.json({
      api: await buildApiPayload(access),
    });
  }

  if (body.action === "updateWebhook") {
    if (!canManageWorkspaceApi(access.memberRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = typeof body.id === "string" ? body.id : "";
    if (!id || typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "Webhook id and enabled state are required." },
        { status: 400 },
      );
    }

    const updated = await db
      .update(webhook)
      .set({ enabled: body.enabled, updatedAt: new Date() })
      .where(
        and(eq(webhook.id, id), eq(webhook.workspaceId, access.workspaceId)),
      )
      .returning({ id: webhook.id });

    if (updated.length === 0) {
      return NextResponse.json(
        { error: "Webhook not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ api: await buildApiPayload(access) });
  }

  if (body.action === "deleteWebhook") {
    if (!canManageWorkspaceApi(access.memberRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json(
        { error: "Webhook id is required." },
        { status: 400 },
      );
    }

    const deleted = await db
      .delete(webhook)
      .where(
        and(eq(webhook.id, id), eq(webhook.workspaceId, access.workspaceId)),
      )
      .returning({ id: webhook.id });

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: "Webhook not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ api: await buildApiPayload(access) });
  }

  if (body.action === "deleteApiKey") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json(
        { error: "API key id is required." },
        { status: 400 },
      );
    }

    const canDeleteAnyKey = canManageWorkspaceApi(access.memberRole);
    if (!canDeleteAnyKey && access.memberRole === "guest") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const deleted = await db
      .delete(apiKey)
      .where(
        canDeleteAnyKey
          ? and(eq(apiKey.id, id), eq(apiKey.workspaceId, access.workspaceId))
          : and(
              eq(apiKey.id, id),
              eq(apiKey.workspaceId, access.workspaceId),
              eq(apiKey.userId, access.userId),
            ),
      )
      .returning({ id: apiKey.id });

    if (deleted.length === 0) {
      return NextResponse.json(
        { error: "API key not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ api: await buildApiPayload(access) });
  }

  if (body.action !== "createApiKey") {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  if (!canMemberCreateApiKeys(access.memberRole, permissionLevel)) {
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

  const secret = createSecret("lin_api");
  await db.insert(apiKey).values({
    name,
    keyHash: createApiKeyHash(secret),
    keyPrefix: `${secret.slice(0, 12)}…`,
    userId: access.userId,
    workspaceId: access.workspaceId,
  });

  return NextResponse.json({
    api: await buildApiPayload(access),
    createdCredential: {
      kind: "apiKey",
      label: `${name} API key`,
      secret,
    },
  });
}
