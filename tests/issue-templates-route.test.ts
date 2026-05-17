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
        settings: {},
        createdAt: new Date("2026-05-13T00:00:00.000Z"),
        updatedAt: new Date("2026-05-13T00:00:00.000Z"),
      },
    ]);
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
        }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.template.name).toBe("Customer request");
  });
});
