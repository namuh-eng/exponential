import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const workspaceAccessMock = vi.fn();
const groupedCountsMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
let selectCall = 0;

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
    select: vi.fn(() => {
      selectCall += 1;
      if (selectCall % 2 === 1) {
        return {
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue(workspaceAccessMock()),
        };
      }

      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(groupedCountsMock()),
        groupBy: vi.fn().mockResolvedValue(groupedCountsMock()),
      };
    }),
    update: vi.fn(() => ({
      set: updateSetMock.mockReturnValue({ where: updateWhereMock }),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/project-statuses", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("project statuses settings route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectCall = 0;
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    workspaceAccessMock.mockReturnValue([
      { workspaceId: "workspace-1", role: "admin", settings: {} },
    ]);
    groupedCountsMock.mockReturnValue([
      { status: "planned", settings: {} },
      { status: "planned", settings: {} },
      { status: "started", settings: {} },
      { status: "started", settings: {} },
      { status: "started", settings: {} },
      { status: "completed", settings: {} },
    ]);
    updateWhereMock.mockResolvedValue(undefined);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/project-statuses/route");

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns editable default lifecycle statuses with workspace project counts", async () => {
    const { GET } = await import("legacy-api/project-statuses/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.readOnly).toBe(false);
    expect(payload.customStatusesSupported).toBe(true);
    expect(payload.canManage).toBe(true);
    expect(payload.totalProjects).toBe(6);
    expect(payload.statuses).toEqual([
      expect.objectContaining({
        key: "planned",
        name: "Planned",
        projectCount: 2,
      }),
      expect.objectContaining({
        key: "started",
        name: "In progress",
        projectCount: 3,
      }),
      expect.objectContaining({
        key: "paused",
        name: "Paused",
        projectCount: 0,
      }),
      expect.objectContaining({
        key: "completed",
        name: "Completed",
        projectCount: 1,
      }),
      expect.objectContaining({
        key: "canceled",
        name: "Canceled",
        projectCount: 0,
      }),
    ]);
  });

  it("returns persisted custom statuses from workspace settings", async () => {
    workspaceAccessMock.mockReturnValue([
      {
        workspaceId: "workspace-1",
        role: "owner",
        settings: {
          projectStatuses: [
            {
              id: "started",
              key: "started",
              name: "Building",
              description: "Being built",
              color: "#123456",
              icon: "▶",
              position: 1,
            },
            {
              id: "blocked",
              key: "blocked",
              name: "Blocked",
              description: "Waiting on dependency",
              color: "#654321",
              icon: "!",
              position: 5,
            },
          ],
        },
      },
    ]);
    groupedCountsMock.mockReturnValue([
      { status: "started", settings: {} },
      { status: "started", settings: { projectStatusKey: "blocked" } },
    ]);
    const { GET } = await import("legacy-api/project-statuses/route");

    const response = await GET();
    const payload = await response.json();

    expect(payload.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "started",
          name: "Building",
          projectCount: 1,
        }),
        expect.objectContaining({
          key: "blocked",
          name: "Blocked",
          projectCount: 1,
        }),
      ]),
    );
  });

  it("counts projects assigned to custom project statuses", async () => {
    workspaceAccessMock.mockReturnValue([
      {
        workspaceId: "workspace-1",
        role: "admin",
        settings: {
          projectStatuses: [
            {
              id: "blocked",
              key: "blocked",
              name: "Blocked",
              description: "Waiting on dependency",
              color: "#654321",
              icon: "!",
              position: 5,
            },
          ],
        },
      },
    ]);
    groupedCountsMock.mockReturnValue([
      { status: "started", settings: { projectStatusKey: "blocked" } },
      { status: "started", settings: {} },
    ]);
    const { GET } = await import("legacy-api/project-statuses/route");

    const response = await GET();
    const payload = await response.json();

    expect(payload.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "blocked", projectCount: 1 }),
        expect.objectContaining({ key: "started", projectCount: 1 }),
      ]),
    );
  });

  it("persists edited project statuses for admins", async () => {
    const { PATCH } = await import("legacy-api/project-statuses/route");

    const response = await PATCH(
      patchRequest({
        statuses: [
          {
            id: "planned",
            key: "planned",
            name: "Queued",
            description: "Queued",
            color: "#111111",
            icon: "Q",
          },
          {
            id: "started",
            key: "started",
            name: "Started",
            description: "Started",
            color: "#222222",
            icon: "S",
          },
          {
            id: "paused",
            key: "paused",
            name: "Paused",
            description: "Paused",
            color: "#333333",
            icon: "P",
          },
          {
            id: "completed",
            key: "completed",
            name: "Done",
            description: "Done",
            color: "#444444",
            icon: "D",
          },
          {
            id: "canceled",
            key: "canceled",
            name: "Canceled",
            description: "Canceled",
            color: "#555555",
            icon: "C",
          },
          {
            id: "blocked",
            key: "blocked",
            name: "Blocked",
            description: "Waiting",
            color: "#666666",
            icon: "!",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          projectStatuses: expect.arrayContaining([
            expect.objectContaining({ key: "blocked", name: "Blocked" }),
          ]),
        }),
      }),
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        customStatusesSupported: true,
        canManage: true,
      }),
    );
  });

  it("rejects mutations from non-admin users", async () => {
    workspaceAccessMock.mockReturnValue([
      { workspaceId: "workspace-1", role: "member", settings: {} },
    ]);
    const { PATCH } = await import("legacy-api/project-statuses/route");

    const response = await PATCH(patchRequest({ statuses: [] }));

    expect(response.status).toBe(403);
  });

  it("validates status names and colors", async () => {
    const { PATCH } = await import("legacy-api/project-statuses/route");

    const response = await PATCH(
      patchRequest({
        statuses: [
          { id: "planned", key: "planned", name: "", color: "red", icon: "" },
        ],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Default project statuses cannot be removed.",
    });
  });

  it("returns default lifecycle statuses when the user has no active workspace", async () => {
    resolveActiveWorkspaceIdMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/project-statuses/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.totalProjects).toBe(0);
    expect(payload.canManage).toBe(false);
    expect(
      payload.statuses.map((status: { key: string }) => status.key),
    ).toEqual(["planned", "started", "paused", "completed", "canceled"]);
  });

  it("returns 500 when status counts cannot be loaded", async () => {
    groupedCountsMock.mockImplementation(() => {
      throw new Error("database unavailable");
    });
    const { GET } = await import("legacy-api/project-statuses/route");

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to load project statuses",
    });
  });
});
