import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const viewsOrderByMock = vi.fn();
const teamsOrderByMock = vi.fn();
const teamLimitMock = vi.fn();
const workspaceTeamsWhereMock = vi.fn();
const insertValuesMock = vi.fn();
const insertedViewLimitMock = vi.fn();
const normalizeViewFilterStateMock = vi.fn();

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

vi.mock("@/lib/views", () => ({
  normalizeViewFilterState: normalizeViewFilterStateMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      // GET views AND POST inserted view readback
      if ("layout" in selection && "ownerName" in selection) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn(),
          // biome-ignore lint/suspicious/noThenProperty: <explanation>
          then: (resolve: (val: unknown) => void) =>
            resolve(viewsOrderByMock()),
        };

        chain.limit.mockImplementation(() =>
          Promise.resolve(insertedViewLimitMock()),
        );

        return chain;
      }

      // GET teams AND getWorkspaceTeam matches
      if ("key" in selection && "name" in selection) {
        const chain = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn(),
          // biome-ignore lint/suspicious/noThenProperty: <explanation>
          then: (resolve: (val: unknown) => void) =>
            resolve(teamsOrderByMock()),
        };
        chain.limit.mockImplementation(() => Promise.resolve(teamLimitMock()));
        return chain;
      }

      // getWorkspaceTeam list
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(workspaceTeamsWhereMock()),
        }),
      };
    }),
    insert: vi.fn(() => ({
      values: (...valuesArgs: unknown[]) => {
        insertValuesMock(...valuesArgs);
        return {
          returning: vi.fn().mockResolvedValue([{ id: "view-2" }]),
        };
      },
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("views collection route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    normalizeViewFilterStateMock.mockImplementation((filter: unknown) => {
      const f = filter as { entityType?: string };
      return {
        entityType: f?.entityType ?? "projects",
        scope: "workspace",
      };
    });
    viewsOrderByMock.mockReturnValue([
      {
        id: "view-1",
        name: "Backlog",
        layout: "board",
        isPersonal: false,
        filterState: {},
        teamId: "team-1",
        teamKey: "ENG",
        teamName: "Engineering",
        ownerName: "Ashley",
        ownerImage: null,
        createdAt: new Date("2026-04-01T09:00:00.000Z"),
        updatedAt: new Date("2026-04-01T10:00:00.000Z"),
      },
    ]);
    teamsOrderByMock.mockReturnValue([
      { id: "team-1", key: "ENG", name: "Engineering" },
    ]);
    teamLimitMock.mockReturnValue([
      {
        id: "team-1",
        key: "ENG",
        name: "Engineering",
        workspaceId: "workspace-1",
      },
    ]);
    workspaceTeamsWhereMock.mockReturnValue([{ id: "team-1" }]);
    insertedViewLimitMock.mockReturnValue([
      {
        id: "view-2",
        name: "Projects",
        layout: "list",
        isPersonal: true,
        filterState: {},
        teamId: null,
        teamKey: null,
        teamName: null,
        ownerName: "Ashley",
        ownerImage: null,
        createdAt: new Date("2026-04-23T11:00:00.000Z"),
        updatedAt: new Date("2026-04-23T11:00:00.000Z"),
      },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/views/route");

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns serialized views and teams", async () => {
    const { GET } = await import("@/app/api/views/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.views.length).toBe(1);
    expect(payload.teams.length).toBe(1);
  });

  it("creates a timeline issue view with filters and display options", async () => {
    normalizeViewFilterStateMock.mockReturnValue({
      entityType: "issues",
      scope: "team",
      issueFilters: [{ type: "priority", operator: "is", values: ["urgent"] }],
      issueDisplayOptions: {
        groupBy: "assignee",
        orderBy: "updated",
        visibleProperties: { id: true },
        timelineBy: "dueDate",
      },
      projectStatusFilter: "all",
      projectSortBy: "created-desc",
      projectGroupBy: "none",
      projectVisibleProperties: { lead: true },
    });
    insertedViewLimitMock.mockReturnValue([
      {
        id: "view-2",
        name: "Timeline issues",
        layout: "timeline",
        isPersonal: true,
        filterState: {},
        teamId: "team-1",
        teamKey: "ENG",
        teamName: "Engineering",
        ownerName: "Ashley",
        ownerImage: null,
        createdAt: new Date("2026-04-23T11:00:00.000Z"),
        updatedAt: new Date("2026-04-23T11:00:00.000Z"),
      },
    ]);
    const { POST } = await import("@/app/api/views/route");

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          name: "Timeline issues",
          layout: "timeline",
          teamId: "team-1",
          filterState: {
            entityType: "issues",
            issueFilters: [
              { type: "priority", operator: "is", values: ["urgent"] },
            ],
            issueDisplayOptions: {
              groupBy: "assignee",
              orderBy: "updated",
              visibleProperties: { id: true },
              timelineBy: "dueDate",
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(normalizeViewFilterStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issueDisplayOptions: expect.objectContaining({ timelineBy: "dueDate" }),
      }),
      "team-1",
    );
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: "timeline",
        filterState: expect.objectContaining({
          issueDisplayOptions: expect.objectContaining({
            groupBy: "assignee",
            orderBy: "updated",
          }),
        }),
      }),
    );
  });
});
