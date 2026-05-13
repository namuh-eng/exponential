import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const currentUserId = "issue-88-user";
const currentSessionId = "issue-88-current-session";
const otherSessionId = "issue-88-other-session";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  resolveActiveWorkspaceId: vi.fn(),
  dbSelect: vi.fn(),
  dbInsert: vi.fn(),
  dbDelete: vi.fn(),
  insertValues: vi.fn(),
  deleteWhere: vi.fn(),
  currentUserRows: [{ id: "issue-88-user" }],
  accessRows: [
    {
      workspaceId: "workspace-1",
      workspaceName: "Linear QA",
      settings: {
        security: { permissions: { apiKeyCreationRole: "members" } },
      },
      memberRole: "member",
    },
  ],
  sessionRows: [
    {
      id: "issue-88-current-session",
      userAgent: "Mozilla/5.0 Current Browser",
      ipAddress: "203.0.113.10",
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
      updatedAt: new Date("2026-01-02T10:00:00.000Z"),
      expiresAt: new Date("2026-02-01T10:00:00.000Z"),
    },
    {
      id: "issue-88-other-session",
      userAgent: "Mozilla/5.0 Other Browser",
      ipAddress: "203.0.113.11",
      createdAt: new Date("2026-01-03T10:00:00.000Z"),
      updatedAt: new Date("2026-01-04T10:00:00.000Z"),
      expiresAt: new Date("2026-02-03T10:00:00.000Z"),
    },
  ],
  providerRows: [
    {
      id: "issue-88-google-account",
      providerId: "google",
      accountId: "google-user-123",
      createdAt: new Date("2026-01-05T10:00:00.000Z"),
      updatedAt: new Date("2026-01-06T10:00:00.000Z"),
    },
  ],
  apiKeyRows: [
    {
      id: "api-key-1",
      name: "CLI",
      keyPrefix: "lin_api_123…",
      createdAt: new Date("2026-01-07T10:00:00.000Z"),
      lastUsedAt: null,
      workspaceId: "workspace-1",
      workspaceName: "Linear QA",
    },
  ],
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomBytes: vi.fn((size: number) => ({
      toString: () => "a".repeat(size * 2),
    })),
    createHash: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn(() => "hash-123"),
    })),
  };
});

vi.mock("@/lib/api-auth", () => ({
  requireApiSession: mocks.requireApiSession,
  createApiKeyHash: (secret: string) => `hash:${secret}`,
}));

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: mocks.resolveActiveWorkspaceId,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: mocks.dbSelect,
    insert: mocks.dbInsert,
    delete: mocks.dbDelete,
  },
}));

function queryBuilder(rows: unknown[], mode: "limit" | "orderBy") {
  return {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockResolvedValue(rows),
    [mode]: vi.fn().mockResolvedValue(rows),
  };
}

function setupDbMock() {
  mocks.dbSelect.mockImplementation((shape: Record<string, unknown>) => {
    const keys = Object.keys(shape);

    if (keys.includes("memberRole")) {
      return queryBuilder(mocks.accessRows, "limit");
    }
    if (keys.includes("keyPrefix")) {
      return queryBuilder(mocks.apiKeyRows, "orderBy");
    }
    if (keys.includes("providerId")) {
      return queryBuilder(mocks.providerRows, "orderBy");
    }
    if (keys.includes("userAgent")) {
      return queryBuilder(mocks.sessionRows, "orderBy");
    }

    return queryBuilder(mocks.currentUserRows, "limit");
  });
  mocks.dbInsert.mockReturnValue({
    values: mocks.insertValues.mockResolvedValue(undefined),
  });
  mocks.dbDelete.mockReturnValue({
    where: mocks.deleteWhere.mockResolvedValue(undefined),
  });
}

function authenticate() {
  mocks.requireApiSession.mockResolvedValue({
    response: null,
    session: {
      user: { id: currentUserId },
      session: { id: currentSessionId },
    },
  });
}

describe("Account Security API Route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.currentUserRows = [{ id: currentUserId }];
    mocks.resolveActiveWorkspaceId.mockResolvedValue("workspace-1");
    setupDbMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if no session", async () => {
    const unauthorized = Response.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
    mocks.requireApiSession.mockResolvedValue({
      response: unauthorized,
      session: null,
    });

    const { GET } = await import("@/app/api/account/security/route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });

  it("returns Linear-parity account security resources without secrets", async () => {
    authenticate();

    const { GET } = await import("@/app/api/account/security/route");
    const res = await GET();
    const data = await res.json();
    const serialized = JSON.stringify(data);

    expect(res.status).toBe(200);
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: currentSessionId, isCurrent: true }),
        expect.objectContaining({ id: otherSessionId, isCurrent: false }),
      ]),
    );
    expect(data.passkeys).toEqual([]);
    expect(data.apiKeys).toEqual([
      expect.objectContaining({
        id: "api-key-1",
        name: "CLI",
        keyPrefix: "lin_api_123…",
        workspaceName: "Linear QA",
      }),
    ]);
    expect(data.authorizedApplications).toEqual([]);
    expect(data.canCreateApiKeys).toBe(true);
    expect(serialized).not.toMatch(
      /accessToken|refreshToken|idToken|password|keyHash/i,
    );
  });

  it("blocks self-revoking the current session", async () => {
    authenticate();

    const { POST } = await import("@/app/api/account/security/route");
    const res = await POST(
      new Request("http://localhost/api/account/security", {
        method: "POST",
        body: JSON.stringify({
          action: "revokeSession",
          sessionId: currentSessionId,
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mocks.dbDelete).not.toHaveBeenCalled();
  });

  it("revokes another session and can revoke all sessions except current", async () => {
    authenticate();

    const { POST } = await import("@/app/api/account/security/route");
    const revokeOne = await POST(
      new Request("http://localhost/api/account/security", {
        method: "POST",
        body: JSON.stringify({
          action: "revokeSession",
          sessionId: otherSessionId,
        }),
      }),
    );
    const revokeAll = await POST(
      new Request("http://localhost/api/account/security", {
        method: "POST",
        body: JSON.stringify({ action: "revokeAllOtherSessions" }),
      }),
    );

    expect(revokeOne.status).toBe(200);
    expect(revokeAll.status).toBe(200);
    expect(mocks.dbDelete).toHaveBeenCalledTimes(2);
  });

  it("creates and revokes personal API keys", async () => {
    authenticate();

    const { POST } = await import("@/app/api/account/security/route");
    const create = await POST(
      new Request("http://localhost/api/account/security", {
        method: "POST",
        body: JSON.stringify({ action: "createApiKey", name: "CLI" }),
      }),
    );
    const createData = await create.json();

    expect(create.status).toBe(200);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "CLI",
        keyPrefix: expect.stringContaining("lin_api_"),
        userId: currentUserId,
        workspaceId: "workspace-1",
      }),
    );
    expect(createData.createdApiKey.token).toContain("lin_api_");

    const revoke = await POST(
      new Request("http://localhost/api/account/security", {
        method: "POST",
        body: JSON.stringify({ action: "revokeApiKey", apiKeyId: "api-key-1" }),
      }),
    );

    expect(revoke.status).toBe(200);
    expect(mocks.dbDelete).toHaveBeenCalled();
  });
});
