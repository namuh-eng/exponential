import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const membershipsLimitMock = vi.fn();
const teamsWhereMock = vi.fn();
const statesOrderByMock = vi.fn();
const assignedOrderByMock = vi.fn();
const createdOrderByMock = vi.fn();
const commentedOrderByMock = vi.fn();
const explicitSubscribedOrderByMock = vi.fn();
const getLabelsForIssuesMock = vi.fn();
let selectCallCount = 0;

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/issue-labels", () => ({
  getLabelsForIssues: getLabelsForIssuesMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      selectCallCount += 1;

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

      if (selection && "key" in selection && "name" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: teamsWhereMock,
          }),
        };
      }

      if (!selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: statesOrderByMock,
            }),
          }),
        };
      }

      if (selectCallCount === 4) {
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: assignedOrderByMock,
                }),
              }),
            }),
          }),
        };
      }

      if (selectCallCount === 5) {
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: createdOrderByMock,
                }),
              }),
            }),
          }),
        };
      }

      const orderByMock =
        selectCallCount === 7
          ? explicitSubscribedOrderByMock
          : commentedOrderByMock;

      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: orderByMock,
                }),
              }),
            }),
          }),
        }),
      };
    }),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("my issues route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCallCount = 0;
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    membershipsLimitMock.mockResolvedValue([{ workspaceId: "workspace-1" }]);
    teamsWhereMock.mockResolvedValue([
      { id: "team-1", name: "Engineering", key: "ENG" },
    ]);
    statesOrderByMock.mockResolvedValue([
      {
        id: "state-1",
        name: "Todo",
        category: "unstarted",
        color: "#999",
        position: 1,
        teamId: "team-1",
      },
      {
        id: "state-2",
        name: "In Progress",
        category: "started",
        color: "#00f",
        position: 2,
        teamId: "team-1",
      },
    ]);
    assignedOrderByMock.mockResolvedValue([
      {
        id: "issue-1",
        number: 1,
        identifier: "ENG-1",
        title: "Assigned issue",
        priority: "high",
        stateId: "state-1",
        assigneeId: "user-1",
        assigneeName: "Ashley",
        assigneeImage: null,
        projectId: "project-1",
        projectName: "Ever",
        dueDate: new Date("2026-04-30T00:00:00.000Z"),
        createdAt: new Date("2026-04-23T09:00:00.000Z"),
        updatedAt: new Date("2026-04-23T10:00:00.000Z"),
        sortOrder: 1,
        teamId: "team-1",
      },
    ]);
    createdOrderByMock.mockResolvedValue([
      {
        id: "issue-2",
        number: 2,
        identifier: "ENG-2",
        title: "Created issue",
        priority: "medium",
        stateId: "state-2",
        assigneeId: null,
        assigneeName: null,
        assigneeImage: null,
        projectId: null,
        projectName: null,
        dueDate: null,
        createdAt: new Date("2026-04-23T11:00:00.000Z"),
        updatedAt: new Date("2026-04-23T12:00:00.000Z"),
        sortOrder: 2,
        teamId: "team-1",
      },
    ]);
    commentedOrderByMock.mockResolvedValue([
      {
        id: "issue-3",
        number: 3,
        identifier: "ENG-3",
        title: "Commented issue",
        priority: "low",
        stateId: "state-2",
        assigneeId: null,
        assigneeName: null,
        assigneeImage: null,
        projectId: null,
        projectName: null,
        dueDate: null,
        createdAt: new Date("2026-04-23T08:00:00.000Z"),
        updatedAt: new Date("2026-04-23T13:00:00.000Z"),
        sortOrder: 3,
        teamId: "team-1",
      },
    ]);
    explicitSubscribedOrderByMock.mockResolvedValue([]);
    getLabelsForIssuesMock.mockResolvedValue({
      "issue-1": [{ name: "Bug", color: "#f00" }],
      "issue-2": [{ name: "Feature", color: "#0f0" }],
      "issue-3": [],
    });
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/my-issues/route");

    const response = await GET(new Request("http://localhost/api/my-issues"));

    expect(response.status).toBe(401);
  });

  it("returns 404 when the user has no workspace", async () => {
    membershipsLimitMock.mockResolvedValue([]);
    const { GET } = await import("legacy-api/my-issues/route");

    const response = await GET(new Request("http://localhost/api/my-issues"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "No workspace" });
  });

  it("returns empty groups when the workspace has no teams", async () => {
    teamsWhereMock.mockResolvedValue([]);
    const { GET } = await import("legacy-api/my-issues/route");

    const response = await GET(new Request("http://localhost/api/my-issues"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      groups: [],
      filterOptions: {
        statuses: [],
        assignees: [],
        labels: [],
        priorities: [
          { value: "urgent", label: "Urgent" },
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
          { value: "none", label: "No priority" },
        ],
      },
    });
  });

  it("returns grouped assigned issues with filter options", async () => {
    const { GET } = await import("legacy-api/my-issues/route");

    const response = await GET(
      new Request("http://localhost/api/my-issues?tab=assigned"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      groups: [
        {
          state: {
            id: "unstarted:Todo",
            name: "Todo",
            category: "unstarted",
            color: "#999",
            position: 1,
          },
          issues: [
            {
              id: "issue-1",
              number: 1,
              identifier: "ENG-1",
              title: "Assigned issue",
              priority: "high",
              stateId: "unstarted:Todo",
              assigneeId: "user-1",
              assignee: { name: "Ashley", image: null },
              labels: [{ name: "Bug", color: "#f00" }],
              labelIds: ["Bug"],
              projectId: "project-1",
              projectName: "Ever",
              dueDate: "2026-04-30T00:00:00.000Z",
              createdAt: "2026-04-23T09:00:00.000Z",
              updatedAt: "2026-04-23T10:00:00.000Z",
              displayAt: "2026-04-23T09:00:00.000Z",
              teamKey: "ENG",
            },
          ],
        },
      ],
      totalCount: 1,
      filterOptions: {
        statuses: [
          {
            id: "unstarted:Todo",
            name: "Todo",
            category: "unstarted",
            color: "#999",
          },
        ],
        assignees: [{ id: "user-1", name: "Ashley", image: null }],
        labels: [
          { id: "Bug", name: "Bug", color: "#f00" },
          { id: "Feature", name: "Feature", color: "#0f0" },
        ],
        priorities: [
          { value: "urgent", label: "Urgent" },
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
          { value: "none", label: "No priority" },
        ],
      },
    });
  });

  it("dedupes and sorts subscribed issues by latest activity", async () => {
    assignedOrderByMock.mockResolvedValue([
      {
        id: "issue-3",
        number: 3,
        identifier: "ENG-3",
        title: "Commented issue",
        priority: "low",
        stateId: "state-2",
        assigneeId: null,
        assigneeName: null,
        assigneeImage: null,
        projectId: null,
        projectName: null,
        dueDate: null,
        createdAt: new Date("2026-04-23T08:00:00.000Z"),
        updatedAt: new Date("2026-04-23T12:30:00.000Z"),
        sortOrder: 1,
        teamId: "team-1",
      },
    ]);
    createdOrderByMock.mockResolvedValue([]);
    commentedOrderByMock.mockResolvedValue([
      {
        id: "issue-3",
        number: 3,
        identifier: "ENG-3",
        title: "Commented issue",
        priority: "low",
        stateId: "state-2",
        assigneeId: null,
        assigneeName: null,
        assigneeImage: null,
        projectId: null,
        projectName: null,
        dueDate: null,
        createdAt: new Date("2026-04-23T08:00:00.000Z"),
        updatedAt: new Date("2026-04-23T13:00:00.000Z"),
        sortOrder: 3,
        teamId: "team-1",
      },
    ]);
    const { GET } = await import("legacy-api/my-issues/route");

    const response = await GET(
      new Request("http://localhost/api/my-issues?tab=subscribed"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totalCount: 1,
      groups: [
        {
          state: { id: "started:In Progress" },
          issues: [
            {
              id: "issue-3",
              updatedAt: "2026-04-23T13:00:00.000Z",
              displayAt: "2026-04-23T08:00:00.000Z",
            },
          ],
        },
      ],
    });
  });

  it("includes watched-only explicit subscriptions in the subscribed tab", async () => {
    assignedOrderByMock.mockResolvedValue([]);
    createdOrderByMock.mockResolvedValue([]);
    commentedOrderByMock.mockResolvedValue([]);
    explicitSubscribedOrderByMock.mockResolvedValue([
      {
        id: "issue-4",
        number: 4,
        identifier: "ENG-4",
        title: "Watched-only issue",
        priority: "medium",
        stateId: "state-1",
        assigneeId: null,
        assigneeName: null,
        assigneeImage: null,
        projectId: null,
        projectName: null,
        dueDate: null,
        createdAt: new Date("2026-04-24T08:00:00.000Z"),
        updatedAt: new Date("2026-04-24T09:00:00.000Z"),
        sortOrder: 4,
        teamId: "team-1",
      },
    ]);
    const { GET } = await import("legacy-api/my-issues/route");

    const response = await GET(
      new Request("http://localhost/api/my-issues?tab=subscribed"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totalCount: 1,
      groups: [
        {
          state: { id: "unstarted:Todo" },
          issues: [
            {
              id: "issue-4",
              title: "Watched-only issue",
              displayAt: "2026-04-24T08:00:00.000Z",
            },
          ],
        },
      ],
    });
  });

  it("excludes unsubscribed explicit rows while preserving implicit subscriptions", async () => {
    explicitSubscribedOrderByMock.mockResolvedValue([]);
    const { GET } = await import("legacy-api/my-issues/route");

    const response = await GET(
      new Request("http://localhost/api/my-issues?tab=subscribed"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totalCount: 3,
    });
  });
});
