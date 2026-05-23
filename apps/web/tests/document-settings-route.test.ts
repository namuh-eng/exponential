import { beforeEach, describe, expect, it, vi } from "vitest";

const requireApiSessionMock = vi.fn();
const resolveRequestWorkspaceIdMock = vi.fn();
const selectLimitMock = vi.fn();
const updateWhereMock = vi.fn();

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveRequestWorkspaceId: resolveRequestWorkspaceIdMock,
}));

vi.mock("@/lib/db/schema", () => ({
  member: { role: "role", userId: "userId", workspaceId: "memberWorkspaceId" },
  workspace: {
    id: "workspaceId",
    settings: "settings",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args) => args),
  eq: vi.fn((left, right) => ({ left, right })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi.fn(() => selectLimitMock()),
    })),
    update: vi.fn(() => ({
      set: vi.fn().mockReturnThis(),
      where: vi.fn((condition) => updateWhereMock(condition)),
    })),
  },
}));

function request(path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("document settings API routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      response: null,
      session: { user: { id: "user-1" } },
    });
    resolveRequestWorkspaceIdMock.mockResolvedValue("workspace-1");
    updateWhereMock.mockResolvedValue(undefined);
    selectLimitMock.mockResolvedValue([
      {
        id: "workspace-1",
        role: "owner",
        settings: {
          region: "United States",
          documents: {
            templates: [
              {
                id: "template-1",
                name: "Spec",
                description: "Product specs",
                content: "Problem\nProposal",
                createdAt: "2026-05-20T00:00:00.000Z",
                updatedAt: "2026-05-20T00:00:00.000Z",
              },
            ],
            folders: [
              {
                id: "folder-1",
                name: "Handbook",
                description: "Policies",
                color: "blue",
                createdAt: "2026-05-20T00:00:00.000Z",
                updatedAt: "2026-05-20T00:00:00.000Z",
              },
            ],
          },
        },
      },
    ]);
  });

  it("returns document settings scoped to the active workspace", async () => {
    const { GET } = await import("@/app/api/document-settings/route");

    const response = await GET(request("/api/document-settings"));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.documents.templates[0].name).toBe("Spec");
    expect(payload.documents.folders[0].name).toBe("Handbook");
    expect(resolveRequestWorkspaceIdMock).toHaveBeenCalledWith(
      "user-1",
      expect.any(Request),
    );
  });

  it("validates and creates a document template", async () => {
    const { POST } = await import("@/app/api/document-templates/route");

    const invalid = await POST(
      request("/api/document-templates", { name: " ", content: "Body" }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Template name is required",
    });

    const response = await POST(
      request("/api/document-templates", {
        name: "Decision record",
        description: "Architecture decisions",
        content: "Context\nDecision\nConsequences",
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.template.name).toBe("Decision record");
    expect(updateWhereMock).toHaveBeenCalled();
  });

  it("edits and deletes a document template", async () => {
    const { PATCH, DELETE } = await import(
      "@/app/api/document-templates/[id]/route"
    );

    const patchResponse = await PATCH(
      request("/api/document-templates/template-1", {
        name: "Spec edited",
        content: "Problem\nDecision",
      }),
      { params: Promise.resolve({ id: "template-1" }) },
    );
    expect(patchResponse.status).toBe(200);
    expect((await patchResponse.json()).template.name).toBe("Spec edited");

    const deleteResponse = await DELETE(
      request("/api/document-templates/template-1"),
      {
        params: Promise.resolve({ id: "template-1" }),
      },
    );
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ success: true });
  });

  it("validates and creates a common folder", async () => {
    const { POST } = await import("@/app/api/document-folders/route");

    const invalid = await POST(request("/api/document-folders", { name: " " }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Folder name is required" });

    const response = await POST(
      request("/api/document-folders", {
        name: "Runbooks",
        description: "Operational docs",
        color: "green",
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.folder.name).toBe("Runbooks");
    expect(payload.folder.color).toBe("green");
  });

  it("edits and deletes a common folder", async () => {
    const { PATCH, DELETE } = await import(
      "@/app/api/document-folders/[id]/route"
    );

    const patchResponse = await PATCH(
      request("/api/document-folders/folder-1", {
        name: "Company handbook",
        color: "purple",
      }),
      { params: Promise.resolve({ id: "folder-1" }) },
    );
    expect(patchResponse.status).toBe(200);
    const payload = await patchResponse.json();
    expect(payload.folder.name).toBe("Company handbook");
    expect(payload.folder.color).toBe("purple");

    const deleteResponse = await DELETE(
      request("/api/document-folders/folder-1"),
      {
        params: Promise.resolve({ id: "folder-1" }),
      },
    );
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ success: true });
  });
});
