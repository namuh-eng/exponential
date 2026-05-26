import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();
const selectWhereMock = vi.fn();
const selectRowsMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
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
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        where: (...whereArgs: unknown[]) => {
          selectWhereMock(...whereArgs);
          return selectRowsMock();
        },
      }),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("notification management routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    updateReturningMock.mockResolvedValue([{ id: "notif-1" }]);
    selectRowsMock.mockResolvedValue([{ count: 1 }]);
  });

  it("marks a notification unread and returns the snooze-aware unread count", async () => {
    const { PATCH } = await import(
      "legacy-api/notifications/[id]/unread/route"
    );

    const response = await PATCH({} as never, {
      params: Promise.resolve({ id: "notif-1" }),
    });

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith({ readAt: null });
    expect(updateWhereMock).toHaveBeenCalled();
    expect(selectWhereMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: true,
      unreadCount: 1,
    });
  });

  it("bulk marks only non-comment notifications as read", async () => {
    updateReturningMock.mockResolvedValue([{ id: "assigned-1" }]);
    selectRowsMock.mockResolvedValue([{ count: 2 }]);
    const { PATCH } = await import("legacy-api/notifications/bulk-read/route");

    const response = await PATCH();

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith({ readAt: expect.any(Date) });
    expect(updateWhereMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      success: true,
      updatedCount: 1,
      unreadCount: 2,
    });
  });

  it("sets and clears snooze metadata for the authenticated user", async () => {
    const snoozedUntilAt = "2026-06-01T12:00:00.000Z";
    updateReturningMock.mockResolvedValueOnce([
      {
        id: "notif-1",
        snoozedUntilAt: new Date(snoozedUntilAt),
        unsnoozedAt: null,
      },
    ]);
    const { PATCH } = await import(
      "legacy-api/notifications/[id]/snooze/route"
    );

    const response = await PATCH(
      new Request("http://localhost/api/notifications/notif-1/snooze", {
        method: "PATCH",
        body: JSON.stringify({ snoozedUntilAt }),
      }) as never,
      { params: Promise.resolve({ id: "notif-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith({
      snoozedUntilAt: new Date(snoozedUntilAt),
      unsnoozedAt: null,
    });
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      notification: { id: "notif-1", snoozedUntilAt, unsnoozedAt: null },
      unreadCount: 1,
    });
  });

  it("rejects invalid snooze timestamps", async () => {
    const { PATCH } = await import(
      "legacy-api/notifications/[id]/snooze/route"
    );

    const response = await PATCH(
      new Request("http://localhost/api/notifications/notif-1/snooze", {
        method: "PATCH",
        body: JSON.stringify({ snoozedUntilAt: "not-a-date" }),
      }) as never,
      { params: Promise.resolve({ id: "notif-1" }) },
    );

    expect(response.status).toBe(400);
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
