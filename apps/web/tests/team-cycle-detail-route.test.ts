import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const cycleLimitMock = vi.fn();
const statesOrderByMock = vi.fn();
const issuesOrderByMock = vi.fn();
const getLabelsForIssuesMock = vi.fn();
const cycleUpdateSetMock = vi.fn();
const cycleUpdateWhereMock = vi.fn();
const issueUpdateSetMock = vi.fn();
const issueUpdateWhereMock = vi.fn();
const deleteWhereMock = vi.fn();
const issueTable = { __name: "issue" };
const cycleTable = { __name: "cycle" };
const projectTable = { __name: "project" };

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/teams", () => ({
  findAccessibleTeam: findAccessibleTeamMock,
}));

vi.mock("@/lib/issue-labels", () => ({
  getLabelsForIssues: getLabelsForIssuesMock,
}));

vi.mock("@/lib/db/schema", () => ({
  issue: issueTable,
  cycle: cycleTable,
  project: projectTable,
  user: {},
  workflowState: {},
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      if (!selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: statesOrderByMock,
              limit: cycleLimitMock,
            }),
          }),
        };
      }

      if ("category" in selection && "position" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: statesOrderByMock,
            }),
          }),
        };
      }

      if ("identifier" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: issuesOrderByMock,
                }),
              }),
            }),
          }),
        };
      }

      const cycleRows = [
        {
          id: "cycle-1",
          startDate: new Date("2026-04-01T00:00:00.000Z"),
          endDate: new Date("2026-04-14T00:00:00.000Z"),
        },
        {
          id: "cycle-2",
          startDate: new Date("2026-04-20T00:00:00.000Z"),
          endDate: new Date("2026-05-03T00:00:00.000Z"),
        },
      ];

      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([cycleRows[0]]),
            // biome-ignore lint/suspicious/noThenProperty: mimic Drizzle thenable query builders in route tests
            then: (resolve: (value: unknown) => void) => resolve(cycleRows),
          }),
        }),
      };
    }),
    update: vi.fn((table: unknown) => {
      if (table === issueTable) {
        return {
          set: (...setArgs: unknown[]) => {
            issueUpdateSetMock(...setArgs);
            return {
              where: (...whereArgs: unknown[]) => {
                issueUpdateWhereMock(...whereArgs);
                return Promise.resolve();
              },
            };
          },
        };
      }

      return {
        set: (...setArgs: unknown[]) => {
          cycleUpdateSetMock(...setArgs);
          return {
            where: (...whereArgs: unknown[]) => {
              cycleUpdateWhereMock(...whereArgs);
              return {
                returning: vi.fn().mockResolvedValue([
                  {
                    id: "cycle-1",
                    name: "Cycle 1 updated",
                    startDate: new Date("2026-04-01T00:00:00.000Z"),
                    endDate: new Date("2026-04-14T00:00:00.000Z"),
                    autoRollover: false,
                  },
                ]),
              };
            },
          };
        },
      };
    }),
    delete: vi.fn(() => ({
      where: (...whereArgs: unknown[]) => {
        deleteWhereMock(...whereArgs);
        return {
          returning: vi.fn().mockResolvedValue([{ id: "cycle-1" }]),
        };
      },
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("team cycle detail route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({
      user: { id: "user-1" },
    });
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
      workspaceId: "workspace-1",
    });
    cycleLimitMock.mockResolvedValue([
      {
        id: "cycle-1",
        name: "Cycle 1",
        number: 1,
        teamId: "team-1",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-14T00:00:00.000Z"),
        autoRollover: true,
      },
    ]);
    statesOrderByMock.mockResolvedValue([
      {
        id: "state-1",
        name: "Backlog",
        category: "backlog",
        color: "#999",
        position: 1,
      },
      {
        id: "state-2",
        name: "Done",
        category: "completed",
        color: "#0f0",
        position: 2,
      },
    ]);
    issuesOrderByMock.mockResolvedValue([
      {
        id: "issue-1",
        number: 1,
        identifier: "ENG-1",
        title: "Cycle issue",
        priority: "medium",
        stateId: "state-2",
        assigneeId: "user-2",
        assigneeName: "Alice",
        assigneeImage: null,
        creatorId: "user-1",
        projectId: "project-1",
        projectName: "Roadmap",
        cycleId: "cycle-1",
        estimate: 3,
        dueDate: new Date("2026-04-10T00:00:00.000Z"),
        createdAt: new Date("2026-04-02T00:00:00.000Z"),
        sortOrder: 1,
      },
    ]);
    getLabelsForIssuesMock.mockResolvedValue({
      "issue-1": [{ id: "label-1", name: "Bug", color: "#f00" }],
    });
  });

  it("returns cycle detail grouped by workflow state", async () => {
    const { GET } = await import(
      "legacy-api/teams/[key]/cycles/[cycleId]/route"
    );

    const response = await GET(
      new Request("http://localhost/api/teams/ENG/cycles/cycle-1"),
      { params: Promise.resolve({ key: "ENG", cycleId: "cycle-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      team: {
        id: "team-1",
        key: "ENG",
        name: "Engineering",
      },
      cycle: {
        id: "cycle-1",
        name: "Cycle 1",
        number: 1,
        teamId: "team-1",
        startDate: "2026-04-01T00:00:00.000Z",
        endDate: "2026-04-14T00:00:00.000Z",
        autoRollover: true,
        issueCount: 1,
        completedIssueCount: 1,
      },
      groups: [
        {
          state: {
            id: "state-1",
            name: "Backlog",
            category: "backlog",
            color: "#999",
            position: 1,
          },
          issues: [],
        },
        {
          state: {
            id: "state-2",
            name: "Done",
            category: "completed",
            color: "#0f0",
            position: 2,
          },
          issues: [
            {
              id: "issue-1",
              number: 1,
              identifier: "ENG-1",
              title: "Cycle issue",
              priority: "medium",
              stateId: "state-2",
              assigneeId: "user-2",
              assignee: { name: "Alice", image: null },
              creatorId: "user-1",
              labels: [{ id: "label-1", name: "Bug", color: "#f00" }],
              labelIds: ["label-1"],
              projectId: "project-1",
              projectName: "Roadmap",
              cycleId: "cycle-1",
              cycleName: "Cycle 1",
              estimate: 3,
              dueDate: "2026-04-10T00:00:00.000Z",
              createdAt: "2026-04-02T00:00:00.000Z",
            },
          ],
        },
      ],
      filterOptions: {
        assignees: [{ id: "user-2", image: null, name: "Alice" }],
        creators: [],
        cycles: [{ id: "cycle-1", name: "Cycle 1" }],
        dueDates: [{ label: "Apr 10", value: "2026-04-10" }],
        estimates: [{ label: "3", value: "3" }],
        labels: [{ id: "label-1", name: "Bug", color: "#f00" }],
        priorities: [
          { value: "urgent", label: "Urgent" },
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
          { value: "none", label: "No priority" },
        ],
        projects: [{ id: "project-1", name: "Roadmap" }],
        statuses: [
          {
            id: "state-1",
            name: "Backlog",
            category: "backlog",
            color: "#999",
          },
          { id: "state-2", name: "Done", category: "completed", color: "#0f0" },
        ],
        teams: [{ id: "team-1", name: "Engineering" }],
      },
    });
  });

  it("rejects overlapping cycle updates", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.select).mockImplementationOnce(
      () =>
        ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: cycleLimitMock,
            }),
          }),
        }) as never,
    );
    const { PATCH } = await import(
      "legacy-api/teams/[key]/cycles/[cycleId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost/api/teams/ENG/cycles/cycle-1", {
        method: "PATCH",
        body: JSON.stringify({
          startDate: "2026-04-10",
          endDate: "2026-04-22",
        }),
      }),
      { params: Promise.resolve({ key: "ENG", cycleId: "cycle-1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Cycle dates overlap with an existing cycle",
    });
  });

  it("updates cycle metadata when dates are valid", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.select)
      .mockImplementationOnce(
        () =>
          ({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: cycleLimitMock,
              }),
            }),
          }) as never,
      )
      .mockImplementationOnce(
        () =>
          ({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue([
                {
                  id: "cycle-1",
                  startDate: new Date("2026-04-01T00:00:00.000Z"),
                  endDate: new Date("2026-04-14T00:00:00.000Z"),
                },
              ]),
            }),
          }) as never,
      );

    const { PATCH } = await import(
      "legacy-api/teams/[key]/cycles/[cycleId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost/api/teams/ENG/cycles/cycle-1", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Cycle 1 updated",
          startDate: "2026-04-01",
          endDate: "2026-04-14",
          autoRollover: false,
        }),
      }),
      { params: Promise.resolve({ key: "ENG", cycleId: "cycle-1" }) },
    );

    expect(response.status).toBe(200);
    expect(cycleUpdateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Cycle 1 updated",
        autoRollover: false,
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("unlinks issues before deleting a cycle", async () => {
    const { DELETE } = await import(
      "legacy-api/teams/[key]/cycles/[cycleId]/route"
    );

    const response = await DELETE(
      new Request("http://localhost/api/teams/ENG/cycles/cycle-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ key: "ENG", cycleId: "cycle-1" }) },
    );

    expect(response.status).toBe(200);
    expect(issueUpdateSetMock).toHaveBeenCalledWith({ cycleId: null });
    expect(deleteWhereMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ success: true });
  });
});
