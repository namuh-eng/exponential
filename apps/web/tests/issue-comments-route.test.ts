import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const issueLimitMock = vi.fn();
const resolveMentionedUserIdsMock = vi.fn();
const buildNotificationValuesMock = vi.fn();
const insertNotificationsMock = vi.fn();
const insertCommentValuesMock = vi.fn();
const insertHistoryValuesMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const getIssueNotificationRecipientsMock = vi.fn();
const randomUuidMock = vi.spyOn(crypto, "randomUUID");

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/s3", () => ({
  buildKey: vi.fn(),
  uploadFile: vi.fn(),
  getDownloadUrl: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  resolveMentionedUserIds: resolveMentionedUserIdsMock,
  buildNotificationValues: buildNotificationValuesMock,
  insertNotifications: insertNotificationsMock,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/issue-subscriptions", () => ({
  getIssueNotificationRecipients: getIssueNotificationRecipientsMock,
}));

vi.mock("@/lib/db/schema", () => ({
  issue: {},
  team: {},
  comment: { __name: "comment" },
  commentAttachment: { __name: "commentAttachment" },
  issueHistory: { __name: "issueHistory" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: issueLimitMock,
          }),
        }),
      }),
    })),
    transaction: vi.fn(
      async (
        callback: (tx: {
          insert: (table: { __name?: string }) => unknown;
        }) => Promise<unknown>,
      ) => {
        const tx = {
          insert: (table: { __name?: string }) => ({
            values: (...valuesArgs: unknown[]) => {
              if (table.__name === "issueHistory") {
                insertHistoryValuesMock(...valuesArgs);
                return Promise.resolve();
              }

              insertCommentValuesMock(...valuesArgs);
              return {
                returning: vi.fn().mockResolvedValue([
                  {
                    id: "comment-1",
                    body: "Hello team",
                    createdAt: new Date("2026-04-23T12:00:00.000Z"),
                  },
                ]),
              };
            },
          }),
        };

        return callback(tx);
      },
    ),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const issueRecord = {
  id: "issue-1",
  workspaceId: "workspace-1",
  assigneeId: "user-2",
  creatorId: "user-3",
};

describe("issue comments route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    randomUuidMock.mockReset();
    randomUuidMock.mockReturnValue("comment-1");
    getSessionMock.mockResolvedValue({
      user: {
        id: "user-1",
        name: "Ashley",
        email: "ashley@example.com",
        image: null,
      },
    });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    issueLimitMock.mockReset();
    issueLimitMock.mockResolvedValue([issueRecord]);
    resolveMentionedUserIdsMock.mockResolvedValue(["user-3"]);
    getIssueNotificationRecipientsMock.mockResolvedValue(["user-2", "user-3"]);
    buildNotificationValuesMock.mockImplementation(({ type, userIds }) =>
      userIds.map((userId: string) => ({ type, userId })),
    );
    insertNotificationsMock.mockResolvedValue(undefined);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/issues/[id]/comments/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ISS-1/comments", {
        method: "POST",
        body: JSON.stringify({ body: "Hello" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "ISS-1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 when the issue does not exist", async () => {
    issueLimitMock.mockResolvedValue([]);
    const { POST } = await import("@/app/api/issues/[id]/comments/route");

    const response = await POST(
      new Request("http://localhost/api/issues/missing/comments", {
        method: "POST",
        body: JSON.stringify({ body: "Hello" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Issue not found",
    });
  });

  it("rejects empty comment bodies when there are no attachments", async () => {
    const { POST } = await import("@/app/api/issues/[id]/comments/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ISS-1/comments", {
        method: "POST",
        body: JSON.stringify({ body: "   " }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "ISS-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Comment body or attachments are required",
    });
  });

  it("creates a json comment and emits deduplicated notifications", async () => {
    const { POST } = await import("@/app/api/issues/[id]/comments/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ISS-1/comments", {
        method: "POST",
        body: JSON.stringify({ body: "Hello @user-3" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "ISS-1" }) },
    );

    expect(response.status).toBe(200);
    expect(insertCommentValuesMock).toHaveBeenCalledWith({
      id: "comment-1",
      body: "Hello @user-3",
      issueId: "issue-1",
      userId: "user-1",
    });
    expect(insertHistoryValuesMock).toHaveBeenCalledWith({
      issueId: "issue-1",
      actorId: "user-1",
      actorName: "Ashley",
      actorEmail: "ashley@example.com",
      eventType: "comment_created",
      metadata: {
        commentId: "comment-1",
        attachmentCount: 0,
      },
    });
    expect(resolveMentionedUserIdsMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      body: "Hello @user-3",
      userIds: [],
    });
    expect(getIssueNotificationRecipientsMock).toHaveBeenCalledWith({
      actorId: "user-1",
      issueId: "issue-1",
      baseUserIds: ["user-2", "user-3"],
      mentionedUserIds: ["user-3"],
    });
    expect(insertNotificationsMock).toHaveBeenCalledWith([
      { type: "mentioned", userId: "user-3" },
      { type: "comment", userId: "user-2" },
    ]);
    await expect(response.json()).resolves.toEqual({
      id: "comment-1",
      body: "Hello team",
      createdAt: "2026-04-23T12:00:00.000Z",
      user: {
        name: "Ashley",
        image: null,
      },
      ownedByMe: true,
      canEdit: true,
      canDelete: true,
      reactions: [],
      attachments: [],
    });
  });

  it("passes canonical selected mention ids to notification resolution", async () => {
    resolveMentionedUserIdsMock.mockResolvedValue(["sam-2"]);
    getIssueNotificationRecipientsMock.mockResolvedValue(["sam-2", "user-2"]);
    const { POST } = await import("@/app/api/issues/[id]/comments/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ISS-1/comments", {
        method: "POST",
        body: JSON.stringify({
          body: "Hi @[Sam Lee](user:sam-2)",
          mentionedUserIds: ["sam-2"],
        }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "ISS-1" }) },
    );

    expect(response.status).toBe(200);
    expect(resolveMentionedUserIdsMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      body: "Hi @[Sam Lee](user:sam-2)",
      userIds: ["sam-2"],
    });
    expect(insertNotificationsMock).toHaveBeenCalledWith([
      { type: "mentioned", userId: "sam-2" },
      { type: "comment", userId: "user-2" },
    ]);
  });
});
