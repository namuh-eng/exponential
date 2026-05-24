import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const selectRowsMock = vi.fn();
const insertReturningMock = vi.fn();
const updateReturningMock = vi.fn();
const deleteReturningMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/teams", () => ({
  findAccessibleTeam: findAccessibleTeamMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(selectRowsMock()),
      limit: vi.fn().mockResolvedValue(selectRowsMock()),
    })),
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(insertReturningMock()),
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue(updateReturningMock()),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue(deleteReturningMock()),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const teamRecord = {
  id: "team-1",
  workspaceId: "workspace-1",
  name: "Engineering",
  key: "ENG",
};

const baseTemplate = {
  id: "template-1",
  name: "Bug report",
  description: "Steps to reproduce",
  workspaceId: "workspace-1",
  createdById: "user-1",
  settings: { defaultTeamId: "team-1", defaultTeamKey: "ENG" },
  createdAt: new Date("2026-05-18T00:00:00.000Z"),
  updatedAt: new Date("2026-05-18T00:00:00.000Z"),
};

describe("team templates route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      session: { user: { id: "user-1" } },
    });
    findAccessibleTeamMock.mockResolvedValue(teamRecord);
    selectRowsMock.mockReturnValue([baseTemplate]);
    insertReturningMock.mockReturnValue([
      { ...baseTemplate, id: "template-2" },
    ]);
    updateReturningMock.mockReturnValue([
      { ...baseTemplate, name: "Bug report edited" },
    ]);
    deleteReturningMock.mockReturnValue([{ id: "template-1" }]);
  });

  it("returns 404 for a missing or inaccessible team", async () => {
    findAccessibleTeamMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/teams/[key]/templates/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ONB" }),
    });
    if (!response) throw new Error("Expected response");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Team not found",
    });
  });

  it("lists only templates scoped to the requested team", async () => {
    selectRowsMock.mockReturnValue([
      baseTemplate,
      {
        ...baseTemplate,
        id: "other-template",
        settings: { defaultTeamId: "team-2", defaultTeamKey: "OPS" },
      },
      {
        ...baseTemplate,
        id: "archived-template",
        settings: {
          defaultTeamId: "team-1",
          defaultTeamKey: "ENG",
          archivedAt: "2026-05-18T00:00:00.000Z",
        },
      },
    ]);
    const { GET } = await import("@/app/api/teams/[key]/templates/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "ENG" }),
    });
    if (!response) throw new Error("Expected response");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.team).toEqual({ name: "Engineering", key: "ENG" });
    expect(payload.templates).toHaveLength(1);
    expect(payload.templates[0].id).toBe("template-1");
  });

  it("creates a team-scoped issue template", async () => {
    const { POST } = await import("@/app/api/teams/[key]/templates/route");

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          name: "Customer bug",
          description: "Bug details",
          settings: { defaultPriority: "high" },
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );
    if (!response) throw new Error("Expected response");

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.template.settings.defaultTeamKey).toBe("ENG");
  });

  it("edits a team-scoped issue template", async () => {
    const { PATCH } = await import("@/app/api/teams/[key]/templates/route");

    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          id: "template-1",
          name: "Bug report edited",
          description: "Updated body",
          settings: { defaultPriority: "medium" },
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );
    if (!response) throw new Error("Expected response");

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.template.name).toBe("Bug report edited");
  });

  it("deletes a team-scoped issue template", async () => {
    const { DELETE } = await import("@/app/api/teams/[key]/templates/route");

    const response = await DELETE(
      new Request("http://localhost", {
        method: "DELETE",
        body: JSON.stringify({ id: "template-1" }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );
    if (!response) throw new Error("Expected response");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });
});
