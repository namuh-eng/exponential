import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const notificationLimitMock = vi.fn();
const unreadWhereMock = vi.fn();
const unreadRowsMock = vi.fn();
let selectCallCount = 0;

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      selectCallCount += 1;

      if (selectCallCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockReturnValue({
                    limit: notificationLimitMock,
                  }),
                }),
              }),
            }),
          }),
        };
      }

      return {
        from: vi.fn().mockReturnValue({
          where: (...whereArgs: unknown[]) => {
            unreadWhereMock(...whereArgs);
            return unreadRowsMock();
          },
        }),
      };
    }),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("notifications route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCallCount = 0;
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    unreadRowsMock.mockResolvedValue([{ count: 2 }]);
    notificationLimitMock.mockResolvedValue([
      {
        id: "notif-1",
        type: "comment",
        actorName: "Ashley",
        actorImage: null,
        issueId: "issue-1",
        issueIdentifier: "ENG-1",
        issueTitle: "Ship notifications",
        issuePriority: "high",
        readAt: null,
        createdAt: new Date("2026-04-23T11:00:00.000Z"),
      },
      {
        id: "notif-2",
        type: "mentioned",
        actorName: null,
        actorImage: "https://img.test/a.png",
        issueId: null,
        issueIdentifier: null,
        issueTitle: null,
        issuePriority: null,
        readAt: new Date("2026-04-23T12:00:00.000Z"),
        createdAt: new Date("2026-04-23T12:30:00.000Z"),
      },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/notifications/route");

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns normalized notifications with unread count", async () => {
    const { GET } = await import("@/app/api/notifications/route");

    const response = await GET();

    expect(response.status).toBe(200);
    expect(unreadWhereMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      notifications: [
        {
          id: "notif-1",
          type: "comment",
          actorName: "Ashley",
          actorImage: null,
          issueIdentifier: "ENG-1",
          issueTitle: "Ship notifications",
          issuePriority: "high",
          issueId: "issue-1",
          readAt: null,
          snoozedUntilAt: null,
          unsnoozedAt: null,
          createdAt: "2026-04-23T11:00:00.000Z",
        },
        {
          id: "notif-2",
          type: "mentioned",
          actorName: "Unknown",
          actorImage: "https://img.test/a.png",
          issueIdentifier: "",
          issueTitle: "",
          issuePriority: "none",
          issueId: null,
          readAt: "2026-04-23T12:00:00.000Z",
          snoozedUntilAt: null,
          unsnoozedAt: null,
          createdAt: "2026-04-23T12:30:00.000Z",
        },
      ],
      unreadCount: 2,
    });
  });

  it("defaults unread count to zero when the aggregate row is missing", async () => {
    unreadRowsMock.mockResolvedValueOnce([]);
    const { GET } = await import("@/app/api/notifications/route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ unreadCount: 0 });
  });
});
