import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const issueLimitMock = vi.fn();
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

vi.mock("@/lib/active-workspace", () => ({
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
}));

vi.mock("@/lib/db/schema", () => ({
  issue: {},
  team: {},
  issueReaction: { __name: "issueReaction" },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");

  return {
    db: {
      select: vi.fn((selection?: Record<string, unknown>) => {
        selectCallCount += 1;
        const selectionKeys = Object.keys(selection ?? {});

        if (selectionKeys.includes("emoji")) {
          return {
            from: vi.fn().mockReturnValue({
              where: (...whereArgs: unknown[]) => {
                nextReactionsWhereMock(...whereArgs);
                return Promise.resolve([
                  { emoji: "👍", userId: "user-1" },
                  { emoji: "👍", userId: "user-2" },
                  { emoji: "🚀", userId: "user-2" },
                ]);
              },
            }),
          };
        }

        if (selectCallCount === 1) {
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

        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: existingReactionLimitMock,
            }),
          }),
        };
      }),
      delete: vi.fn((table: unknown) => {
        if (table === schema.issueReaction) {
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
        if (table === schema.issueReaction) {
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

describe("issue reactions route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCallCount = 0;
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    issueLimitMock.mockResolvedValue([{ id: "issue-1" }]);
    existingReactionLimitMock.mockResolvedValue([]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { POST } = await import("@/app/api/issues/[id]/reactions/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ENG-1/reactions", {
        method: "POST",
        body: JSON.stringify({ emoji: "👍" }),
      }),
      { params: Promise.resolve({ id: "ENG-1" }) },
    );

    expect(response.status).toBe(401);
  });

  it("rejects missing emoji values", async () => {
    const { POST } = await import("@/app/api/issues/[id]/reactions/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ENG-1/reactions", {
        method: "POST",
        body: JSON.stringify({ emoji: "   " }),
      }),
      { params: Promise.resolve({ id: "ENG-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Emoji is required",
    });
  });

  it("returns 404 when the issue does not exist", async () => {
    issueLimitMock.mockResolvedValue([]);
    const { POST } = await import("@/app/api/issues/[id]/reactions/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ENG-404/reactions", {
        method: "POST",
        body: JSON.stringify({ emoji: "👍" }),
      }),
      { params: Promise.resolve({ id: "ENG-404" }) },
    );

    expect(response.status).toBe(404);
  });

  it("creates an issue reaction and returns issue-level counts", async () => {
    const { POST } = await import("@/app/api/issues/[id]/reactions/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ENG-1/reactions", {
        method: "POST",
        body: JSON.stringify({ emoji: "👍" }),
      }),
      { params: Promise.resolve({ id: "ENG-1" }) },
    );

    expect(response.status).toBe(200);
    expect(insertValuesMock).toHaveBeenCalledWith({
      issueId: "issue-1",
      userId: "user-1",
      emoji: "👍",
    });
    await expect(response.json()).resolves.toEqual([
      { emoji: "👍", count: 2, reactedByMe: true },
      { emoji: "🚀", count: 1, reactedByMe: false },
    ]);
  });

  it("toggles an existing issue reaction off without inserting a duplicate", async () => {
    existingReactionLimitMock.mockResolvedValue([{ id: "reaction-1" }]);
    const { POST } = await import("@/app/api/issues/[id]/reactions/route");

    const response = await POST(
      new Request("http://localhost/api/issues/ENG-1/reactions", {
        method: "POST",
        body: JSON.stringify({ emoji: "👍" }),
      }),
      { params: Promise.resolve({ id: "ENG-1" }) },
    );

    expect(response.status).toBe(200);
    expect(deleteWhereMock).toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
  it("removes an issue reaction idempotently", async () => {
    const { DELETE } = await import("@/app/api/issues/[id]/reactions/route");

    const response = await DELETE(
      new Request("http://localhost/api/issues/ENG-1/reactions", {
        method: "DELETE",
        body: JSON.stringify({ emoji: "👍" }),
      }),
      { params: Promise.resolve({ id: "ENG-1" }) },
    );

    expect(response.status).toBe(200);
    expect(deleteWhereMock).toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual([
      { emoji: "👍", count: 2, reactedByMe: true },
      { emoji: "🚀", count: 1, reactedByMe: false },
    ]);
  });
});
