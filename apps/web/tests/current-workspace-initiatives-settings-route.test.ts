import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  resolveActiveWorkspaceId: vi.fn(),
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  accessRows: [
    {
      workspaceId: "workspace-1",
      settings: {},
      role: "admin",
    },
  ],
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: mocks.resolveActiveWorkspaceId,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.dbSelect,
    update: mocks.dbUpdate,
  },
}));

function setupDb() {
  const selectBuilder = {
    from: vi.fn(() => selectBuilder),
    innerJoin: vi.fn(() => selectBuilder),
    where: vi.fn(() => selectBuilder),
    limit: vi.fn(() => Promise.resolve(mocks.accessRows)),
  };
  mocks.dbSelect.mockReturnValue(selectBuilder);
  mocks.updateWhere.mockResolvedValue(undefined);
  mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  mocks.dbUpdate.mockReturnValue({ set: mocks.updateSet });
}

function authenticate() {
  mocks.requireApiSession.mockResolvedValue({
    response: null,
    session: { user: { id: "user-1" } },
  });
}

describe("current workspace initiative settings route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.accessRows = [
      {
        workspaceId: "workspace-1",
        settings: {},
        role: "admin",
      },
    ];
    mocks.resolveActiveWorkspaceId.mockResolvedValue("workspace-1");
    authenticate();
    setupDb();
  });

  it("returns defaults and viewer permissions", async () => {
    const { GET } = await import(
      "legacy-api/workspaces/current/initiatives-settings/route"
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

  it("persists valid admin patches under workspace feature settings", async () => {
    mocks.accessRows = [
      {
        workspaceId: "workspace-1",
        settings: { plan: "pro", features: { cycles: { enabled: true } } },
        role: "owner",
      },
    ];
    const { PATCH } = await import(
      "legacy-api/workspaces/current/initiatives-settings/route"
    );

    const response = await PATCH(
      new Request(
        "http://localhost/api/workspaces/current/initiatives-settings",
        {
          method: "PATCH",
          body: JSON.stringify({
            enabled: false,
            projectRollups: false,
            visibility: "teams",
          }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: {
          plan: "pro",
          features: {
            cycles: { enabled: true },
            initiatives: {
              enabled: false,
              projectRollups: false,
              visibility: "teams",
              roadmapMode: "all",
            },
          },
        },
        updatedAt: expect.any(Date),
      }),
    );
    await expect(response.json()).resolves.toEqual({
      initiativesSettings: {
        enabled: false,
        projectRollups: false,
        visibility: "teams",
        roadmapMode: "all",
      },
      viewerRole: "owner",
      canManage: true,
    });
  });

  it("rejects unauthorized members and invalid values", async () => {
    mocks.accessRows = [
      { workspaceId: "workspace-1", settings: {}, role: "member" },
    ];
    const { PATCH } = await import(
      "legacy-api/workspaces/current/initiatives-settings/route"
    );

    let response = await PATCH(
      new Request(
        "http://localhost/api/workspaces/current/initiatives-settings",
        {
          method: "PATCH",
          body: JSON.stringify({ enabled: false }),
        },
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.dbUpdate).not.toHaveBeenCalled();

    mocks.accessRows = [
      { workspaceId: "workspace-1", settings: {}, role: "admin" },
    ];
    response = await PATCH(
      new Request(
        "http://localhost/api/workspaces/current/initiatives-settings",
        {
          method: "PATCH",
          body: JSON.stringify({ visibility: "private" }),
        },
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Visibility must be workspace or teams",
    });
  });
});
