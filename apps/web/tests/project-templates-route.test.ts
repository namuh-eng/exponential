import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const templatesOrderByMock = vi.fn();
const insertReturningMock = vi.fn();
const insertValuesMock = vi.fn();
const updateSetMock = vi.fn();
const updateReturningMock = vi.fn();
const deleteReturningMock = vi.fn();

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
      orderBy: vi.fn().mockResolvedValue(templatesOrderByMock()),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values) => {
        insertValuesMock(values);
        return {
          returning: vi.fn().mockResolvedValue(insertReturningMock()),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values) => {
        updateSetMock(values);
        return {
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(updateReturningMock()),
          }),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(deleteReturningMock()),
      }),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("project templates route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    templatesOrderByMock.mockReturnValue([
      {
        id: "template-1",
        name: "Launch plan",
        description: "Milestones and starter tasks",
        settings: { milestones: [] },
        createdAt: new Date("2026-05-13T00:00:00.000Z"),
        updatedAt: new Date("2026-05-13T00:00:00.000Z"),
      },
    ]);
    insertReturningMock.mockReturnValue([
      {
        id: "template-2",
        name: "Beta rollout",
        description: "Default beta launch structure",
        settings: {},
        createdAt: new Date("2026-05-13T00:00:00.000Z"),
        updatedAt: new Date("2026-05-13T00:00:00.000Z"),
      },
    ]);
    updateReturningMock.mockReturnValue([
      {
        id: "template-1",
        name: "Launch plan edited",
        description: "Edited structure",
        settings: {
          status: "started",
          priority: "high",
          labelIds: [],
          milestones: ["Build"],
        },
        createdAt: new Date("2026-05-13T00:00:00.000Z"),
        updatedAt: new Date("2026-05-14T00:00:00.000Z"),
      },
    ]);
    deleteReturningMock.mockReturnValue([{ id: "template-1" }]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("legacy-api/project-templates/route");

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("lists project templates for the active workspace", async () => {
    const { GET } = await import("legacy-api/project-templates/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.templates).toHaveLength(1);
    expect(payload.templates[0].name).toBe("Launch plan");
  });

  it("validates required names", async () => {
    const { POST } = await import("legacy-api/project-templates/route");

    const response = await POST(
      new Request("http://localhost/api/project-templates", {
        method: "POST",
        body: JSON.stringify({ name: "   " }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Template name is required",
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const { POST } = await import("legacy-api/project-templates/route");

    const response = await POST(
      new Request("http://localhost/api/project-templates", {
        method: "POST",
        body: "{not-json",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON" });
  });

  it("creates a project template with structure", async () => {
    const { POST } = await import("legacy-api/project-templates/route");

    const response = await POST(
      new Request("http://localhost/api/project-templates", {
        method: "POST",
        body: JSON.stringify({
          name: "Beta rollout",
          description: "Default beta launch structure",
          settings: {
            status: "started",
            priority: "high",
            labelIds: ["label-1", "label-1"],
            milestones: ["Plan", "Build", ""],
          },
        }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.template.name).toBe("Beta rollout");
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: {
          status: "started",
          priority: "high",
          labelIds: ["label-1"],
          milestones: ["Plan", "Build"],
        },
      }),
    );
  });

  it("normalizes project template structure and settings", async () => {
    const { POST } = await import("legacy-api/project-templates/route");

    await POST(
      new Request("http://localhost/api/project-templates", {
        method: "POST",
        body: JSON.stringify({
          name: "Launch",
          settings: {
            status: "started",
            priority: "high",
            labelIds: ["label-1", "label-1", 12],
            milestones: ["Plan", "Build", "Plan", ""],
          },
        }),
      }),
    );

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: {
          status: "started",
          priority: "high",
          labelIds: ["label-1"],
          milestones: ["Plan", "Build"],
        },
      }),
    );
  });

  it("updates a project template with editable structure", async () => {
    const { PATCH } = await import("legacy-api/project-templates/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/project-templates/template-1", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Launch plan edited",
          description: "Edited structure",
          settings: {
            status: "started",
            priority: "high",
            milestones: ["Build"],
          },
        }),
      }),
      { params: Promise.resolve({ id: "template-1" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.template.name).toBe("Launch plan edited");
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Launch plan edited",
        description: "Edited structure",
        settings: {
          status: "started",
          priority: "high",
          labelIds: [],
          milestones: ["Build"],
        },
      }),
    );
  });

  it("deletes a project template from the active workspace", async () => {
    const { DELETE } = await import("legacy-api/project-templates/[id]/route");

    const response = await DELETE(
      new Request("http://localhost/api/project-templates/template-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "template-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });
});
