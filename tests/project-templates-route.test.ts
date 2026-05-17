import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const resolveActiveWorkspaceIdMock = vi.fn();
const templatesOrderByMock = vi.fn();
const insertReturningMock = vi.fn();

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
  });

  it("returns 401 without a session", async () => {
    getSessionMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/project-templates/route");

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("lists project templates for the active workspace", async () => {
    const { GET } = await import("@/app/api/project-templates/route");

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.templates).toHaveLength(1);
    expect(payload.templates[0].name).toBe("Launch plan");
  });

  it("validates required names", async () => {
    const { POST } = await import("@/app/api/project-templates/route");

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
    const { POST } = await import("@/app/api/project-templates/route");

    const response = await POST(
      new Request("http://localhost/api/project-templates", {
        method: "POST",
        body: "{not-json",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON" });
  });

  it("creates a project template", async () => {
    const { POST } = await import("@/app/api/project-templates/route");

    const response = await POST(
      new Request("http://localhost/api/project-templates", {
        method: "POST",
        body: JSON.stringify({
          name: "Beta rollout",
          description: "Default beta launch structure",
        }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.template.name).toBe("Beta rollout");
  });
});
