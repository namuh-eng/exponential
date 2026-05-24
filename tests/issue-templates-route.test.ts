import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const templatesOrderByMock = vi.fn();
const insertReturningMock = vi.fn();
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

describe("issue templates route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    resolveActiveWorkspaceIdMock.mockResolvedValue("workspace-1");
    templatesOrderByMock.mockReturnValue([
      {
        id: "template-1",
        name: "Bug report",
        description: "Steps to reproduce\nExpected result\nActual result",
        settings: {},
        createdAt: new Date("2026-05-13T00:00:00.000Z"),
        updatedAt: new Date("2026-05-13T00:00:00.000Z"),
      },
    ]);
    insertReturningMock.mockReturnValue([
      {
        id: "template-2",
        name: "Customer request",
        description: "Customer impact and requested outcome",
        settings: { defaultPriority: "high" },
        createdAt: new Date("2026-05-13T00:00:00.000Z"),
        updatedAt: new Date("2026-05-13T00:00:00.000Z"),
      },
    ]);
    updateReturningMock.mockReturnValue([
      {
        id: "template-1",
        name: "Bug report edited",
        description: "Updated body",
        settings: { defaultPriority: "medium" },
        workspaceId: "workspace-1",
        createdById: "user-1",
        createdAt: new Date("2026-05-13T00:00:00.000Z"),
        updatedAt: new Date("2026-05-13T01:00:00.000Z"),
      },
    ]);
    deleteReturningMock.mockReturnValue([{ id: "template-1" }]);
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/issue-templates/route");

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("lists issue templates for the active workspace", async () => {
    const { GET } = await import("@/app/api/issue-templates/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.templates).toHaveLength(1);
    expect(payload.templates[0].name).toBe("Bug report");
  });

  it("validates required names", async () => {
    const { POST } = await import("@/app/api/issue-templates/route");

    const response = await POST(
      new Request("http://localhost/api/issue-templates", {
        method: "POST",
        body: JSON.stringify({ name: "   ", description: "Body" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Template name is required",
    });
  });

  it("validates required issue descriptions", async () => {
    const { POST } = await import("@/app/api/issue-templates/route");

    const response = await POST(
      new Request("http://localhost/api/issue-templates", {
        method: "POST",
        body: JSON.stringify({ name: "Bug report", description: "   " }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Issue description is required",
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const { POST } = await import("@/app/api/issue-templates/route");

    const response = await POST(
      new Request("http://localhost/api/issue-templates", {
        method: "POST",
        body: "{not-json",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON" });
  });

  it("creates an issue template", async () => {
    const { POST } = await import("@/app/api/issue-templates/route");

    const response = await POST(
      new Request("http://localhost/api/issue-templates", {
        method: "POST",
        body: JSON.stringify({
          name: "Customer request",
          description: "Customer impact and requested outcome",
          settings: { defaultPriority: "high", defaultStatusName: "Backlog" },
        }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.template.name).toBe("Customer request");
    expect(payload.template.settings.defaultPriority).toBe("high");
  });

  it("edits an issue template", async () => {
    const { PATCH } = await import("@/app/api/issue-templates/[id]/route");

    const response = await PATCH(
      new Request("http://localhost/api/issue-templates/template-1", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Bug report edited",
          description: "Updated body",
          settings: { defaultPriority: "medium" },
        }),
      }),
      { params: Promise.resolve({ id: "template-1" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.template.name).toBe("Bug report edited");
    expect(payload.template.settings.defaultPriority).toBe("medium");
  });

  it("deletes an issue template", async () => {
    const { DELETE } = await import("@/app/api/issue-templates/[id]/route");

    const response = await DELETE(
      new Request("http://localhost/api/issue-templates/template-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "template-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });
});
