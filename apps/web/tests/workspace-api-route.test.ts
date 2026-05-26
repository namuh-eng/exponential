import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const workspaceAccessLimitMock = vi.fn();
const webhookOrderByMock = vi.fn();
const apiKeyOrderByMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const workspaceInsertValuesMock = vi.fn();
const apiKeyInsertValuesMock = vi.fn();
const webhookInsertValuesMock = vi.fn();
const updateReturningMock = vi.fn();
const deleteWhereMock = vi.fn();
const deleteReturningMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
  resolveRequestWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");

  return {
    db: {
      select: vi.fn((selection: Record<string, unknown>) => {
        if (
          "workspaceId" in selection &&
          "settings" in selection &&
          "memberRole" in selection
        ) {
          return {
            from: vi.fn().mockReturnValue({
              innerJoin: vi.fn().mockReturnValue({
                limit: workspaceAccessLimitMock,
              }),
            }),
          };
        }

        if (
          "id" in selection &&
          "label" in selection &&
          "url" in selection &&
          "events" in selection
        ) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: webhookOrderByMock,
              }),
            }),
          };
        }

        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: apiKeyOrderByMock,
              }),
            }),
          }),
        };
      }),
      update: vi.fn(() => ({
        set: (...args: unknown[]) => {
          updateSetMock(...args);
          return {
            where: (...whereArgs: unknown[]) => {
              updateWhereMock(...whereArgs);
              return Object.assign(Promise.resolve(), {
                returning: (...returningArgs: unknown[]) => {
                  updateReturningMock(...returningArgs);
                  return Promise.resolve([{ id: "updated-1" }]);
                },
              });
            },
          };
        },
      })),
      delete: vi.fn(() => ({
        where: (...whereArgs: unknown[]) => {
          deleteWhereMock(...whereArgs);
          return {
            returning: (...returningArgs: unknown[]) => {
              deleteReturningMock(...returningArgs);
              return Promise.resolve([{ id: "deleted-1" }]);
            },
          };
        },
      })),
      insert: vi.fn((table: unknown) => {
        if (table === schema.webhook) {
          return {
            values: (...args: unknown[]) => {
              webhookInsertValuesMock(...args);
              return Promise.resolve();
            },
          };
        }

        if (table === schema.apiKey) {
          return {
            values: (...args: unknown[]) => {
              apiKeyInsertValuesMock(...args);
              return Promise.resolve();
            },
          };
        }

        return {
          values: (...args: unknown[]) => {
            workspaceInsertValuesMock(...args);
            return Promise.resolve();
          },
        };
      }),
    },
  };
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

function buildAccess(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    workspaceId: "workspace-1",
    settings: {
      security: {
        permissions: {
          apiKeyCreationRole: "admins",
        },
      },
      api: {
        oauthApplications: [],
      },
    },
    memberRole: "owner",
    ...overrides,
  };
}

describe("workspace api route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
    });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    workspaceAccessLimitMock.mockResolvedValue([buildAccess()]);
    webhookOrderByMock.mockResolvedValue([]);
    apiKeyOrderByMock.mockResolvedValue([]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/workspaces/current/api/route");

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 404 when there is no active workspace", async () => {
    resolveActiveWorkspaceIdMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/workspaces/current/api/route");

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No active workspace found",
    });
  });

  it("blocks permission updates for non-managers", async () => {
    workspaceAccessLimitMock.mockResolvedValue([
      buildAccess({ memberRole: "member" }),
    ]);
    const { PATCH } = await import("legacy-api/workspaces/current/api/route");

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "PATCH",
        body: JSON.stringify({ permissionLevel: "members" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("rejects unsupported actions", async () => {
    const { POST } = await import("legacy-api/workspaces/current/api/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "POST",
        body: JSON.stringify({ action: "rotateWebhook" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported action.",
    });
  });

  it("rejects api key creation when the viewer lacks permission", async () => {
    workspaceAccessLimitMock.mockResolvedValue([
      buildAccess({
        memberRole: "guest",
        settings: {
          security: {
            permissions: {
              apiKeyCreationRole: "members",
            },
          },
          api: {
            oauthApplications: [],
          },
        },
      }),
    ]);
    const { POST } = await import("legacy-api/workspaces/current/api/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "POST",
        body: JSON.stringify({
          action: "createApiKey",
          name: "Guest automation",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "You do not have permission to create API keys.",
    });
    expect(apiKeyInsertValuesMock).not.toHaveBeenCalled();
  });

  it("rejects malformed webhook creation requests", async () => {
    const { POST } = await import("legacy-api/workspaces/current/api/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "POST",
        body: JSON.stringify({
          action: "createWebhook",
          label: "Broken hook",
          url: "ftp://example.com/hook",
          events: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
    // The webhook URL is validated before the events array, so an ftp:// URL
    // surfaces the protocol error rather than the combined-validation message.
    await expect(response.json()).resolves.toEqual({
      error: "Webhook URL must use HTTPS.",
    });
    expect(webhookInsertValuesMock).not.toHaveBeenCalled();
  });

  it("deletes an OAuth application from workspace settings", async () => {
    workspaceAccessLimitMock.mockResolvedValue([
      buildAccess({
        settings: {
          security: { permissions: { apiKeyCreationRole: "admins" } },
          api: {
            oauthApplications: [
              {
                id: "oauth_1",
                name: "Old app",
                clientId: "lin_1",
                clientSecretPreview: "linsec_1…",
                redirectUrl: "https://example.com/callback",
                createdAt: "2026-04-08T10:00:00.000Z",
              },
            ],
          },
        },
      }),
    ]);
    const { POST } = await import("legacy-api/workspaces/current/api/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "POST",
        body: JSON.stringify({
          action: "deleteOAuthApplication",
          id: "oauth_1",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          api: { oauthApplications: [] },
        }),
      }),
    );
  });

  it("updates a webhook only within the current workspace", async () => {
    const { POST } = await import("legacy-api/workspaces/current/api/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "POST",
        body: JSON.stringify({
          action: "updateWebhook",
          id: "webhook-1",
          enabled: false,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(updateWhereMock).toHaveBeenCalled();
    expect(updateReturningMock).toHaveBeenCalled();
  });

  it("deletes a webhook only within the current workspace", async () => {
    const { POST } = await import("legacy-api/workspaces/current/api/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "POST",
        body: JSON.stringify({ action: "deleteWebhook", id: "webhook-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(deleteWhereMock).toHaveBeenCalled();
    expect(deleteReturningMock).toHaveBeenCalled();
  });

  it("lets members revoke their own API keys", async () => {
    workspaceAccessLimitMock.mockResolvedValue([
      buildAccess({
        memberRole: "member",
        settings: {
          security: { permissions: { apiKeyCreationRole: "members" } },
          api: { oauthApplications: [] },
        },
      }),
    ]);
    const { POST } = await import("legacy-api/workspaces/current/api/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "POST",
        body: JSON.stringify({ action: "deleteApiKey", id: "api-key-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(deleteWhereMock).toHaveBeenCalled();
  });

  it("blocks lifecycle mutations for non-managers when required", async () => {
    workspaceAccessLimitMock.mockResolvedValue([
      buildAccess({ memberRole: "member" }),
    ]);
    const { POST } = await import("legacy-api/workspaces/current/api/route");

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/api", {
        method: "POST",
        body: JSON.stringify({ action: "deleteWebhook", id: "webhook-1" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(deleteWhereMock).not.toHaveBeenCalled();
  });
});
