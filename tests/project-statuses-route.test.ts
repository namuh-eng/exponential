import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const groupedCountsMock = vi.fn();

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

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockResolvedValue(groupedCountsMock()),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("project statuses settings route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    groupedCountsMock.mockReturnValue([
      { status: "planned", count: 2 },
      { status: "started", count: 3 },
      { status: "completed", count: "1" },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/project-statuses/route");

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns default lifecycle statuses with workspace project counts", async () => {
    const { GET } = await import("@/app/api/project-statuses/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.readOnly).toBe(true);
    expect(payload.customStatusesSupported).toBe(false);
    expect(payload.totalProjects).toBe(6);
    expect(payload.statuses).toEqual([
      expect.objectContaining({
        value: "planned",
        label: "Planned",
        projectCount: 2,
      }),
      expect.objectContaining({
        value: "in_progress",
        label: "In progress",
        projectCount: 3,
      }),
      expect.objectContaining({
        value: "paused",
        label: "Paused",
        projectCount: 0,
      }),
      expect.objectContaining({
        value: "completed",
        label: "Completed",
        projectCount: 1,
      }),
      expect.objectContaining({
        value: "canceled",
        label: "Canceled",
        projectCount: 0,
      }),
    ]);
  });

  it("returns zero counts when the active workspace has no projects", async () => {
    groupedCountsMock.mockReturnValue([]);
    const { GET } = await import("@/app/api/project-statuses/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.totalProjects).toBe(0);
    expect(
      payload.statuses.every(
        (status: { projectCount: number }) => status.projectCount === 0,
      ),
    ).toBe(true);
  });

  it("returns default lifecycle statuses when the user has no active workspace", async () => {
    resolveActiveWorkspaceIdMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/project-statuses/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.totalProjects).toBe(0);
    expect(
      payload.statuses.map((status: { value: string }) => status.value),
    ).toEqual(["planned", "in_progress", "paused", "completed", "canceled"]);
  });
  it("returns 500 when status counts cannot be loaded", async () => {
    groupedCountsMock.mockImplementation(() => {
      throw new Error("database unavailable");
    });
    const { GET } = await import("@/app/api/project-statuses/route");

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to load project statuses",
    });
  });
});
