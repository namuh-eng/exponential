import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const customViewLimitMock = vi.fn();
const teamLimitMock = vi.fn();
const updateSetMock = vi.fn();
const deleteWhereMock = vi.fn();
const normalizeViewFilterStateMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: resolveActiveWorkspaceIdMock,
}));

vi.mock("@/lib/views", () => ({
  normalizeViewFilterState: normalizeViewFilterStateMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      if (selection && "layout" in selection && "ownerName" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  limit: customViewLimitMock,
                }),
              }),
            }),
          }),
        };
      }

      if (selection && "key" in selection && "workspaceId" in selection) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: teamLimitMock,
            }),
          }),
        };
      }

      return { from: vi.fn().mockReturnValue({ where: vi.fn() }) };
    }),
    update: vi.fn(() => ({
      set: (...setArgs: unknown[]) => {
        updateSetMock(...setArgs);
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        };
      },
    })),
    delete: vi.fn(() => ({
      where: (...whereArgs: unknown[]) => {
        deleteWhereMock(...whereArgs);
        return Promise.resolve();
      },
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("view detail route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    customViewLimitMock.mockResolvedValue([
      {
        id: "view-1",
        name: "My View",
        layout: "list",
        isPersonal: true,
        filterState: { entityType: "projects" },
        teamId: null,
        workspaceId: "workspace-1",
        ownerName: "Ashley",
        ownerImage: null,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);
    normalizeViewFilterStateMock.mockImplementation((filter: unknown) => {
      const f = filter as { entityType?: string };
      return {
        entityType: f?.entityType ?? "projects",
        scope: "workspace",
      };
    });
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/views/[id]/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "view-1" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns 404 when view is in another workspace", async () => {
    customViewLimitMock.mockResolvedValue([
      { id: "view-1", workspaceId: "workspace-other" },
    ]);
    const { GET } = await import("@/app/api/views/[id]/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "view-1" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns the view detail", async () => {
    const { GET } = await import("@/app/api/views/[id]/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "view-1" }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.view.name).toBe("My View");
  });

  it("updates view metadata", async () => {
    const { PATCH } = await import("@/app/api/views/[id]/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated View", isPersonal: false }),
      }),
      { params: Promise.resolve({ id: "view-1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Updated View",
        isPersonal: false,
      }),
    );
  });

  it("deletes a view", async () => {
    const { DELETE } = await import("@/app/api/views/[id]/route");

    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "view-1" }),
    });

    expect(response.status).toBe(200);
    expect(deleteWhereMock).toHaveBeenCalled();
  });
});
