import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const currentWorkspaceLimitMock = vi.fn();
const updateSetMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          limit: currentWorkspaceLimitMock,
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values) => {
        updateSetMock(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
  },
}));

describe("current workspace initiative settings route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: { user: { id: "user-1" } },
    });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    currentWorkspaceLimitMock.mockResolvedValue([
      {
        workspaceId: "workspace-1",
        role: "admin",
        settings: {
          features: {
            initiatives: {
              enabled: true,
              projectRollups: true,
              visibility: "workspace",
              roadmapMode: "all",
            },
          },
        },
      },
    ]);
  });

  it("GET returns settings and permissions", async () => {
    const { GET } = await import(
      "@/app/api/workspaces/current/initiatives-settings/route"
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      initiativesSettings: {
        enabled: true,
        projectRollups: true,
        visibility: "workspace",
        roadmapMode: "all",
      },
      viewerRole: "admin",
      canManage: true,
    });
  });

  it("PATCH persists admin changes", async () => {
    const { PATCH } = await import(
      "@/app/api/workspaces/current/initiatives-settings/route"
    );

    const response = await PATCH(
      new Request(
        "https://app.test/api/workspaces/current/initiatives-settings",
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: false, visibility: "teams" }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          features: expect.objectContaining({
            initiatives: expect.objectContaining({
              enabled: false,
              visibility: "teams",
            }),
          }),
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      initiativesSettings: { enabled: false, visibility: "teams" },
    });
  });

  it("PATCH blocks non-admin members", async () => {
    currentWorkspaceLimitMock.mockResolvedValue([
      { workspaceId: "workspace-1", role: "member", settings: {} },
    ]);
    const { PATCH } = await import(
      "@/app/api/workspaces/current/initiatives-settings/route"
    );

    const response = await PATCH(
      new Request(
        "https://app.test/api/workspaces/current/initiatives-settings",
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: false }),
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("PATCH rejects invalid values", async () => {
    const { PATCH } = await import(
      "@/app/api/workspaces/current/initiatives-settings/route"
    );

    const response = await PATCH(
      new Request(
        "https://app.test/api/workspaces/current/initiatives-settings",
        {
          method: "PATCH",
          body: JSON.stringify({ projectRollups: "yes" }),
        },
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Project rollups must be a boolean",
    });
  });
});
