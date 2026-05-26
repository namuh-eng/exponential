import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const currentWorkspaceLimitMock = vi.fn();
const duplicateSlugLimitMock = vi.fn();
const remainingMembershipLimitMock = vi.fn();
const deleteWhereMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
let selectCallCount = 0;

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/workspace-creation", () => ({
  MAX_WORKSPACE_NAME_LENGTH: 64,
  validateWorkspaceSlug: vi.fn((value: string) => {
    if (value.length < 2 || value.length > 63)
      return "URL slug must be between 2 and 63 characters";
    if (value.trim() !== value)
      return "URL slug cannot include leading or trailing spaces";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
      return "URL slug can only use lowercase letters, numbers, and single hyphens";
    return null;
  }),
  validateWorkspaceName: vi.fn((value: string) => {
    if (!value.trim()) {
      return "Workspace name is required";
    }

    if (value.length > 64) {
      return "Workspace name is too long";
    }

    return null;
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      selectCallCount += 1;

      if (selection && "name" in selection && "role" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              limit: currentWorkspaceLimitMock,
            }),
          }),
        };
      }

      if (selection && "workspaceId" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: remainingMembershipLimitMock,
              }),
            }),
          }),
        };
      }

      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: duplicateSlugLimitMock,
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
    delete: vi.fn(() => ({
      where: (...whereArgs: unknown[]) => {
        deleteWhereMock(...whereArgs);
        return Promise.resolve();
      },
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("current workspace route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCallCount = 0;
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    currentWorkspaceLimitMock.mockResolvedValue([
      {
        id: "workspace-1",
        name: "Namuh",
        urlSlug: "namuh",
        logoUrl: "https://img.test/logo.png",
        settings: {
          region: "Korea",
          fiscalMonth: "april",
          welcomeMessage: "Hello",
        },
        role: "owner",
      },
    ]);
    duplicateSlugLimitMock.mockResolvedValue([]);
    remainingMembershipLimitMock.mockResolvedValue([
      { workspaceId: "workspace-2" },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/workspaces/current/route");

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns 404 when there is no active workspace", async () => {
    resolveActiveWorkspaceIdMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/workspaces/current/route");

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "No active workspace found",
    });
  });

  it("returns the current workspace payload", async () => {
    const { GET } = await import("legacy-api/workspaces/current/route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workspace: {
        id: "workspace-1",
        name: "Namuh",
        urlSlug: "namuh",
        logo: "https://img.test/logo.png",
        region: "Korea",
        fiscalMonth: "april",
        plan: "free",
        welcomeMessage: "Hello",
      },
    });
  });

  it("rejects invalid workspace names on patch", async () => {
    const { PATCH } = await import("legacy-api/workspaces/current/route");

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current", {
        method: "PATCH",
        body: JSON.stringify({ name: "   " }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Workspace name is required",
    });
  });

  it("rejects invalid url slugs without sanitizing", async () => {
    const { PATCH } = await import("legacy-api/workspaces/current/route");

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current", {
        method: "PATCH",
        body: JSON.stringify({ urlSlug: "Bad Slug!" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    expect(updateSetMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error:
        "URL slug can only use lowercase letters, numbers, and single hyphens",
    });
  });

  it("rejects duplicate url slugs", async () => {
    duplicateSlugLimitMock.mockResolvedValue([{ id: "workspace-2" }]);
    const { PATCH } = await import("legacy-api/workspaces/current/route");

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current", {
        method: "PATCH",
        body: JSON.stringify({ urlSlug: "taken" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This URL is already taken",
    });
  });

  it("updates workspace settings when patch values are valid", async () => {
    const { PATCH } = await import("legacy-api/workspaces/current/route");

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Namuh Labs",
          urlSlug: "namuh-labs",
          logo: null,
          fiscalMonth: "october",
          welcomeMessage: "Welcome to QA",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Namuh Labs",
        urlSlug: "namuh-labs",
        logoUrl: null,
        settings: {
          region: "Korea",
          fiscalMonth: "october",
          welcomeMessage: "Welcome to QA",
        },
        updatedAt: expect.any(Date),
      }),
    );
    expect(updateWhereMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      workspace: {
        id: "workspace-1",
        name: "Namuh Labs",
        urlSlug: "namuh-labs",
        logo: null,
        region: "Korea",
        fiscalMonth: "october",
        welcomeMessage: "Welcome to QA",
        plan: "free",
      },
    });
  });

  it("blocks deletes for non-admin members", async () => {
    currentWorkspaceLimitMock.mockResolvedValue([
      {
        id: "workspace-1",
        name: "Namuh",
        urlSlug: "namuh",
        logoUrl: null,
        settings: { region: "Korea", fiscalMonth: "april" },
        role: "member",
      },
    ]);
    const { DELETE } = await import("legacy-api/workspaces/current/route");

    const response = await DELETE();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Only workspace admins can delete a workspace",
    });
  });

  it("deletes the workspace and redirects to the next membership", async () => {
    const { DELETE } = await import("legacy-api/workspaces/current/route");

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(deleteWhereMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: true,
      redirectTo: "/",
    });
    expect(response.cookies.get("activeWorkspaceId")?.value).toBe(
      "workspace-2",
    );
  });
});
