import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 15000 });

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  resolveActiveWorkspaceId: vi.fn(),
  dbSelect: vi.fn(),
  dbDelete: vi.fn(),
  deleteWhere: vi.fn(),
  accessRows: [{ workspaceId: "workspace-1", memberRole: "admin" }],
  applicationRows: [] as unknown[],
  grantRows: [{ id: "grant-1" }] as unknown[],
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
}));
vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: mocks.resolveActiveWorkspaceId,
}));
vi.mock("@/lib/db", () => ({
  db: { select: mocks.dbSelect, delete: mocks.dbDelete },
}));

function queryBuilder(rows: unknown[], mode: "limit" | "orderBy") {
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockResolvedValue(rows),
  };
  return builder;
}

function setupDbMock() {
  mocks.dbSelect.mockImplementation((shape: Record<string, unknown>) => {
    const keys = Object.keys(shape);
    if (keys.includes("memberRole"))
      return queryBuilder(mocks.accessRows, "limit");
    if (keys.includes("ownerEmail"))
      return queryBuilder(mocks.applicationRows, "orderBy");
    return queryBuilder(mocks.grantRows, "limit");
  });
  mocks.dbDelete.mockReturnValue({
    where: mocks.deleteWhere.mockResolvedValue(undefined),
  });
}

function authenticate() {
  mocks.requireApiSession.mockResolvedValue({
    response: null,
    session: { user: { id: "user-1" } },
  });
}

describe("Workspace applications API route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.accessRows = [{ workspaceId: "workspace-1", memberRole: "admin" }];
    mocks.applicationRows = [];
    mocks.grantRows = [{ id: "grant-1" }];
    mocks.resolveActiveWorkspaceId.mockResolvedValue("workspace-1");
    setupDbMock();
  });

  it("lists workspace-member application grants without secrets", async () => {
    authenticate();
    mocks.applicationRows = [
      {
        id: "grant-1",
        appId: "app-1",
        clientId: "lin_client_123",
        name: "Importer",
        imageUrl: null,
        scopes: ["read", "webhooks:write"],
        webhooksEnabled: true,
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        updatedAt: new Date("2026-04-02T10:00:00.000Z"),
        ownerName: "Ada Lovelace",
        ownerEmail: "ada@example.com",
        ownerImage: null,
      },
    ];

    const { GET } = await import(
      "legacy-api/workspaces/current/applications/route"
    );
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.applications).toEqual([
      expect.objectContaining({
        id: "grant-1",
        name: "Importer",
        clientId: "lin_client_123",
        owner: { name: "Ada Lovelace", email: "ada@example.com", image: null },
        scopes: ["read", "webhooks:write"],
      }),
    ]);
    expect(JSON.stringify(data)).not.toMatch(
      /accessToken|refreshToken|clientSecret/i,
    );
  });

  it("denies members from listing or revoking workspace applications", async () => {
    authenticate();
    mocks.accessRows = [{ workspaceId: "workspace-1", memberRole: "member" }];

    const listRoute = await import(
      "legacy-api/workspaces/current/applications/route"
    );
    const deleteRoute = await import(
      "legacy-api/workspaces/current/applications/[id]/route"
    );
    const listResponse = await listRoute.GET();
    const deleteResponse = await deleteRoute.DELETE(
      new Request("http://localhost"),
      { params: { id: "grant-1" } },
    );

    expect(listResponse.status).toBe(403);
    expect(deleteResponse.status).toBe(403);
    expect(mocks.dbDelete).not.toHaveBeenCalled();
  });

  it("revokes only an application grant visible in the active workspace", async () => {
    authenticate();
    const { DELETE } = await import(
      "legacy-api/workspaces/current/applications/[id]/route"
    );

    const response = await DELETE(new Request("http://localhost"), {
      params: { id: "grant-1" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.dbDelete).toHaveBeenCalledTimes(1);

    mocks.grantRows = [];
    const notFound = await DELETE(new Request("http://localhost"), {
      params: { id: "other-workspace-grant" },
    });
    expect(notFound.status).toBe(404);
  });
});
