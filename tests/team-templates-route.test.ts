import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const findAccessibleTeamMock = vi.fn();
const templatesOrderByMock = vi.fn();
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
      orderBy: vi.fn().mockResolvedValue(templatesOrderByMock()),
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

const persistedTemplate = {
  id: "template-1",
  name: "Bug report",
  description: "Steps to reproduce",
  templateType: "issue",
  teamId: "team-1",
  workspaceId: "workspace-1",
  createdById: "user-1",
  settings: { body: "Steps to reproduce", defaultTeamKey: "ENG" },
  createdAt: new Date("2026-05-20T00:00:00.000Z"),
  updatedAt: new Date("2026-05-20T00:00:00.000Z"),
};

describe("team templates route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: { user: { id: "user-1" } },
    });
    findAccessibleTeamMock.mockResolvedValue(teamRecord);
    templatesOrderByMock.mockReturnValue([persistedTemplate]);
    insertReturningMock.mockReturnValue([persistedTemplate]);
    updateReturningMock.mockReturnValue([
      { ...persistedTemplate, name: "Bug report edited" },
    ]);
    deleteReturningMock.mockReturnValue([{ id: "template-1" }]);
  });

  it("returns 404 for inaccessible teams instead of template data", async () => {
    findAccessibleTeamMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/teams/[key]/templates/route");

    const response = await GET(
      new Request("http://localhost/api/teams/ONB/templates"),
      {
        params: Promise.resolve({ key: "ONB" }),
      },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Team not found" });
  });

  it("lists persisted templates for an accessible team", async () => {
    const { GET } = await import("@/app/api/teams/[key]/templates/route");

    const response = await GET(
      new Request("http://localhost/api/teams/ENG/templates"),
      {
        params: Promise.resolve({ key: "ENG" }),
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.team.name).toBe("Engineering");
    expect(payload.templates[0].name).toBe("Bug report");
    expect(payload.templates[0].settings.defaultTeamKey).toBe("ENG");
  });

  it("creates, edits, and deletes a team-scoped issue template", async () => {
    const { POST, PATCH, DELETE } = await import(
      "@/app/api/teams/[key]/templates/route"
    );

    const createResponse = await POST(
      new Request("http://localhost/api/teams/ENG/templates", {
        method: "POST",
        body: JSON.stringify({
          name: "Bug report",
          description: "Steps to reproduce",
          type: "issue",
          settings: { body: "Steps to reproduce" },
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );
    expect(createResponse.status).toBe(201);

    const editResponse = await PATCH(
      new Request("http://localhost/api/teams/ENG/templates", {
        method: "PATCH",
        body: JSON.stringify({
          id: "template-1",
          name: "Bug report edited",
          description: "Steps to reproduce",
          type: "issue",
          settings: { body: "Steps to reproduce" },
        }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );
    expect(editResponse.status).toBe(200);
    expect((await editResponse.json()).template.name).toBe("Bug report edited");

    const deleteResponse = await DELETE(
      new Request("http://localhost/api/teams/ENG/templates", {
        method: "DELETE",
        body: JSON.stringify({ id: "template-1" }),
      }),
      { params: Promise.resolve({ key: "ENG" }) },
    );
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ success: true });
  });
});
