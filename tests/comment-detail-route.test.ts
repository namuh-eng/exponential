import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const selectMock = vi.fn();
const deleteFileMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/s3", () => ({
  deleteFile: deleteFileMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation((...args) => {
          const result = selectMock(...args);
          const promise = Promise.resolve(result);
          // @ts-ignore
          promise.limit = vi.fn().mockResolvedValue(result);
          return promise;
        }),
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockResolvedValue([{ id: "comment-1", body: "updated" }]),
        }),
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue([{ id: "comment-1" }]),
    })),
    transaction: vi.fn(
      async (cb: (tx: { delete: typeof vi.fn }) => Promise<unknown>) =>
        cb({
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
    ),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("comment detail route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    selectMock.mockResolvedValue([{ id: "comment-1", userId: "user-1" }]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/comments/[id]/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ body: "new body" }),
      }),
      {
        params: Promise.resolve({ id: "comment-1" }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("updates a comment", async () => {
    const { PATCH } = await import("@/app/api/comments/[id]/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ body: "updated body" }),
      }),
      {
        params: Promise.resolve({ id: "comment-1" }),
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.body).toBe("updated");
  });

  it("deletes a comment and its attachments", async () => {
    // First select is for the comment, second for attachments
    selectMock
      .mockResolvedValueOnce([{ id: "comment-1", userId: "user-1" }])
      .mockResolvedValueOnce([{ storageKey: "file-1" }]);

    const { DELETE } = await import("@/app/api/comments/[id]/route");

    const response = await DELETE(
      new Request("http://localhost", {
        method: "DELETE",
      }),
      {
        params: Promise.resolve({ id: "comment-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(deleteFileMock).toHaveBeenCalledWith("file-1");
    await expect(response.json()).resolves.toEqual({ success: true });
  });
});
