import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const cyclesLimitMock = vi.fn();
const statesOrderByMock = vi.fn();
const issuesOrderByMock = vi.fn();
const getLabelsForIssuesMock = vi.fn();
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

      // primary cycle lookup (called 1st)
      if (selectCallCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(cyclesLimitMock()),
            }),
          }),
        };
      }

      // workflow states lookup (called 2nd)
      if (selectCallCount === 2) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(statesOrderByMock()),
            }),
          }),
        };
      }

      // issues in cycle fetch
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

describe("team cycle detail route", () => {
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
    cyclesLimitMock.mockReturnValue([
      { id: "cycle-1", name: "Cycle 1", startDate: new Date("2026-04-01") },
    ]);
    statesOrderByMock.mockReturnValue([
      {
        id: "state-1",
        name: "Todo",
        category: "unstarted",
        color: "#999",
        position: 1,
      },
    ]);
    issuesOrderByMock.mockReturnValue([
      {
        id: "issue-1",
        number: 1,
        identifier: "ENG-1",
        title: "Cycle work",
        priority: "medium",
        stateId: "state-1",
        assigneeId: null,
        assigneeName: null,
        assigneeImage: null,
        creatorId: "user-1",
        projectId: null,
        projectName: null,
        cycleId: "cycle-1",
        estimate: null,
        dueDate: null,
        createdAt: new Date("2026-04-02T00:00:00.000Z"),
        sortOrder: 1,
      },
    ]);
    getLabelsForIssuesMock.mockResolvedValue({ "issue-1": [] });
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import(
      "legacy-api/teams/[key]/cycles/[cycleId]/route"
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG", cycleId: "cycle-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when cycle is not found", async () => {
    cyclesLimitMock.mockReturnValue([]);
    const { GET } = await import(
      "legacy-api/teams/[key]/cycles/[cycleId]/route"
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG", cycleId: "MISSING" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns cycle detail with grouped issues", async () => {
    const { GET } = await import(
      "legacy-api/teams/[key]/cycles/[cycleId]/route"
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG", cycleId: "cycle-1" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.groups.length).toBe(1);
    expect(payload.groups[0].issues.length).toBe(1);
  });
});
