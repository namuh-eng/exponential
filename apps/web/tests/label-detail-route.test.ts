import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const selectRowsMock = vi.fn();
const updateValuesMock = vi.fn();
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
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockImplementation(() => Promise.resolve(selectRowsMock())),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values) => {
        updateValuesMock(values);
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(updateReturningMock()),
          }),
        };
      }),
    })),
  },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("label detail route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    selectRowsMock.mockReturnValue([]);
    updateReturningMock.mockReturnValue([
      { id: "label-1", parentLabelId: null },
    ]);
  });

  it("moves a label into a valid workspace group", async () => {
    selectRowsMock
      .mockReturnValueOnce([{ id: "label-1", teamId: null }])
      .mockReturnValueOnce([{ id: "group-1", parentLabelId: null }]);
    const { PATCH } = await import("@/app/api/labels/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/labels/label-1", {
        method: "PATCH",
        body: JSON.stringify({ parentLabelId: "group-1" }),
      }),
      { params: Promise.resolve({ id: "label-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ parentLabelId: "group-1" }),
    );
  });

  it("moves a team label into a valid team group", async () => {
    selectRowsMock
      .mockReturnValueOnce([{ id: "label-1", teamId: "team-1" }])
      .mockReturnValueOnce([{ id: "team-group-1", parentLabelId: null }]);
    const { PATCH } = await import("@/app/api/labels/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/labels/label-1", {
        method: "PATCH",
        body: JSON.stringify({ parentLabelId: "team-group-1" }),
      }),
      { params: Promise.resolve({ id: "label-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ parentLabelId: "team-group-1" }),
    );
  });

  it("rejects moving a team label under a parent outside its team scope", async () => {
    selectRowsMock
      .mockReturnValueOnce([{ id: "label-1", teamId: "team-1" }])
      .mockReturnValueOnce([]);
    const { PATCH } = await import("@/app/api/labels/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/labels/label-1", {
        method: "PATCH",
        body: JSON.stringify({ parentLabelId: "workspace-group" }),
      }),
      { params: Promise.resolve({ id: "label-1" }) },
    );

    expect(response.status).toBe(400);
  });

  it("allows clearing a label group", async () => {
    selectRowsMock.mockReturnValue([{ id: "label-1", teamId: null }]);
    const { PATCH } = await import("@/app/api/labels/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/labels/label-1", {
        method: "PATCH",
        body: JSON.stringify({ parentLabelId: null }),
      }),
      { params: Promise.resolve({ id: "label-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ parentLabelId: null }),
    );
  });

  it("rejects self-parenting", async () => {
    selectRowsMock.mockReturnValue([{ id: "label-1", teamId: null }]);
    const { PATCH } = await import("@/app/api/labels/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/labels/label-1", {
        method: "PATCH",
        body: JSON.stringify({ parentLabelId: "label-1" }),
      }),
      { params: Promise.resolve({ id: "label-1" }) },
    );

    expect(response.status).toBe(400);
  });

  it("rejects cycles when moving under a descendant", async () => {
    selectRowsMock
      .mockReturnValueOnce([{ id: "label-1", teamId: null }])
      .mockReturnValueOnce([{ id: "child-1", parentLabelId: "label-1" }])
      .mockReturnValueOnce([{ id: "label-1", parentLabelId: null }]);
    const { PATCH } = await import("@/app/api/labels/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/labels/label-1", {
        method: "PATCH",
        body: JSON.stringify({ parentLabelId: "child-1" }),
      }),
      { params: Promise.resolve({ id: "label-1" }) },
    );

    expect(response.status).toBe(400);
  });
});
