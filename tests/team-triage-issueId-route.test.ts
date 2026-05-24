import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const updateSetMock = vi.fn();
const updateReturningMock = vi.fn();
const insertValuesMock = vi.fn(() => ({
  onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
}));
const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
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

vi.mock("@/lib/label-application", () => ({
  normalizeApplicableIssueLabelIds: vi.fn(async ({ labelIds }) => ({
    ok: true,
    labelIds,
  })),
}));

vi.mock("@/lib/issue-subscriptions", () => ({
  setIssueSubscription: vi.fn(({ issueId, userId, subscribed, client }) =>
    client.insert({}).values({ issueId, userId, subscribed }),
  ),
}));

function makeDbMock() {
  const dbMock = {
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
    delete: vi.fn(() => ({ where: deleteWhereMock })),
    insert: vi.fn(() => ({ values: insertValuesMock })),
  };
  return {
    ...dbMock,
    transaction: vi.fn((callback) => callback(dbMock)),
  };
}

vi.mock("@/lib/db", () => ({
  db: makeDbMock(),
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
      settings: {},
    });
    updateReturningMock.mockReturnValue([
      { id: "issue-1", stateId: "state-backlog" },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { PATCH } = await import(
      "@/app/api/teams/[key]/triage/[issueId]/route"
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
      "@/app/api/teams/[key]/triage/[issueId]/route"
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
      "@/app/api/teams/[key]/triage/[issueId]/route"
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

  it("requires explicit confirmation", async () => {
    const { PATCH } = await import(
      "@/app/api/teams/[key]/triage/[issueId]/route"
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
      "@/app/api/teams/[key]/triage/[issueId]/route"
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
      "@/app/api/teams/[key]/triage/[issueId]/route"
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

  it("persists accept metadata, comment, labels, and subscription atomically", async () => {
    selectResults = [
      [triageIssue],
      [backlogDestination],
      [{ id: "member-1" }],
      [{ id: "project-1" }],
      [{ id: "milestone-1", projectId: "project-1" }],
      [{ id: "cycle-1" }],
    ];
    const { PATCH } = await import(
      "@/app/api/teams/[key]/triage/[issueId]/route"
    );

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          action: "accept",
          destinationStateId: "state-backlog",
          confirmed: true,
          priority: "high",
          estimate: 3,
          assigneeId: "user-2",
          projectId: "project-1",
          projectMilestoneId: "milestone-1",
          cycleId: "cycle-1",
          labelIds: ["label-1"],
          comment: "Accepted with context",
          subscribe: true,
        }),
      }),
      {
        params: Promise.resolve({ key: "ENG", issueId: "issue-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stateId: "state-backlog",
        priority: "high",
        estimate: 3,
        assigneeId: "user-2",
        projectId: "project-1",
        projectMilestoneId: "milestone-1",
        cycleId: "cycle-1",
      }),
    );
    expect(insertValuesMock).toHaveBeenCalledWith([
      { issueId: "issue-1", labelId: "label-1" },
    ]);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Accepted with context",
        issueId: "issue-1",
        userId: "user-1",
      }),
    );
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "issue-1",
        userId: "user-1",
        subscribed: true,
      }),
    );
  });
  it("rejects decisions for issues that are not currently in triage", async () => {
    selectResults = [[{ ...triageIssue, stateCategory: "backlog" }]];
    const { PATCH } = await import(
      "@/app/api/teams/[key]/triage/[issueId]/route"
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
      "@/app/api/teams/[key]/triage/[issueId]/route"
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
      "@/app/api/teams/[key]/triage/[issueId]/route"
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
