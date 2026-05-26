import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const labelsOrderByMock = vi.fn();
const insertReturningMock = vi.fn();
const selectRowsMock = vi.fn();
const insertValuesMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn((selection?: Record<string, unknown>) => {
      // GET labels with issueCount
      if (selection && "issueCount" in selection) {
        const afterJoins = {
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(labelsOrderByMock()),
            }),
          }),
        };
        const joinable = {
          leftJoin: vi.fn(() => joinable),
          where: afterJoins.where,
        };
        return {
          from: vi.fn().mockReturnValue(joinable),
        };
      }

      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockImplementation(() => Promise.resolve(selectRowsMock())),
      };
    }),
    insert: vi.fn(() => ({
      values: vi.fn((values) => {
        insertValuesMock(values);
        return {
          returning: vi.fn().mockResolvedValue(insertReturningMock()),
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

describe("labels collection route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    selectRowsMock.mockReturnValue([]);
    insertValuesMock.mockReturnValue(undefined);
    labelsOrderByMock.mockReturnValue([
      {
        id: "label-1",
        name: "Bug",
        color: "#f00",
        description: "Bugs",
        teamId: null,
        teamName: null,
        teamKey: null,
        archivedAt: null,
        issueCount: 2,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/labels/route");

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns workspace labels", async () => {
    const { GET } = await import("legacy-api/labels/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.labels.length).toBe(1);
    expect(payload.labels[0].name).toBe("Bug");
  });

  it("creates a label", async () => {
    insertReturningMock.mockReturnValue([{ id: "label-2", name: "Feature" }]);
    const { POST } = await import("legacy-api/labels/route");

    const response = await POST(
      new Request("http://localhost/api/labels", {
        method: "POST",
        body: JSON.stringify({ name: "Feature", color: "#0f0" }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.label.id).toBe("label-2");
  });
  it("creates a label under a workspace parent", async () => {
    selectRowsMock.mockReturnValue([{ id: "group-1", parentLabelId: null }]);
    insertReturningMock.mockReturnValue([
      { id: "label-3", name: "Backend", parentLabelId: "group-1" },
    ]);
    const { POST } = await import("legacy-api/labels/route");

    const response = await POST(
      new Request("http://localhost/api/labels", {
        method: "POST",
        body: JSON.stringify({ name: "Backend", parentLabelId: "group-1" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ parentLabelId: "group-1" }),
    );
  });

  it("creates a team label under a team parent", async () => {
    selectRowsMock
      .mockReturnValueOnce([{ id: "team-1" }])
      .mockReturnValueOnce([{ id: "team-group-1", parentLabelId: null }]);
    insertReturningMock.mockReturnValue([
      {
        id: "label-4",
        name: "API",
        parentLabelId: "team-group-1",
        teamId: "team-1",
      },
    ]);
    const { POST } = await import("legacy-api/labels/route");

    const response = await POST(
      new Request("http://localhost/api/labels", {
        method: "POST",
        body: JSON.stringify({
          name: "API",
          teamId: "team-1",
          parentLabelId: "team-group-1",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        parentLabelId: "team-group-1",
      }),
    );
  });

  it("rejects a team label under a parent from another scope", async () => {
    selectRowsMock
      .mockReturnValueOnce([{ id: "team-1" }])
      .mockReturnValueOnce([]);
    const { POST } = await import("legacy-api/labels/route");

    const response = await POST(
      new Request("http://localhost/api/labels", {
        method: "POST",
        body: JSON.stringify({
          name: "API",
          teamId: "team-1",
          parentLabelId: "workspace-group",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects an invalid parent label", async () => {
    selectRowsMock.mockReturnValue([]);
    const { POST } = await import("legacy-api/labels/route");

    const response = await POST(
      new Request("http://localhost/api/labels", {
        method: "POST",
        body: JSON.stringify({ name: "Backend", parentLabelId: "other" }),
      }),
    );

    expect(response.status).toBe(400);
  });
});
