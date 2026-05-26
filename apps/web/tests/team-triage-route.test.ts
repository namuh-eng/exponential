import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const triageStatesWhereMock = vi.fn();
const issuesOrderByMock = vi.fn();
const getLabelsForIssuesMock = vi.fn();

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

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      // Find triage states
      if (
        selection &&
        "color" in selection &&
        Object.keys(selection).length === 3
      ) {
        const query = {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockResolvedValue([]),
          // biome-ignore lint/suspicious/noThenProperty: mock query is awaitable like Drizzle
          then: (resolve: (val: unknown) => void) =>
            resolve(triageStatesWhereMock()),
        };
        return query;
      }

      // Get issues in triage state
      if (selection && "identifier" in selection) {
        const issueQuery = {
          leftJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(issuesOrderByMock()),
          }),
        };
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue(issueQuery),
          }),
        };
      }

      const chain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        // biome-ignore lint/suspicious/noThenProperty: <explanation>
        then: (resolve: (val: unknown) => void) => resolve([]),
      };
      return chain;
    }),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("team triage route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
      triageEnabled: true,
    });
    triageStatesWhereMock.mockReturnValue([
      { id: "state-triage", name: "Triage", color: "#f00" },
    ]);
    issuesOrderByMock.mockReturnValue([
      {
        id: "issue-1",
        identifier: "ENG-1",
        title: "Triage me",
        priority: "high",
        stateId: "state-triage",
        stateName: "Triage",
        stateColor: "#f00",
        creatorId: "user-2",
        creatorName: "Bob",
        assigneeId: "user-assignee",
        projectId: "project-1",
        projectName: "Inbox cleanup",
        dueDate: new Date("2026-05-01T00:00:00.000Z"),
        estimate: 2,
        createdAt: new Date("2026-04-26T00:00:00.000Z"),
        updatedAt: new Date("2026-04-27T00:00:00.000Z"),
        teamId: "team-1",
      },
    ]);
    getLabelsForIssuesMock.mockResolvedValue({ "issue-1": [] });
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/teams/[key]/triage/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when team is missing", async () => {
    findAccessibleTeamMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/teams/[key]/triage/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "MISSING" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns triage issues with creator info", async () => {
    const { GET } = await import("legacy-api/teams/[key]/triage/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.issues.length).toBe(1);
    expect(payload.issues[0].creatorName).toBe("Bob");
    expect(payload.issues[0]).toMatchObject({
      assigneeId: "user-assignee",
      projectId: "project-1",
      projectName: "Inbox cleanup",
      estimate: 2,
    });
  });

  it("returns triage issues from a parent hierarchy child team", async () => {
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
      triageEnabled: true,
      hierarchyTeamIds: ["team-1", "team-child"],
      childTeamIds: ["team-child"],
    });
    issuesOrderByMock.mockReturnValue([
      {
        id: "issue-child",
        identifier: "PLAT-1",
        title: "Child triage",
        priority: "high",
        stateId: "state-triage",
        stateName: "Triage",
        stateColor: "#f00",
        creatorId: "user-2",
        creatorName: "Bob",
        assigneeId: null,
        projectId: null,
        projectName: null,
        dueDate: null,
        estimate: null,
        createdAt: new Date("2026-04-26T00:00:00.000Z"),
        updatedAt: new Date("2026-04-27T00:00:00.000Z"),
        teamId: "team-child",
      },
    ]);
    const { GET } = await import("legacy-api/teams/[key]/triage/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.issues[0]).toMatchObject({
      identifier: "PLAT-1",
      teamId: "team-child",
    });
  });

  it("returns a disabled triage queue without querying triage issues", async () => {
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
      triageEnabled: false,
    });
    const { GET } = await import("legacy-api/teams/[key]/triage/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.triageEnabled).toBe(false);
    expect(payload.issues).toEqual([]);
    expect(payload.createStateId).toBeNull();
    expect(triageStatesWhereMock).not.toHaveBeenCalled();
  });
});
