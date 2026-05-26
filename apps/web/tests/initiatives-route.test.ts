import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const membershipsLimitMock = vi.fn();
const initiativesWhereMock = vi.fn();
const projectsInnerJoinMock = vi.fn();
const workspaceMembersWhereMock = vi.fn();
const workspaceTeamsWhereMock = vi.fn();
const workspaceLimitMock = vi.fn();
const initiativeTeamsWhereMock = vi.fn();
const ownerLimitMock = vi.fn();
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();

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

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
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

      if (selection && "name" in selection && "image" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: workspaceMembersWhereMock,
            }),
          }),
        };
      }

      if (selection && "key" in selection && "icon" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: workspaceTeamsWhereMock,
            innerJoin: vi.fn().mockReturnValue({
              where: initiativeTeamsWhereMock,
            }),
          }),
        };
      }

      if (selection && "id" in selection && "status" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: projectsInnerJoinMock,
            }),
          }),
        };
      }

      if (selection && "id" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: ownerLimitMock,
            }),
          }),
        };
      }

      return {
        from: vi.fn().mockReturnValue({
          where: initiativesWhereMock,
        }),
      };
    }),
    insert: vi.fn(() => ({
      values: insertValuesMock.mockReturnValue({
        returning: insertReturningMock,
      }),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: vi.fn(),
  }),
}));

describe("initiatives collection route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    membershipsLimitMock.mockResolvedValue([{ workspaceId: "workspace-1" }]);
    workspaceMembersWhereMock.mockResolvedValue([
      { id: "user-1", name: "Ashley", image: null },
    ]);
    workspaceTeamsWhereMock.mockResolvedValue([
      { id: "team-1", name: "Engineering", key: "ENG", icon: "🛠" },
    ]);
    workspaceLimitMock.mockResolvedValue([{ settings: {} }]);
    initiativeTeamsWhereMock.mockResolvedValue([
      { id: "team-1", name: "Engineering", key: "ENG", icon: "🛠" },
    ]);
    ownerLimitMock.mockResolvedValue([{ id: "member-1" }]);
    initiativesWhereMock.mockResolvedValue([
      {
        id: "init-1",
        name: "Growth",
        description: "Scale things",
        status: "active",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        ownerId: "user-1",
        startDate: null,
        targetDate: new Date("2026-09-30T00:00:00.000Z"),
        health: "atRisk",
        timeframe: null,
        parentInitiativeId: null,
        settings: {
          updates: [
            {
              id: "up-1",
              health: "atRisk",
              body: "Launch is at risk",
              actorName: "Ashley",
              actorImage: null,
              createdAt: "2026-04-02T00:00:00.000Z",
            },
          ],
        },
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);
    projectsInnerJoinMock.mockResolvedValue([
      {
        id: "proj-1",
        name: "Referrals",
        status: "completed",
        icon: "rocket",
        settings: {},
      },
      {
        id: "proj-2",
        name: "Ads",
        status: "started",
        icon: "ads",
        settings: {
          activity: [
            {
              id: "act-1",
              type: "update",
              title: "Project update",
              body: "On track",
              actorName: "Ashley",
              actorImage: null,
              createdAt: "2026-04-02T00:00:00.000Z",
            },
          ],
        },
      },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/initiatives/route");

    const response = await GET(new Request("http://localhost/api/initiatives"));

    expect(response.status).toBe(401);
  });

  it("returns 404 when the user has no workspace", async () => {
    resolveRequestWorkspaceIdMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/initiatives/route");

    const response = await GET(new Request("http://localhost/api/initiatives"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "No workspace" });
  });

  it("returns initiatives with project counts", async () => {
    const { GET } = await import("legacy-api/initiatives/route");

    const response = await GET(new Request("http://localhost/api/initiatives"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      initiatives: [
        {
          id: "init-1",
          name: "Growth",
          description: "Scale things",
          status: "active",
          ownerId: "user-1",
          owner: { id: "user-1", name: "Ashley", image: null },
          teams: [{ id: "team-1", name: "Engineering", key: "ENG", icon: "🛠" }],
          startDate: null,
          targetDate: "2026-09-30T00:00:00.000Z",
          timeframe: null,
          health: "atRisk",
          parentInitiativeId: null,
          projectCount: 2,
          completedProjectCount: 1,
          latestUpdate: {
            id: "up-1",
            health: "atRisk",
            body: "Launch is at risk",
            actorName: "Ashley",
            actorImage: null,
            createdAt: "2026-04-02T00:00:00.000Z",
          },
          activeProjectHealthRollup: {
            total: 1,
            withUpdates: 1,
            withoutUpdates: 0,
            paused: 0,
          },
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      workspaceMembers: [{ id: "user-1", name: "Ashley", image: null }],
      workspaceTeams: [
        { id: "team-1", name: "Engineering", key: "ENG", icon: "🛠" },
      ],
      initiativesSettings: {
        enabled: true,
        projectRollups: true,
        visibility: "workspace",
        roadmapMode: "all",
      },
    });
  });

  it("returns an empty disabled payload and rejects creation when initiatives are off", async () => {
    workspaceLimitMock.mockResolvedValue([
      { settings: { features: { initiatives: { enabled: false } } } },
    ]);
    const { GET, POST } = await import("legacy-api/initiatives/route");

    let response: Response = await GET(
      new Request("http://localhost/api/initiatives"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      initiatives: [],
      workspaceMembers: [],
      workspaceTeams: [],
      initiativesSettings: {
        enabled: false,
        projectRollups: true,
        visibility: "workspace",
        roadmapMode: "all",
      },
    });

    response = await POST(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        body: JSON.stringify({ name: "Blocked" }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Initiatives are disabled for this workspace",
    });
  });

  it("omits project rollup details when workspace rollups are disabled", async () => {
    workspaceLimitMock.mockResolvedValue([
      {
        settings: {
          features: { initiatives: { enabled: true, projectRollups: false } },
        },
      },
    ]);
    const { GET } = await import("legacy-api/initiatives/route");

    const response = await GET(new Request("http://localhost/api/initiatives"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.initiatives[0].activeProjectHealthRollup).toBeNull();
    expect(data.initiativesSettings.projectRollups).toBe(false);
  });

  it("rejects creation with missing name", async () => {
    const { POST } = await import("legacy-api/initiatives/route");

    const response = await POST(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        body: JSON.stringify({ name: "" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Initiative name is required",
    });
  });

  it("rejects invalid owner and malformed target dates", async () => {
    ownerLimitMock.mockResolvedValueOnce([]);
    const { POST } = await import("legacy-api/initiatives/route");

    let response = await POST(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        body: JSON.stringify({
          name: "Invalid owner",
          ownerId: "missing-user",
        }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Owner not found",
    });

    response = await POST(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        body: JSON.stringify({
          name: "Bad date",
          targetDate: "not-a-date",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid date" });
  });

  it("creates an initiative", async () => {
    insertReturningMock.mockResolvedValue([
      {
        id: "init-2",
        name: "New Initiative",
        description: "Detail",
        status: "planned",
        createdAt: new Date("2026-04-26T00:00:00.000Z"),
        updatedAt: new Date("2026-04-26T00:00:00.000Z"),
      },
    ]);
    const { POST } = await import("legacy-api/initiatives/route");

    const response = await POST(
      new Request("http://localhost/api/initiatives", {
        method: "POST",
        body: JSON.stringify({ name: "New Initiative", description: "Detail" }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: "init-2",
      name: "New Initiative",
      description: "Detail",
      status: "planned",
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    });
  });
});
