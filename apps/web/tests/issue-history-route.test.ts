import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const issueLimitMock = vi.fn();
const historyOrderByMock = vi.fn();
const historyFromMock = vi.fn();

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

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection: Record<string, unknown>) => {
      if ("type" in selection && "metadata" in selection) {
        return {
          from: (...fromArgs: unknown[]) => {
            historyFromMock(...fromArgs);
            return {
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: historyOrderByMock,
                }),
              }),
            };
          },
        };
      }

      return {
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: issueLimitMock,
            }),
          }),
        }),
      };
    }),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const issueRecord = {
  id: "issue-1",
  identifier: "ENG-1",
  title: "Audit this",
  creatorId: "user-2",
  createdAt: new Date("2026-04-23T09:00:00.000Z"),
  workspaceId: "workspace-1",
};

describe("issue history route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    issueLimitMock.mockResolvedValue([issueRecord]);
    historyOrderByMock.mockResolvedValue([
      {
        id: "history-1",
        type: "created",
        metadata: { identifier: "ENG-1" },
        actorId: "user-1",
        actorName: "Snapshot Name",
        actorEmail: "snapshot@example.com",
        currentActorName: "Current Name",
        currentActorEmail: "current@example.com",
        createdAt: new Date("2026-04-23T09:01:00.000Z"),
      },
      {
        id: "history-2",
        type: "updated",
        metadata: { changedFields: ["title"] },
        actorId: "user-1",
        actorName: "Snapshot Name",
        actorEmail: "snapshot@example.com",
        currentActorName: null,
        currentActorEmail: null,
        createdAt: new Date("2026-04-23T10:00:00.000Z"),
      },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/issues/[id]/history/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "ENG-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns persisted history events in chronological order", async () => {
    const { GET } = await import("legacy-api/issues/[id]/history/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "ENG-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      history: [
        {
          id: "history-1",
          type: "created",
          metadata: { identifier: "ENG-1" },
          actor: {
            id: "user-1",
            name: "Current Name",
            email: "current@example.com",
          },
          createdAt: "2026-04-23T09:01:00.000Z",
        },
        {
          id: "history-2",
          type: "updated",
          metadata: { changedFields: ["title"] },
          actor: {
            id: "user-1",
            name: "Snapshot Name",
            email: "snapshot@example.com",
          },
          createdAt: "2026-04-23T10:00:00.000Z",
        },
      ],
    });
  });

  it("blocks cross-workspace history access", async () => {
    issueLimitMock.mockResolvedValue([
      { ...issueRecord, workspaceId: "workspace-2" },
    ]);
    const { GET } = await import("legacy-api/issues/[id]/history/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "ENG-1" }),
    });

    expect(response.status).toBe(404);
    expect(historyFromMock).not.toHaveBeenCalled();
  });

  it("returns a migration fallback when legacy issues have no audit rows", async () => {
    historyOrderByMock.mockResolvedValue([]);
    const { GET } = await import("legacy-api/issues/[id]/history/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "ENG-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      history: [
        {
          id: "legacy-created-issue-1",
          type: "created",
          metadata: {
            identifier: "ENG-1",
            title: "Audit this",
            migrationFallback: true,
          },
          actor: { id: "user-2", name: null, email: null },
          createdAt: "2026-04-23T09:00:00.000Z",
        },
      ],
    });
  });
});
