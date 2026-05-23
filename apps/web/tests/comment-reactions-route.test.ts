import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const commentLimitMock = vi.fn();
const existingReactionLimitMock = vi.fn();
const nextReactionsWhereMock = vi.fn();
const deleteWhereMock = vi.fn();
const insertValuesMock = vi.fn();
let selectCallCount = 0;

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/db/schema", () => ({
  comment: {},
  reaction: { __name: "reaction" },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");

  return {
    db: {
      select: vi.fn(() => {
        selectCallCount += 1;

        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: commentLimitMock,
              }),
            }),
          };
        }

        if (selectCallCount === 2) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: existingReactionLimitMock,
              }),
            }),
          };
        }

        return {
          from: vi.fn().mockReturnValue({
            where: (...whereArgs: unknown[]) => {
              nextReactionsWhereMock(...whereArgs);
              return Promise.resolve([
                { emoji: "🔥", userId: "user-1" },
                { emoji: "🔥", userId: "user-2" },
              ]);
            },
          }),
        };
      }),
      delete: vi.fn((table: unknown) => {
        if (table === schema.reaction) {
          return {
            where: (...whereArgs: unknown[]) => {
              deleteWhereMock(...whereArgs);
              return Promise.resolve();
            },
          };
        }
        return { where: vi.fn() };
      }),
      insert: vi.fn((table: unknown) => {
        if (table === schema.reaction) {
          return {
            values: (...valuesArgs: unknown[]) => {
              insertValuesMock(...valuesArgs);
              return Promise.resolve();
            },
          };
        }
        return { values: vi.fn() };
      }),
    },
  };
});

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("comment reactions route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCallCount = 0;
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    commentLimitMock.mockResolvedValue([{ id: "comment-1" }]);
    existingReactionLimitMock.mockResolvedValue([]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/comments/[id]/reactions/route");

    const response = await POST(
      new Request("http://localhost/api/comments/comment-1/reactions", {
        method: "POST",
        body: JSON.stringify({ emoji: "🔥" }),
      }),
      { params: Promise.resolve({ id: "comment-1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("rejects missing emoji values", async () => {
    const { POST } = await import("@/app/api/comments/[id]/reactions/route");

    const response = await POST(
      new Request("http://localhost/api/comments/comment-1/reactions", {
        method: "POST",
        body: JSON.stringify({ emoji: "   " }),
      }),
      { params: Promise.resolve({ id: "comment-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Emoji is required",
    });
  });

  it("returns 404 when the comment does not exist", async () => {
    commentLimitMock.mockResolvedValue([]);
    const { POST } = await import("@/app/api/comments/[id]/reactions/route");

    const response = await POST(
      new Request("http://localhost/api/comments/missing/reactions", {
        method: "POST",
        body: JSON.stringify({ emoji: "🔥" }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Comment not found",
    });
  });

  it("creates a reaction and returns summarized counts", async () => {
    const { POST } = await import("@/app/api/comments/[id]/reactions/route");

    const response = await POST(
      new Request("http://localhost/api/comments/comment-1/reactions", {
        method: "POST",
        body: JSON.stringify({ emoji: "🔥" }),
      }),
      { params: Promise.resolve({ id: "comment-1" }) },
    );

    expect(response.status).toBe(200);
    expect(insertValuesMock).toHaveBeenCalledWith({
      commentId: "comment-1",
      userId: "user-1",
      emoji: "🔥",
    });
    await expect(response.json()).resolves.toEqual([
      { emoji: "🔥", count: 2, reacted: true },
    ]);
  });

  it("toggles an existing reaction off", async () => {
    existingReactionLimitMock.mockResolvedValue([{ id: "reaction-1" }]);
    const { POST } = await import("@/app/api/comments/[id]/reactions/route");

    const response = await POST(
      new Request("http://localhost/api/comments/comment-1/reactions", {
        method: "POST",
        body: JSON.stringify({ emoji: "🔥" }),
      }),
      { params: Promise.resolve({ id: "comment-1" }) },
    );

    expect(response.status).toBe(200);
    expect(deleteWhereMock).toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
});
