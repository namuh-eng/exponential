import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const updateSetMock = vi.fn();
const updateReturningMock = vi.fn();
const historyValuesMock = vi.fn();
let destinationRows: unknown[] = [];
let issueRows: unknown[] = [];
let selectCall = 0;

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

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      selectCall += 1;
      const result = selectCall === 1 ? destinationRows : issueRows;
      const chain = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn(() =>
          selectCall === 1 ? chain : Promise.resolve(result),
        ),
        limit: vi.fn(() => Promise.resolve(result)),
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: updateSetMock.mockImplementation(() => ({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(updateReturningMock()),
        }),
      })),
    })),
    insert: vi.fn(() => ({ values: historyValuesMock })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const backlogDestination = {
  id: "state-backlog",
  name: "Accepted",
  category: "backlog",
  teamId: "team-1",
};

const triageIssue = {
  id: "issue-1",
  identifier: "ENG-1",
  teamId: "team-1",
  stateId: "state-triage",
  stateCategory: "triage",
};

const conflictedIssue = {
  id: "issue-2",
  identifier: "ENG-2",
  teamId: "team-1",
  stateId: "state-backlog-old",
  stateCategory: "backlog",
};

describe("team triage bulk route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCall = 0;
    destinationRows = [backlogDestination];
    issueRows = [triageIssue, conflictedIssue];
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", name: "Alice", email: "alice@example.com" },
    });
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
      workspaceId: "workspace-1",
    });
    updateReturningMock.mockReturnValue([{ id: "issue-1" }]);
    historyValuesMock.mockResolvedValue(undefined);
  });

  it("uses the configured bulk accept destination when the request omits one", async () => {
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
      workspaceId: "workspace-1",
      settings: { triageAcceptDestinationStateId: "state-backlog" },
    });
    const { PATCH } = await import("@/app/api/teams/[key]/triage/bulk/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          action: "accept",
          issueIds: ["issue-1"],
          confirmed: true,
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).decision.destinationState.id).toBe(
      "state-backlog",
    );
  });

  it("updates triage issues and reports per-issue conflicts", async () => {
    const { PATCH } = await import("@/app/api/teams/[key]/triage/bulk/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          action: "accept",
          issueIds: ["issue-1", "issue-2", "issue-missing"],
          destinationStateId: "state-backlog",
          confirmed: true,
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );

    expect(response.status).toBe(207);
    const payload = await response.json();
    expect(payload.updatedCount).toBe(1);
    expect(payload.conflictCount).toBe(2);
    expect(payload.results).toEqual([
      expect.objectContaining({ issueId: "issue-1", status: "updated" }),
      expect.objectContaining({ issueId: "issue-2", status: "conflict" }),
      expect.objectContaining({
        issueId: "issue-missing",
        status: "not_found",
      }),
    ]);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ stateId: "state-backlog", canceledAt: null }),
    );
  });

  it("rejects bulk decisions without explicit confirmation", async () => {
    const { PATCH } = await import("@/app/api/teams/[key]/triage/bulk/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          action: "accept",
          issueIds: ["issue-1"],
          destinationStateId: "state-backlog",
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/confirmation/);
  });
});
