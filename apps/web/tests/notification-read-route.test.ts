import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();

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
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("notification read route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    updateReturningMock.mockResolvedValue([{ id: "notif-1" }]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/notifications/[id]/read/route");

    const response = await PATCH({} as never, {
      params: Promise.resolve({ id: "notif-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("marks the notification as read", async () => {
    const { PATCH } = await import("@/app/api/notifications/[id]/read/route");

    const response = await PATCH({} as never, {
      params: Promise.resolve({ id: "notif-1" }),
    });

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith({ readAt: expect.any(Date) });
    expect(updateWhereMock).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it("returns 404 when the notification does not exist", async () => {
    updateReturningMock.mockResolvedValue([]);
    const { PATCH } = await import("@/app/api/notifications/[id]/read/route");

    const response = await PATCH({} as never, {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Notification not found",
    });
  });
});
