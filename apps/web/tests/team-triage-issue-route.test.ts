import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const updateSetMock = vi.fn();
const updateReturningMock = vi.fn();
let selectResults: unknown[][] = [];

function nextSelectResult() {
  return selectResults.shift() ?? [];
}

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
      const chain = {
        from: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(() => Promise.resolve(nextSelectResult())),
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
    // The triage accept/decline route now wraps its writes in db.transaction.
    // Reuse the same update/delete/insert shapes the rest of the mock returns
    // so callbacks behave identically to the outer db.
    transaction: vi.fn(
      async (
        cb: (tx: {
          update: unknown;
          delete: unknown;
          insert: unknown;
        }) => Promise<unknown>,
      ) =>
        cb({
          update: vi.fn(() => ({
            set: updateSetMock.mockImplementation(() => ({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue(updateReturningMock()),
              }),
            })),
          })),
          delete: vi.fn(() => ({
            where: vi.fn().mockResolvedValue([]),
          })),
          insert: vi.fn(() => ({
            values: vi.fn().mockResolvedValue([]),
          })),
        }),
    ),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const triageIssue = {
  id: "issue-1",
  teamId: "team-1",
  stateId: "state-triage",
  stateCategory: "triage",
};

const backlogDestination = {
  id: "state-backlog",
  name: "Accepted",
  category: "backlog",
  teamId: "team-1",
};

const canceledDestination = {
  id: "state-canceled",
  name: "Declined",
  category: "canceled",
  teamId: "team-1",
};

describe("team triage issue route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectResults = [[triageIssue], [backlogDestination]];
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
      workspaceId: "workspace-1",
    });
    updateReturningMock.mockReturnValue([
      { id: "issue-1", stateId: "state-backlog" },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { PATCH } = await import(
      "legacy-api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: "{}" }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 when team is missing", async () => {
    findAccessibleTeamMock.mockResolvedValue(null);
    const { PATCH } = await import(
      "legacy-api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          action: "accept",
          destinationStateId: "state-backlog",
          confirmed: true,
        }),
      }),
      {
        params: Promise.resolve({ key: "MISSING", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(404);
  });

  it("requires an explicit destination status", async () => {
    const { PATCH } = await import(
      "legacy-api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ action: "accept", confirmed: true }),
      }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Destination/);
  });

  it("uses the configured accept destination when the request omits one", async () => {
    findAccessibleTeamMock.mockResolvedValue({
      id: "team-1",
      name: "Engineering",
      key: "ENG",
      workspaceId: "workspace-1",
      settings: { triageAcceptDestinationStateId: "state-backlog" },
    });
    const { PATCH } = await import(
      "legacy-api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ action: "accept", confirmed: true }),
      }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).decision.destinationState.id).toBe(
      "state-backlog",
    );
  });

  it("requires explicit confirmation", async () => {
    const { PATCH } = await import(
      "legacy-api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          action: "decline",
          destinationStateId: "state-canceled",
        }),
      }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/confirmation/);
  });

  it("accepts a triage issue into the requested allowed destination", async () => {
    const { PATCH } = await import(
      "legacy-api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          action: "accept",
          destinationStateId: "state-backlog",
          confirmed: true,
        }),
      }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.issue.stateId).toBe("state-backlog");
    expect(payload.decision.destinationState.id).toBe("state-backlog");
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ stateId: "state-backlog", canceledAt: null }),
    );
  });

  it("declines a triage issue into the requested canceled destination", async () => {
    selectResults = [[triageIssue], [canceledDestination]];
    updateReturningMock.mockReturnValue([
      { id: "issue-1", stateId: "state-canceled" },
    ]);
    const { PATCH } = await import(
      "legacy-api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          action: "decline",
          destinationStateId: "state-canceled",
          confirmed: true,
          reason: "Duplicate request",
        }),
      }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.issue.stateId).toBe("state-canceled");
    expect(payload.decision.reason).toBe("Duplicate request");
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ stateId: "state-canceled" }),
    );
  });

  it("rejects decisions for issues that are not currently in triage", async () => {
    selectResults = [[{ ...triageIssue, stateCategory: "backlog" }]];
    const { PATCH } = await import(
      "legacy-api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          action: "accept",
          destinationStateId: "state-backlog",
          confirmed: true,
        }),
      }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/not currently in triage/);
  });

  it("rejects destination statuses outside the team", async () => {
    selectResults = [[triageIssue], []];
    const { PATCH } = await import(
      "legacy-api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          action: "accept",
          destinationStateId: "state-other-team",
          confirmed: true,
        }),
      }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/not found/);
  });

  it("rejects destinations that are not allowed for the action", async () => {
    selectResults = [[triageIssue], [canceledDestination]];
    const { PATCH } = await import(
      "legacy-api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          action: "accept",
          destinationStateId: "state-canceled",
          confirmed: true,
        }),
      }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/not allowed/);
  });
});
