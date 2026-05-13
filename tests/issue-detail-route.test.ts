import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const issueLimitMock = vi.fn();
const stateWhereMock = vi.fn();
const assigneeWhereMock = vi.fn();
const creatorWhereMock = vi.fn();
const teamWhereMock = vi.fn();
const projectWhereMock = vi.fn();
const labelsWhereMock = vi.fn();
const commentsOrderByMock = vi.fn();
const subIssuesOrderByMock = vi.fn();
const reactionsWhereMock = vi.fn();
const attachmentsOrderByMock = vi.fn();
const stateLookupLimitMock = vi.fn();
const lastIssueLimitMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();
const insertHistoryValuesMock = vi.fn();
const getDownloadUrlMock = vi.fn();
const normalizeIssueDescriptionHtmlMock = vi.fn();
const buildNotificationValuesMock = vi.fn();
const insertNotificationsMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
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
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
}));

vi.mock("@/lib/notifications", () => ({
  buildNotificationValues: buildNotificationValuesMock,
  insertNotifications: insertNotificationsMock,
}));

vi.mock("@/lib/s3", () => ({
  getDownloadUrl: getDownloadUrlMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      selectCallCount += 1;

      if (selection && "identifier" in selection && "number" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: issueLimitMock,
              }),
            }),
          }),
        };
      }

      if (!selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: stateWhereMock,
          }),
        };
      }

      if (selection && "name" in selection && "image" in selection) {
        if (selectCallCount === 3) {
          return {
            from: vi.fn().mockReturnValue({
              where: assigneeWhereMock,
            }),
          };
        }

        return {
          from: vi.fn().mockReturnValue({
            where: creatorWhereMock,
          }),
        };
      }

      if (selection && "key" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: teamWhereMock,
          }),
        };
      }

      if (selection && "icon" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: projectWhereMock,
          }),
        };
      }

      if (selection && "labelName" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: labelsWhereMock,
            }),
          }),
        };
      }

      if (selection && "body" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: commentsOrderByMock,
              }),
            }),
          }),
        };
      }

      if (selection && "stateName" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: subIssuesOrderByMock,
              }),
            }),
          }),
        };
      }

      if (selection && "emoji" in selection && "commentId" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: reactionsWhereMock,
          }),
        };
      }

      if (selection && "storageKey" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: attachmentsOrderByMock,
            }),
          }),
        };
      }

      if (selection && "category" in selection && "teamId" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: stateLookupLimitMock,
            }),
          }),
        };
      }

      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: lastIssueLimitMock,
            }),
          }),
        }),
      };
    }),
    update: vi.fn(() => ({
      set: (...setArgs: unknown[]) => {
        updateSetMock(...setArgs);
        return {
          where: (...whereArgs: unknown[]) => {
            updateWhereMock(...whereArgs);
            return {
              returning: updateReturningMock,
            };
          },
        };
      },
    })),
    insert: vi.fn(() => ({
      values: (...valuesArgs: unknown[]) => {
        insertHistoryValuesMock(...valuesArgs);
        return Promise.resolve();
      },
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{ id: "issue-1" }]),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("issue detail route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCallCount = 0;
    getSessionMock.mockResolvedValue({
      user: { id: "user-1", name: "Ashley", email: "ashley@example.com" },
    });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    issueLimitMock.mockResolvedValue([
      {
        id: "issue-1",
        number: 1,
        identifier: "ENG-1",
        title: "Broken route",
        description: "<p>Hello</p>",
        priority: "high",
        stateId: "state-1",
        assigneeId: "user-2",
        creatorId: "user-3",
        projectId: "project-1",
        dueDate: new Date("2026-04-30T00:00:00.000Z"),
        estimate: 3,
        sortOrder: 2,
        createdAt: new Date("2026-04-23T09:00:00.000Z"),
        updatedAt: new Date("2026-04-23T10:00:00.000Z"),
        teamId: "team-1",
        workspaceId: "workspace-1",
        canceledAt: null,
        completedAt: null,
      },
    ]);
    stateWhereMock.mockResolvedValue([
      { id: "state-1", name: "Todo", category: "unstarted", color: "#999" },
    ]);
    assigneeWhereMock.mockResolvedValue([
      { id: "user-2", name: "Assignee", image: null },
    ]);
    creatorWhereMock.mockResolvedValue([
      { id: "user-3", name: "Creator", image: "https://img.test/u3.png" },
    ]);
    teamWhereMock.mockResolvedValue([
      { id: "team-1", name: "Engineering", key: "ENG" },
    ]);
    projectWhereMock.mockResolvedValue([
      { id: "project-1", name: "Ever", icon: "rocket" },
    ]);
    labelsWhereMock.mockResolvedValue([
      { labelName: "Bug", labelColor: "#f00" },
    ]);
    commentsOrderByMock.mockResolvedValue([
      {
        id: "comment-1",
        body: "first",
        userId: "user-4",
        userName: "Commenter",
        userImage: null,
        createdAt: new Date("2026-04-23T11:00:00.000Z"),
      },
    ]);
    subIssuesOrderByMock.mockResolvedValue([
      {
        id: "issue-2",
        identifier: "ENG-2",
        title: "Child issue",
        priority: "medium",
        stateId: "state-2",
        stateName: "In Progress",
        stateCategory: "started",
        stateColor: "#00f",
      },
    ]);
    reactionsWhereMock.mockResolvedValue([
      { commentId: "comment-1", emoji: "🔥", userId: "user-1" },
      { commentId: "comment-1", emoji: "🔥", userId: "user-5" },
    ]);
    attachmentsOrderByMock.mockResolvedValue([
      {
        id: "attachment-1",
        commentId: "comment-1",
        fileName: "spec.pdf",
        storageKey: "files/spec.pdf",
        contentType: "application/pdf",
        size: 42,
        createdAt: new Date("2026-04-23T11:01:00.000Z"),
      },
    ]);
    stateLookupLimitMock.mockResolvedValue([
      { id: "state-2", teamId: "team-1", category: "completed" },
    ]);
    lastIssueLimitMock.mockResolvedValue([{ sortOrder: 7 }]);
    updateReturningMock.mockResolvedValue([
      {
        id: "issue-1",
        title: "Updated title",
        description: "<p>normalized</p>",
        updatedAt: new Date("2026-04-23T12:00:00.000Z"),
        stateId: "state-2",
        sortOrder: 8,
      },
    ]);
    getDownloadUrlMock.mockResolvedValue("https://files.test/spec.pdf");
    normalizeIssueDescriptionHtmlMock.mockReturnValue("<p>normalized</p>");
    buildNotificationValuesMock.mockReturnValue([
      { type: "status_change", userId: "user-2" },
    ]);
    insertNotificationsMock.mockResolvedValue(undefined);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/issues/[id]/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "ENG-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns full issue detail payload", async () => {
    const { GET } = await import("@/app/api/issues/[id]/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "ENG-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "issue-1",
      number: 1,
      identifier: "ENG-1",
      title: "Broken route",
      description: "<p>Hello</p>",
      priority: "high",
      estimate: 3,
      dueDate: "2026-04-30T00:00:00.000Z",
      createdAt: "2026-04-23T09:00:00.000Z",
      updatedAt: "2026-04-23T10:00:00.000Z",
      state: {
        id: "state-1",
        name: "Todo",
        category: "unstarted",
        color: "#999",
      },
      assignee: { id: "user-2", name: "Assignee", image: null },
      creator: {
        id: "user-3",
        name: "Creator",
        image: "https://img.test/u3.png",
      },
      team: { id: "team-1", name: "Engineering", key: "ENG" },
      project: { id: "project-1", name: "Ever", icon: "rocket" },
      labels: [{ name: "Bug", color: "#f00" }],
      comments: [
        {
          id: "comment-1",
          body: "first",
          user: { name: "Commenter", image: null },
          createdAt: "2026-04-23T11:00:00.000Z",
          reactions: [{ emoji: "🔥", count: 2, reacted: true }],
          attachments: [
            {
              id: "attachment-1",
              fileName: "spec.pdf",
              contentType: "application/pdf",
              size: 42,
              downloadUrl: "https://files.test/spec.pdf",
            },
          ],
        },
      ],
      subIssues: [
        {
          id: "issue-2",
          identifier: "ENG-2",
          title: "Child issue",
          priority: "medium",
          state: {
            id: "state-2",
            name: "In Progress",
            category: "started",
            color: "#00f",
          },
        },
      ],
    });
  });

  it("returns 404 when patching a missing issue", async () => {
    issueLimitMock.mockResolvedValue([]);
    const { PATCH } = await import("@/app/api/issues/[id]/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ title: "New title" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Issue not found",
    });
  });

  it("rejects empty titles on patch", async () => {
    const { PATCH } = await import("@/app/api/issues/[id]/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ title: "   " }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "ENG-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Title cannot be empty",
    });
  });

  it("updates issue fields and emits status-change notifications", async () => {
    const { PATCH } = await import("@/app/api/issues/[id]/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          title: " Updated title ",
          description: "raw html",
          stateId: "state-2",
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "ENG-1" }) },
    );

    expect(response.status).toBe(200);
    expect(normalizeIssueDescriptionHtmlMock).toHaveBeenCalledWith("raw html");
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updated title",
        description: "<p>normalized</p>",
        stateId: "state-2",
        completedAt: expect.any(Date),
        canceledAt: null,
        sortOrder: 8,
        updatedAt: expect.any(Date),
      }),
    );
    expect(insertNotificationsMock).toHaveBeenCalledWith([
      { type: "status_change", userId: "user-2" },
    ]);
    expect(insertHistoryValuesMock).toHaveBeenCalledWith({
      issueId: "issue-1",
      actorId: "user-1",
      actorName: "Ashley",
      actorEmail: "ashley@example.com",
      eventType: "updated",
      metadata: {
        changedFields: ["title", "description", "stateId"],
        identifier: "ENG-1",
      },
    });
    await expect(response.json()).resolves.toEqual({
      id: "issue-1",
      title: "Updated title",
      description: "<p>normalized</p>",
      updatedAt: "2026-04-23T12:00:00.000Z",
      stateId: "state-2",
      sortOrder: 8,
    });
  });

  it("deletes an issue", async () => {
    const { DELETE } = await import("@/app/api/issues/[id]/route");

    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "ENG-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });
});
