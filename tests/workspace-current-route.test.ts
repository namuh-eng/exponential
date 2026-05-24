import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const currentWorkspaceLimitMock = vi.fn();
const duplicateWorkspaceLimitMock = vi.fn();
const remainingMembershipLimitMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const deleteWhereMock = vi.fn();

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

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      if (
        "name" in selection &&
        "logoUrl" in selection &&
        "role" in selection
      ) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              limit: currentWorkspaceLimitMock,
            }),
          }),
        };
      }

      if (Object.keys(selection).length === 1 && "id" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: duplicateWorkspaceLimitMock,
            }),
          }),
        };
      }

      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: remainingMembershipLimitMock,
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
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
    });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    currentWorkspaceLimitMock.mockResolvedValue([
      {
        id: "workspace-1",
        name: "Acme Corp",
        urlSlug: "acme",
        logoUrl: null,
        settings: {
          region: "Canada",
          fiscalMonth: "april",
        },
        role: "owner",
      },
    ]);
    duplicateWorkspaceLimitMock.mockResolvedValue([]);
    remainingMembershipLimitMock.mockResolvedValue([
      { workspaceId: "workspace-2" },
    ]);
  });

  it("returns the active workspace with normalized settings", async () => {
    const { GET } = await import("@/app/api/workspaces/current/route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      workspace: {
        id: "workspace-1",
        name: "Acme Corp",
        urlSlug: "acme",
        logo: null,
        region: "Canada",
        fiscalMonth: "april",
        plan: "free",
        welcomeMessage: "",
      },
    });
  });

  it("persists workspace updates and merges settings", async () => {
    const { PATCH } = await import("@/app/api/workspaces/current/route");
    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Acme QA",
          urlSlug: "acme-qa",
          logo: "data:image/png;base64,logo",
          fiscalMonth: "october",
          welcomeMessage: "Welcome",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Acme QA",
        urlSlug: "acme-qa",
        logoUrl: "data:image/png;base64,logo",
        settings: {
          region: "Canada",
          fiscalMonth: "october",
          welcomeMessage: "Welcome",
        },
      }),
    );
    expect(updateWhereMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      workspace: {
        id: "workspace-1",
        name: "Acme QA",
        urlSlug: "acme-qa",
        logo: "data:image/png;base64,logo",
        region: "Canada",
        fiscalMonth: "october",
        plan: "free",
        welcomeMessage: "Welcome",
      },
    });
  });

  it("deletes the workspace and moves the active cookie to the next membership", async () => {
    const { DELETE } = await import("@/app/api/workspaces/current/route");
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
