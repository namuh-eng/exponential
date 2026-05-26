import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const accessLimitMock = vi.fn();
const apiKeyLimitMock = vi.fn();
const webhooksOrderByMock = vi.fn();
const apiKeysOrderByMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const insertValuesMock = vi.fn();
let selectCallCount = 0;
let requestHeaders = new Headers();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveRequestWorkspaceIdMock,
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
}));

vi.mock("@/lib/api-settings", () => ({
  GRAPHQL_DOCS_URL: "https://docs.test/graphql",
  OAUTH_APPLICATIONS_DOCS_URL: "https://docs.test/oauth",
  WEBHOOKS_DOCS_URL: "https://docs.test/webhooks",
  asRecord: (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {},
  canManageWorkspaceApi: vi.fn(
    (role: string) => role === "owner" || role === "admin",
  ),
  canMemberCreateApiKeys: vi.fn((role: string, permissionLevel: string) => {
    if (role === "owner" || role === "admin") {
      return true;
    }

    return permissionLevel === "members";
  }),
  isPermissionLevel: vi.fn(
    (value: unknown) => value === "admins" || value === "members",
  ),
  normalizeWebhookEvents: vi.fn((events: unknown) =>
    Array.isArray(events)
      ? events.filter((event): event is string =>
          ["created", "updated", "deleted"].includes(String(event)),
        )
      : [],
  ),
  validateWebhookUrl: vi.fn((value: unknown) => {
    if (typeof value !== "string" || !value.trim()) {
      return { ok: false, error: "Webhook URL is required." };
    }
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "https:") {
        return { ok: false, error: "Webhook URL must use HTTPS." };
      }
      return { ok: true, url: url.toString() };
    } catch {
      return { ok: false, error: "Webhook URL must be a valid absolute URL." };
    }
  }),
  readPermissionLevel: vi.fn((value: unknown, fallback: string) =>
    value === "admins" || value === "members" ? value : fallback,
  ),
  readWorkspaceApiSettings: vi.fn(() => ({ oauthApplications: [] })),
  serializeWorkspaceApiSettings: vi.fn((value: unknown) => value),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      selectCallCount += 1;

      if ("apiKeyId" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: apiKeyLimitMock,
                }),
              }),
            }),
          }),
        };
      }

      if ("memberRole" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              limit: accessLimitMock,
            }),
          }),
        };
      }

      if ("label" in selection && "url" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: webhooksOrderByMock,
            }),
          }),
        };
      }

      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: apiKeysOrderByMock,
            }),
          }),
        }),
      };
    }),
    update: vi.fn(() => ({
      set: (...setArgs: unknown[]) => {
        updateSetMock(...setArgs);
        return {
          where: (...whereArgs: unknown[]) => {
            updateWhereMock(...whereArgs);
            return Promise.resolve();
          },
        };
      },
    })),
    insert: vi.fn(() => ({ values: insertValuesMock })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
}));

describe("current workspace api route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    insertValuesMock.mockResolvedValue(undefined);
    selectCallCount = 0;
    requestHeaders = new Headers();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    apiKeyLimitMock.mockResolvedValue([]);
    accessLimitMock.mockResolvedValue([
      {
        workspaceId: "workspace-1",
        settings: {
          security: { permissions: { apiKeyCreationRole: "admins" } },
        },
        memberRole: "owner",
      },
    ]);
    webhooksOrderByMock.mockResolvedValue([
      {
        id: "webhook-1",
        label: "Prod",
        url: "https://hooks.test/prod",
        enabled: true,
        events: ["created"],
        createdAt: new Date("2026-04-23T10:00:00.000Z"),
        updatedAt: new Date("2026-04-23T10:30:00.000Z"),
      },
    ]);
    apiKeysOrderByMock.mockResolvedValue([
      {
        id: "key-1",
        name: "CI",
        keyPrefix: "lin_api_123…",
        createdAt: new Date("2026-04-23T11:00:00.000Z"),
        lastUsedAt: null,
        creatorName: "Ashley",
        creatorEmail: "ashley@test.com",
        creatorImage: null,
      },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/workspaces/current/api/route");

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns 404 when no active workspace exists", async () => {
    resolveRequestWorkspaceIdMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/workspaces/current/api/route");

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No active workspace found",
    });
  });

  it("accepts a generated member API key bearer token without a browser session", async () => {
    getSessionMock.mockResolvedValue(null);
    requestHeaders = new Headers({
      authorization: "Bearer lin_api_validsecret",
    });
    apiKeyLimitMock.mockResolvedValue([
      {
        apiKeyId: "api-key-1",
        userId: "user-1",
        userName: "Ashley",
        userEmail: "ashley@test.com",
        userImage: null,
        workspaceId: "workspace-1",
        memberRole: "owner",
      },
    ]);
    const { GET } = await import("legacy-api/workspaces/current/api/route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(resolveRequestWorkspaceIdMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith({
      lastUsedAt: expect.any(Date),
    });
    await expect(response.json()).resolves.toMatchObject({
      api: {
        viewerRole: "owner",
        apiKeys: [
          {
            id: "key-1",
            name: "CI",
          },
        ],
      },
    });
  });

  it("enforces workspace IP restrictions for the workspace API settings route", async () => {
    accessLimitMock.mockResolvedValue([
      {
        workspaceId: "workspace-1",
        settings: {
          security: {
            permissions: { apiKeyCreationRole: "admins" },
            ipRestrictions: [
              { range: "203.0.113.0/24", enabled: true, type: "allow" },
            ],
          },
        },
        memberRole: "owner",
      },
    ]);
    const { GET } = await import("legacy-api/workspaces/current/api/route");

    const denied = await GET(
      new Request("https://app.test/api/workspaces/current/api", {
        headers: { "x-forwarded-for": "198.51.100.42" },
      }),
    );
    expect(denied?.status).toBe(403);
    await expect(denied?.json()).resolves.toMatchObject({
      code: "workspace_ip_restricted",
      reason: "ip_not_allowed",
    });

    const allowed = await GET(
      new Request("https://app.test/api/workspaces/current/api", {
        headers: { "x-forwarded-for": "203.0.113.42" },
      }),
    );
    expect(allowed?.status).toBe(200);
  });

  it("rejects malformed API key bearer tokens", async () => {
    getSessionMock.mockResolvedValue(null);
    requestHeaders = new Headers({
      authorization: "Bearer not_linear",
    });
    const { GET } = await import("legacy-api/workspaces/current/api/route");

    const response = await GET();

    expect(response.status).toBe(401);
    expect(apiKeyLimitMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("rejects unknown API key bearer tokens without updating lastUsedAt", async () => {
    getSessionMock.mockResolvedValue(null);
    requestHeaders = new Headers({
      authorization: "Bearer lin_api_unknown",
    });
    apiKeyLimitMock.mockResolvedValue([]);
    const { GET } = await import("legacy-api/workspaces/current/api/route");

    const response = await GET();

    expect(response.status).toBe(401);
    expect(apiKeyLimitMock).toHaveBeenCalledWith(1);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("returns the workspace api payload", async () => {
    const { GET } = await import("legacy-api/workspaces/current/api/route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      api: {
        permissionLevel: "admins",
        viewerRole: "owner",
        canManageWorkspaceApi: true,
        canCreateApiKeys: true,
        docs: {
          graphql: "https://docs.test/graphql",
          oauthApplications: "https://docs.test/oauth",
          webhooks: "https://docs.test/webhooks",
        },
        oauthApplications: [],
        webhooks: [
          {
            id: "webhook-1",
            label: "Prod",
            url: "https://hooks.test/prod",
            events: ["created"],
            enabled: true,
            createdAt: "2026-04-23T10:00:00.000Z",
            updatedAt: "2026-04-23T10:30:00.000Z",
          },
        ],
        apiKeys: [
          {
            id: "key-1",
            name: "CI",
            keyPrefix: "lin_api_123…",
            accessLevel: "Member",
            createdAt: "2026-04-23T11:00:00.000Z",
            lastUsedAt: null,
            creator: {
              name: "Ashley",
              email: "ashley@test.com",
              image: null,
            },
          },
        ],
      },
    });
  });

  it("rejects invalid webhook URLs without inserting", async () => {
    const { POST } = await import("legacy-api/workspaces/current/api/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "POST",
        body: JSON.stringify({
          action: "createWebhook",
          label: "Bad hook",
          url: "not-a-url",
          events: ["created"],
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Webhook URL must be a valid absolute URL.",
    });
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("requires at least one scoped webhook event", async () => {
    const { POST } = await import("legacy-api/workspaces/current/api/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "POST",
        body: JSON.stringify({
          action: "createWebhook",
          label: "No scope",
          url: "https://hooks.test/linear",
          events: ["unknown"],
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "At least one webhook event is required.",
    });
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("creates webhooks with normalized HTTPS URL and scoped issue events", async () => {
    const { POST } = await import("legacy-api/workspaces/current/api/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "POST",
        body: JSON.stringify({
          action: "createWebhook",
          label: "Issue sync",
          url: " https://hooks.test/linear ",
          events: ["created", "deleted"],
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Issue sync",
        url: "https://hooks.test/linear",
        events: ["created", "deleted"],
        enabled: true,
      }),
    );
  });

  it("forbids permission updates for non-managers", async () => {
    accessLimitMock.mockResolvedValue([
      {
        workspaceId: "workspace-1",
        settings: {
          security: { permissions: { apiKeyCreationRole: "admins" } },
        },
        memberRole: "member",
      },
    ]);
    const { PATCH } = await import("legacy-api/workspaces/current/api/route");

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "PATCH",
        body: JSON.stringify({ permissionLevel: "members" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("rejects invalid permission levels", async () => {
    const { PATCH } = await import("legacy-api/workspaces/current/api/route");

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "PATCH",
        body: JSON.stringify({ permissionLevel: "owners-only" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A valid permission level is required.",
    });
  });

  it("updates permission level and returns refreshed api payload", async () => {
    const { PATCH } = await import("legacy-api/workspaces/current/api/route");

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "PATCH",
        body: JSON.stringify({ permissionLevel: "members" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: {
          security: { permissions: { apiKeyCreationRole: "members" } },
        },
        updatedAt: expect.any(Date),
      }),
    );
    expect(updateWhereMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      api: {
        permissionLevel: "members",
        canCreateApiKeys: true,
      },
    });
  });
});
