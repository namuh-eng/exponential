import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const statesOrderByMock = vi.fn();
const issuesOrderByMock = vi.fn();
const getLabelsForIssuesMock = vi.fn();
const creatorsWhereMock = vi.fn();
const cyclesWhereMock = vi.fn();
const teamOptionsWhereMock = vi.fn();
let selectCallCount = 0;

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
      selectCallCount += 1;

      // workflow states lookup (called 1st)
      if (selectCallCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(statesOrderByMock()),
            }),
          }),
        };
      }

      // issues collection fetch (called 2nd)
      if (selection && "identifier" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockResolvedValue(issuesOrderByMock()),
                }),
              }),
            }),
          }),
        };
      }

      // hierarchy team filter options lookup
      if (
        selection &&
        "id" in selection &&
        "name" in selection &&
        selectCallCount > 4
      ) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(teamOptionsWhereMock()),
          }),
        };
      }

      // creators lookup
      if (
        selection &&
        "id" in selection &&
        "name" in selection &&
        Object.keys(selection).length === 2
      ) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(creatorsWhereMock()),
          }),
        };
      }

      // cycles lookup
      if (selection && "number" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(cyclesWhereMock()),
          }),
        };
      }

      const chain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
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

describe("team issues route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCallCount = 0;
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
    });
    statesOrderByMock.mockReturnValue([
      {
        id: "state-1",
        name: "Backlog",
        category: "backlog",
        color: "#999",
        position: 1,
      },
    ]);
    issuesOrderByMock.mockReturnValue([
      {
        id: "issue-1",
        number: 1,
        identifier: "ENG-1",
        title: "Test issue",
        stateId: "state-1",
        creatorId: "user-2",
        cycleId: "cycle-1",
      },
    ]);
    getLabelsForIssuesMock.mockResolvedValue({ "issue-1": [] });
    creatorsWhereMock.mockReturnValue([{ id: "user-2", name: "Bob" }]);
    cyclesWhereMock.mockReturnValue([
      { id: "cycle-1", name: "Cycle 1", number: 1 },
    ]);
    teamOptionsWhereMock.mockReturnValue([
      { id: "team-1", name: "Engineering" },
      { id: "team-child", name: "Platform" },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/teams/[key]/issues/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when team is missing", async () => {
    findAccessibleTeamMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/teams/[key]/issues/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "MISSING" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns grouped issues with labels and metadata lookup", async () => {
    const { GET } = await import("legacy-api/teams/[key]/issues/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.groups.length).toBe(1);
    expect(payload.groups[0].issues.length).toBe(1);
    expect(payload.groups[0].issues[0].creatorName).toBe("Bob");
    expect(payload.groups[0].issues[0].cycleName).toBe("Cycle 1");
  });

  it("returns parent hierarchy issue scope and team filter options", async () => {
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
      hierarchyTeamIds: ["team-1", "team-child"],
      childTeamIds: ["team-child"],
    });
    issuesOrderByMock.mockReturnValue([
      {
        id: "issue-child",
        number: 2,
        identifier: "PLAT-2",
        title: "Child issue",
        priority: "medium",
        stateId: "state-1",
        creatorId: "user-2",
        cycleId: "cycle-1",
        teamId: "team-child",
      },
    ]);
    const { GET } = await import("legacy-api/teams/[key]/issues/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.groups[0].issues[0]).toMatchObject({
      identifier: "PLAT-2",
      teamId: "team-child",
    });
    expect(payload.filterOptions.teams).toEqual([
      { id: "team-1", name: "Engineering" },
      { id: "team-child", name: "Platform" },
    ]);
  });
});
