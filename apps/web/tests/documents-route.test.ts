import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const workspaceLimitMock = vi.fn();
const updateWhereMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(workspaceLimitMock()),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(updateWhereMock()),
      }),
    })),
  },
}));

describe("workspace documents route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: { user: { id: "user-1" } },
    });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    workspaceLimitMock.mockReturnValue([
      {
        id: "workspace-1",
        settings: {
          documents: {
            defaultVisibility: "private",
            autoLinkProjectDocuments: false,
            templates: [
              {
                id: "template-1",
                name: "Spec",
                description: "Product spec",
              },
            ],
          },
        },
      },
    ]);
  });

  it("returns normalized workspace document settings", async () => {
    const { GET } = await import(
      "legacy-api/workspaces/current/documents/route"
    );

    const response = await GET(
      new Request("http://localhost/api/workspaces/current/documents", {
        headers: { referer: "http://localhost/acme/settings/documents" },
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.documents).toEqual({
      defaultVisibility: "private",
      autoLinkProjectDocuments: false,
      templates: [
        { id: "template-1", name: "Spec", description: "Product spec" },
      ],
    });
  });

  it("persists document defaults into workspace settings", async () => {
    const { PATCH } = await import(
      "legacy-api/workspaces/current/documents/route"
    );

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current/documents", {
        method: "PATCH",
        body: JSON.stringify({
          defaultVisibility: "workspace",
          autoLinkProjectDocuments: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.documents.defaultVisibility).toBe("workspace");
    expect(payload.documents.autoLinkProjectDocuments).toBe(true);
  });

  it("validates and creates document templates", async () => {
    const { POST } = await import(
      "legacy-api/workspaces/current/documents/route"
    );

    const invalid = await POST(
      new Request("http://localhost/api/workspaces/current/documents", {
        method: "POST",
        body: JSON.stringify({ name: "   " }),
      }),
    );
    expect(invalid.status).toBe(400);

    const response = await POST(
      new Request("http://localhost/api/workspaces/current/documents", {
        method: "POST",
        body: JSON.stringify({ name: "Decision record", description: "ADR" }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.template.name).toBe("Decision record");
    expect(payload.documents.templates[0].description).toBe("ADR");
  });
});
