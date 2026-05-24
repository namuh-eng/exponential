import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const teamLimitMock = vi.fn();
const maxWhereMock = vi.fn();
const defaultStateLimitMock = vi.fn();
const currentUserLimitMock = vi.fn();
const teamMemberWhereMock = vi.fn();
const loadGroupByMock = vi.fn();
const insertIssueValuesMock = vi.fn();
const insertLabelsValuesMock = vi.fn();
const insertHistoryValuesMock = vi.fn();
const insertRelationValuesMock = vi.fn();
const insertSubscriptionValuesMock = vi.fn();
const buildNotificationValuesMock = vi.fn();
const insertNotificationsMock = vi.fn();
const normalizeIssueDescriptionHtmlMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
let selectCallCount = 0;

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/issue-description", () => ({
  normalizeIssueDescriptionHtml: normalizeIssueDescriptionHtmlMock,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/notifications", () => ({
  buildNotificationValues: buildNotificationValuesMock,
  insertNotifications: insertNotificationsMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      selectCallCount += 1;

      if (selection.id === "cycle.id") {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: "cycle-1" }]),
            }),
          }),
        };
      }

      if ("key" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: teamLimitMock,
            }),
          }),
        };
      }

      if ("settings" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: currentUserLimitMock,
            }),
          }),
        };
      }

      if ("userId" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: teamMemberWhereMock,
          }),
        };
      }

      if ("assigneeId" in selection && "value" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: loadGroupByMock,
            }),
          }),
        };
      }

      if ("parentLabelId" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: "label-1", parentLabelId: null },
              { id: "label-2", parentLabelId: null },
            ]),
          }),
        };
      }

      if ("maxNum" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: maxWhereMock,
          }),
        };
      }

      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: defaultStateLimitMock,
          }),
        }),
      };
    }),
    transaction: vi.fn(
      async (
        callback: (tx: {
          insert: (table: unknown) => unknown;
        }) => Promise<unknown>,
      ) => {
        const tx = {
          insert: (table: unknown) => {
            const typedTable = table as { __name?: string };
            if (typedTable.__name === "issueLabel") {
              return {
                values: (...valuesArgs: unknown[]) => {
                  insertLabelsValuesMock(...valuesArgs);
                  return Promise.resolve();
                },
              };
            }

            if (typedTable.__name === "issueHistory") {
              return {
                values: (...valuesArgs: unknown[]) => {
                  insertHistoryValuesMock(...valuesArgs);
                  return Promise.resolve();
                },
              };
            }

            if (typedTable.__name === "issueRelation") {
              return {
                values: (...valuesArgs: unknown[]) => {
                  insertRelationValuesMock(...valuesArgs);
                  return Promise.resolve();
                },
              };
            }

            if (typedTable.__name === "issueSubscription") {
              return {
                values: (...valuesArgs: unknown[]) => {
                  insertSubscriptionValuesMock(...valuesArgs);
                  return Promise.resolve();
                },
              };
            }

            return {
              values: (...valuesArgs: unknown[]) => {
                insertIssueValuesMock(...valuesArgs);
                return {
                  returning: vi.fn().mockResolvedValue([
                    {
                      id: "issue-1",
                      number: 8,
                      identifier: "ENG-8",
                      title: "Ship this",
                      description: "<p>normalized</p>",
                      teamId: "team-1",
                      stateId: "state-backlog",
                      creatorId: "user-1",
                      priority: "high",
                      assigneeId: "user-2",
                      projectId: "project-1",
                      cycleId: null,
                      parentIssueId: null,
                      estimate: null,
                      dueDate: null,
                    },
                  ]),
                };
              },
            };
          },
        };

        return callback(tx);
      },
    ),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  cycle: { id: "cycle.id", teamId: "cycle.teamId" },
  issue: { __name: "issue", assigneeId: "issue.assigneeId" },
  issueHistory: { __name: "issueHistory" },
  issueLabel: { __name: "issueLabel" },
  issueRelation: { __name: "issueRelation" },
  issueSubscription: { __name: "issueSubscription" },
  label: {
    id: "label.id",
    parentLabelId: "label.parentLabelId",
    workspaceId: "label.workspaceId",
    archivedAt: "label.archivedAt",
    teamId: "label.teamId",
  },
  team: {},
  teamMember: {},
  user: { id: "user.id", settings: "user.settings" },
  workflowState: {},
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("issues route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCallCount = 0;
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", name: "Ashley", email: "ashley@example.com" },
    });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    teamLimitMock.mockResolvedValue([
      { id: "team-1", key: "ENG", workspaceId: "workspace-1", settings: {} },
    ]);
    maxWhereMock.mockResolvedValue([{ maxNum: 7 }]);
    defaultStateLimitMock.mockResolvedValue([{ id: "state-backlog" }]);
    currentUserLimitMock.mockResolvedValue([{ settings: {} }]);
    teamMemberWhereMock.mockResolvedValue([]);
    loadGroupByMock.mockResolvedValue([]);
    normalizeIssueDescriptionHtmlMock.mockReturnValue("<p>normalized</p>");
    buildNotificationValuesMock.mockReturnValue([
      { type: "assigned", userId: "user-2" },
    ]);
    insertNotificationsMock.mockResolvedValue(undefined);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/issues/route");

    const response = await POST(
      new Request("http://localhost/api/issues", {
        method: "POST",
        body: JSON.stringify({ title: "Ship this", teamId: "team-1" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("requires title and teamId", async () => {
    const { POST } = await import("@/app/api/issues/route");

    const response = await POST(
      new Request("http://localhost/api/issues", {
        method: "POST",
        body: JSON.stringify({ title: "   " }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Title and teamId are required",
    });
  });

  it("returns 404 when the team is missing", async () => {
    teamLimitMock.mockResolvedValue([]);
    const { POST } = await import("@/app/api/issues/route");

    const response = await POST(
      new Request("http://localhost/api/issues", {
        method: "POST",
        body: JSON.stringify({ title: "Ship this", teamId: "team-1" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Team not found" });
  });

  it("returns 400 when no default workflow state exists", async () => {
    defaultStateLimitMock.mockResolvedValue([]);
    const { POST } = await import("@/app/api/issues/route");

    const response = await POST(
      new Request("http://localhost/api/issues", {
        method: "POST",
        body: JSON.stringify({ title: "Ship this", teamId: "team-1" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "No default workflow state found",
    });
  });

  it("creates an issue with deduped labels and assignment notification", async () => {
    const { POST } = await import("@/app/api/issues/route");

    const response = await POST(
      new Request("http://localhost/api/issues", {
        method: "POST",
        body: JSON.stringify({
          title: " Ship this ",
          description: "raw description",
          teamId: "team-1",
          priority: "high",
          assigneeId: "user-2",
          projectId: "project-1",
          labelIds: ["label-1", "label-1", "label-2", ""],
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(201);
    expect(normalizeIssueDescriptionHtmlMock).toHaveBeenCalledWith(
      "raw description",
    );
    expect(insertIssueValuesMock).toHaveBeenCalledWith({
      number: 8,
      identifier: "ENG-8",
      title: "Ship this",
      description: "<p>normalized</p>",
      teamId: "team-1",
      stateId: "state-backlog",
      creatorId: "user-1",
      priority: "high",
      assigneeId: "user-2",
      projectId: "project-1",
      cycleId: null,
      parentIssueId: null,
      estimate: null,
      dueDate: null,
    });
    expect(insertLabelsValuesMock).toHaveBeenCalledWith([
      { issueId: "issue-1", labelId: "label-1" },
      { issueId: "issue-1", labelId: "label-2" },
    ]);
    expect(insertHistoryValuesMock).toHaveBeenCalledWith({
      issueId: "issue-1",
      actorId: "user-1",
      actorName: "Ashley",
      actorEmail: "ashley@example.com",
      eventType: "created",
      metadata: {
        identifier: "ENG-8",
        title: "Ship this",
        teamId: "team-1",
        cycleId: null,
        estimate: null,
        dueDate: null,
        parentIssueId: null,
        relatedIssueId: null,
      },
    });
    expect(insertNotificationsMock).toHaveBeenCalledWith([
      { type: "assigned", userId: "user-2" },
    ]);
    await expect(response.json()).resolves.toEqual({
      id: "issue-1",
      number: 8,
      identifier: "ENG-8",
      title: "Ship this",
      description: "<p>normalized</p>",
      teamId: "team-1",
      stateId: "state-backlog",
      creatorId: "user-1",
      priority: "high",
      assigneeId: "user-2",
      projectId: "project-1",
      cycleId: null,
      parentIssueId: null,
      estimate: null,
      dueDate: null,
    });
  });

  it("persists composer planning metadata and creation relations", async () => {
    const { POST } = await import("@/app/api/issues/route");

    const response = await POST(
      new Request("http://localhost/api/issues", {
        method: "POST",
        body: JSON.stringify({
          title: "Plan metadata",
          teamId: "team-1",
          cycleId: "cycle-1",
          estimate: 5,
          dueDate: "2026-06-01",
          parentIssueId: "parent-1",
          relatedIssueId: "related-1",
          relationType: "related",
          subscribe: true,
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(201);
    expect(insertIssueValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cycleId: "cycle-1",
        estimate: 5,
        dueDate: new Date("2026-06-01T00:00:00.000Z"),
        parentIssueId: "parent-1",
      }),
    );
    expect(insertRelationValuesMock).toHaveBeenCalledWith({
      issueId: "issue-1",
      relatedIssueId: "related-1",
      type: "related",
    });
    expect(insertSubscriptionValuesMock).toHaveBeenCalledWith({
      issueId: "issue-1",
      userId: "user-1",
      subscribed: true,
    });
    expect(insertHistoryValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          cycleId: "cycle-1",
          estimate: 5,
          dueDate: "2026-06-01T00:00:00.000Z",
          parentIssueId: "parent-1",
          relatedIssueId: "related-1",
        }),
      }),
    );
  });

  it("creates a cycle-scoped issue when the cycle belongs to the team", async () => {
    const { POST } = await import("@/app/api/issues/route");

    const response = await POST(
      new Request("http://localhost/api/issues", {
        method: "POST",
        body: JSON.stringify({
          title: "Cycle task",
          teamId: "team-1",
          cycleId: "cycle-1",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(201);
    expect(insertIssueValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ cycleId: "cycle-1" }),
    );
  });

  it("uses account auto-assignment preference before team load balancing", async () => {
    currentUserLimitMock.mockResolvedValue([
      {
        settings: {
          accountPreferences: {
            automations: { autoAssignment: "assign-to-me" },
          },
        },
      },
    ]);
    teamLimitMock.mockResolvedValue([
      {
        id: "team-1",
        key: "ENG",
        workspaceId: "workspace-1",
        settings: { autoAssignment: true },
      },
    ]);

    const { POST } = await import("@/app/api/issues/route");

    const response = await POST(
      new Request("http://localhost/api/issues", {
        method: "POST",
        body: JSON.stringify({
          title: "Assign me",
          teamId: "team-1",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(201);
    expect(teamMemberWhereMock).not.toHaveBeenCalled();
    expect(insertIssueValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: "user-1" }),
    );
  });

  it("auto-assigns new unassigned issues to the lightest-loaded team member", async () => {
    teamLimitMock.mockResolvedValue([
      {
        id: "team-1",
        key: "ENG",
        workspaceId: "workspace-1",
        settings: { autoAssignment: true },
      },
    ]);
    teamMemberWhereMock.mockResolvedValue([
      { userId: "user-heavy" },
      { userId: "user-light" },
    ]);
    loadGroupByMock.mockResolvedValue([{ assigneeId: "user-heavy", value: 3 }]);

    const { POST } = await import("@/app/api/issues/route");

    const response = await POST(
      new Request("http://localhost/api/issues", {
        method: "POST",
        body: JSON.stringify({
          title: "Triage me",
          teamId: "team-1",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(201);
    expect(insertIssueValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: "user-light" }),
    );
  });
});
