import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const membershipsLimitMock = vi.fn();
const initiativesWhereMock = vi.fn();
const linkedProjectsInnerJoinMock = vi.fn();
const initiativeNameRowsMock = vi.fn();
const issueCountsWhereMock = vi.fn();
const completedStatesWhereMock = vi.fn();
const completedIssueCountsWhereMock = vi.fn();
const workspaceLimitMock = vi.fn();
const txUpdateSetMock = vi.fn();
const txUpdateWhereMock = vi.fn();
const deleteWhereMock = vi.fn();
const deleteReturningMock = vi.fn();
let selectCallCount = 0;

vi.mock("@/lib/active-workspace", () => ({
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/initiative-detail", () => ({
  readInitiativeSettings: vi.fn((settings: unknown) => ({
    updates: (settings as { updates?: unknown[] })?.updates ?? [],
    activity: (settings as { activity?: unknown[] })?.activity ?? [],
  })),
  makeInitiativeUpdateEntry: vi.fn(({ health, body }) => ({
    health,
    body,
    createdAt: new Date().toISOString(),
  })),
  makeInitiativeActivityEntry: vi.fn(({ type, message }) => ({
    id: "activity-1",
    type,
    message,
    actorName: "Test User",
    actorImage: null,
    createdAt: new Date().toISOString(),
  })),
  isInitiativeHealth: vi.fn((value: unknown) =>
    ["unknown", "onTrack", "atRisk", "offTrack"].includes(String(value)),
  ),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      selectCallCount += 1;

      // resolveWorkspaceId lookup
      if (selection && "workspaceId" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: membershipsLimitMock,
              }),
            }),
          }),
        };
      }

      // workspace initiative settings
      if (
        selection &&
        Object.keys(selection).length === 1 &&
        "settings" in selection
      ) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: workspaceLimitMock,
            }),
          }),
        };
      }

      // buildInitiativeDetailResponse - primary fetch
      if (!selection || Object.keys(selection).length === 0) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: initiativesWhereMock,
            }),
          }),
        };
      }

      // buildInitiativeDetailResponse - linked projects OR availableProjects
      if (selection && "slug" in selection && "icon" in selection) {
        // This covers linkedProjects AND availableProjects
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(linkedProjectsInnerJoinMock()),
            }),
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
      }

      if (selection && "key" in selection && "icon" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
            where: vi.fn().mockResolvedValue([]),
          }),
        };
      }

      if (selection && "name" in selection && "image" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi
                .fn()
                .mockResolvedValue([
                  { id: "user-1", name: "Test User", image: null },
                ]),
            }),
            where: vi.fn().mockReturnValue({
              limit: vi
                .fn()
                .mockResolvedValue([
                  { id: "user-1", name: "Test User", image: null },
                ]),
            }),
          }),
        };
      }

      if (selection && "name" in selection) {
        const makeWhereResult = () => {
          const whereResult = Promise.resolve(
            initiativeNameRowsMock(),
          ) as unknown as Promise<unknown[]> & {
            limit: ReturnType<typeof vi.fn>;
          };
          whereResult.limit = vi
            .fn()
            .mockResolvedValue(initiativeNameRowsMock());
          return whereResult;
        };
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(makeWhereResult()),
          }),
        };
      }

      // buildInitiativeDetailResponse - total issue counts
      if (selection && "issueCount" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValue(issueCountsWhereMock()),
            }),
          }),
        };
      }

      // buildInitiativeDetailResponse - completed states
      if (
        selection &&
        "id" in selection &&
        Object.keys(selection).length === 1
      ) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(completedStatesWhereMock()),
          }),
        };
      }

      // buildInitiativeDetailResponse - completed issue counts
      if (selection && "completedCount" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi
                .fn()
                .mockResolvedValue(completedIssueCountsWhereMock()),
            }),
          }),
        };
      }

      return { from: vi.fn().mockReturnValue({ where: vi.fn() }) };
    }),
    delete: vi.fn(() => ({
      where: (...whereArgs: unknown[]) => {
        deleteWhereMock(...whereArgs);
        return {
          returning: deleteReturningMock,
        };
      },
    })),
    transaction: vi.fn(
      async (
        cb: (tx: {
          select: unknown;
          insert: unknown;
          update: unknown;
          delete: unknown;
        }) => Promise<unknown>,
      ) =>
        cb({
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
          insert: vi
            .fn()
            .mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
          update: vi.fn(() => ({
            set: (...setArgs: unknown[]) => {
              txUpdateSetMock(...setArgs);
              return {
                where: (...whereArgs: unknown[]) => {
                  txUpdateWhereMock(...whereArgs);
                  return {
                    returning: vi.fn().mockResolvedValue([]),
                  };
                },
              };
            },
          })),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
    ),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: vi.fn(),
  }),
}));

describe("initiative detail route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCallCount = 0;
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    membershipsLimitMock.mockResolvedValue([{ workspaceId: "workspace-1" }]);
    initiativesWhereMock.mockResolvedValue([
      {
        id: "init-1",
        name: "Growth",
        description: "Details",
        status: "active",
        ownerId: "user-1",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        targetDate: new Date("2026-09-30T00:00:00.000Z"),
        timeframe: "Q3 2026",
        health: "onTrack",
        parentInitiativeId: null,
        settings: { updates: [] },
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);
    linkedProjectsInnerJoinMock.mockReturnValue([
      {
        id: "proj-1",
        name: "Referrals",
        status: "completed",
        icon: "rocket",
        slug: "referrals",
      },
    ]);
    initiativeNameRowsMock.mockReturnValue([]);
    issueCountsWhereMock.mockReturnValue([
      { projectId: "proj-1", issueCount: 10 },
    ]);
    completedStatesWhereMock.mockReturnValue([{ id: "state-done" }]);
    completedIssueCountsWhereMock.mockReturnValue([
      { projectId: "proj-1", completedCount: 5 },
    ]);
    workspaceLimitMock.mockResolvedValue([{ settings: {} }]);
    deleteReturningMock.mockResolvedValue([{ id: "init-1" }]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/initiatives/[id]/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "init-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns full initiative detail payload", async () => {
    const { GET } = await import("legacy-api/initiatives/[id]/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "init-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      initiative: {
        id: "init-1",
        name: "Growth",
        description: "Details",
        status: "active",
        ownerId: "user-1",
        startDate: "2026-04-01T00:00:00.000Z",
        targetDate: "2026-09-30T00:00:00.000Z",
        timeframe: "Q3 2026",
        health: "onTrack",
        parentInitiativeId: null,
        settings: { updates: [] },
        owner: { id: "user-1", name: "Test User", image: null },
        teams: [],
        parentInitiative: null,
        childInitiatives: [],
        projectCount: 1,
        completedProjectCount: 1,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      projects: [
        {
          id: "proj-1",
          name: "Referrals",
          status: "completed",
          icon: "rocket",
          slug: "referrals",
          issueCount: 10,
          completedIssueCount: 10,
        },
      ],
      availableProjects: [],
      workspaceMembers: [{ id: "user-1", name: "Test User", image: null }],
      workspaceTeams: [],
      availableParentInitiatives: [],
      updates: [],
      activity: [],
    });
  });

  it("blocks detail access when workspace initiatives are disabled", async () => {
    workspaceLimitMock.mockResolvedValue([
      { settings: { features: { initiatives: { enabled: false } } } },
    ]);
    const { GET, PATCH, DELETE } = await import(
      "legacy-api/initiatives/[id]/route"
    );

    let response: Response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "init-1" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Initiatives are disabled for this workspace",
    });

    response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "Blocked" }),
      }),
      { params: Promise.resolve({ id: "init-1" }) },
    );

    expect(response.status).toBe(403);

    response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "init-1" }),
    });

    expect(response.status).toBe(403);
  });

  it("updates an initiative including status updates", async () => {
    const { PATCH } = await import("legacy-api/initiatives/[id]/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Updated Growth",
          statusUpdate: { health: "on_track", body: "Going well" },
        }),
      }),
      { params: Promise.resolve({ id: "init-1" }) },
    );

    expect(response.status).toBe(200);
    expect(txUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Updated Growth",
        updatedAt: expect.any(Date),
      }),
    );
    const payload = await response.json();
    expect(payload.initiative.id).toBe("init-1");
  });

  it("rejects setting a descendant as the parent initiative", async () => {
    initiativeNameRowsMock.mockReturnValue([
      { id: "init-1", name: "Growth", parentInitiativeId: null },
      { id: "init-child", name: "Child", parentInitiativeId: "init-1" },
    ]);
    const { PATCH } = await import("legacy-api/initiatives/[id]/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ parentInitiativeId: "init-child" }),
      }),
      { params: Promise.resolve({ id: "init-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Cannot create a circular initiative hierarchy",
    });
  });

  it("rejects adding an ancestor as a child initiative", async () => {
    initiativesWhereMock.mockResolvedValue([
      {
        id: "init-1",
        name: "Growth",
        description: "Details",
        status: "active",
        ownerId: "user-1",
        startDate: null,
        targetDate: null,
        timeframe: null,
        health: "onTrack",
        parentInitiativeId: "init-parent",
        settings: { updates: [] },
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);
    initiativeNameRowsMock.mockReturnValue([
      { id: "init-parent", name: "Parent", parentInitiativeId: null },
      { id: "init-1", name: "Growth", parentInitiativeId: "init-parent" },
    ]);
    const { PATCH } = await import("legacy-api/initiatives/[id]/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ childInitiativeId: "init-parent" }),
      }),
      { params: Promise.resolve({ id: "init-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Cannot create a circular initiative hierarchy",
    });
  });

  it("unlinks an existing child initiative without deleting it", async () => {
    initiativeNameRowsMock.mockReturnValue([
      { id: "init-1", name: "Growth", parentInitiativeId: null },
      { id: "init-child", name: "Child", parentInitiativeId: "init-1" },
    ]);
    const { PATCH } = await import("legacy-api/initiatives/[id]/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ removeChildInitiativeId: "init-child" }),
      }),
      { params: Promise.resolve({ id: "init-1" }) },
    );

    expect(response.status).toBe(200);
    expect(txUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parentInitiativeId: null,
        updatedAt: expect.any(Date),
      }),
    );
    expect(txUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          activity: expect.arrayContaining([
            expect.objectContaining({
              message: "Removed child initiative Child",
            }),
          ]),
        }),
      }),
    );
  });

  it("deletes an initiative", async () => {
    const { DELETE } = await import("legacy-api/initiatives/[id]/route");

    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "init-1" }),
    });

    expect(response.status).toBe(200);
    expect(deleteWhereMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ success: true });
  });
});
