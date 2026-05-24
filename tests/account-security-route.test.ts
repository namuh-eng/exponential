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
  passkeyRows: [],
  authorizedApplicationRows: [] as unknown[],
  apiKeyRows: [] as unknown[],
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

function queryBuilder(
  rows: unknown[],
  mode: "limit" | "orderBy" | "orderByThenLimit",
) {
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn(() =>
      mode === "orderBy" ? Promise.resolve(rows) : builder,
    ),
  };

  return builder;
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
    if (keys.includes("credentialID")) {
      return queryBuilder(mocks.passkeyRows, "orderBy");
    }
    if (keys.includes("appId")) {
      return queryBuilder(mocks.authorizedApplicationRows, "orderBy");
    }
    if (keys.includes("providerId")) {
      return queryBuilder(mocks.providerRows, "orderBy");
    }
    if (keys.includes("userAgent")) {
      return queryBuilder(mocks.sessionRows, "orderByThenLimit");
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
    mocks.accessRows = [
      {
        workspaceId: "workspace-1",
        workspaceName: "Linear QA",
        settings: {
          security: { permissions: { apiKeyCreationRole: "members" } },
        },
        memberRole: "member",
      },
    ];
    mocks.passkeyRows = [];
    mocks.authorizedApplicationRows = [];
    mocks.apiKeyRows = [];
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
    expect(data.apiKeys).toEqual([]);
    expect(data.canCreateApiKeys).toBe(true);
    expect(data.authorizedApplications).toEqual([]);
    expect(serialized).not.toMatch(
      /accessToken|refreshToken|idToken|password|keyHash/i,
    );
  });

  it("deduplicates blank unknown sessions while preserving current and real sessions", async () => {
    authenticate();
    mocks.sessionRows = [
      ...Array.from({ length: 20 }, (_, index) => ({
        id: index === 7 ? currentSessionId : `unknown-session-${index}`,
        userAgent: index % 2 === 0 ? "" : "   ",
        ipAddress: "",
        createdAt: new Date(
          `2026-01-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
        ),
        updatedAt: new Date(
          `2026-01-${String(index + 1).padStart(2, "0")}T11:00:00.000Z`,
        ),
        expiresAt: new Date("2026-12-01T10:00:00.000Z"),
      })),
      {
        id: "real-browser-session",
        userAgent: "Mozilla/5.0 Firefox",
        ipAddress: "203.0.113.44",
        createdAt: new Date("2026-01-30T10:00:00.000Z"),
        updatedAt: new Date("2026-01-30T11:00:00.000Z"),
        expiresAt: new Date("2026-12-01T10:00:00.000Z"),
      },
    ];

    const { GET } = await import("@/app/api/account/security/route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessions).toHaveLength(2);
    expect(data.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: currentSessionId,
          isCurrent: true,
          userAgent: null,
          ipAddress: null,
          source: "Current browser session",
        }),
        expect.objectContaining({
          id: "real-browser-session",
          isCurrent: false,
          source: "Browser",
        }),
      ]),
    );
    expect(
      data.sessions.filter((session: { source: string }) =>
        /browser session/i.test(session.source),
      ),
    ).toHaveLength(1);
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

  it("lists authorized OAuth applications for the authenticated user without exposing tokens", async () => {
    authenticate();
    mocks.authorizedApplicationRows = [
      {
        id: "grant-1",
        appId: "app-linear-importer",
        clientId: "lin_client_123",
        name: "Linear Importer",
        imageUrl: "https://example.com/importer.png",
        scopes: ["read", "write"],
        webhooksEnabled: true,
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        updatedAt: new Date("2026-04-02T10:00:00.000Z"),
      },
    ];

    const { GET } = await import("@/app/api/account/security/route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.authorizedApplications).toEqual([
      {
        id: "grant-1",
        appId: "app-linear-importer",
        clientId: "lin_client_123",
        name: "Linear Importer",
        imageUrl: "https://example.com/importer.png",
        publisher: null,
        scopes: ["read", "write"],
        permissionGroups: [
          {
            label: "Workspace data",
            descriptions: [
              "View workspace and account information",
              "Create and update workspace data",
            ],
          },
        ],
        webhooksEnabled: true,
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-02T10:00:00.000Z",
        lastUsedAt: null,
      },
    ]);
    expect(JSON.stringify(data)).not.toMatch(
      /accessToken|refreshToken|clientSecret/i,
    );
  });

  it("revokes an authorized application grant and refreshes the list", async () => {
    authenticate();
    mocks.authorizedApplicationRows = [
      {
        id: "grant-1",
        appId: "app-linear-importer",
        clientId: "lin_client_123",
        name: "Linear Importer",
        imageUrl: null,
        scopes: "read,write",
        webhooksEnabled: false,
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        updatedAt: new Date("2026-04-02T10:00:00.000Z"),
      },
    ];
    mocks.deleteWhere.mockImplementationOnce(async () => {
      mocks.authorizedApplicationRows = [];
    });

    const { POST } = await import("@/app/api/account/security/route");
    const res = await POST(
      new Request("http://localhost/api/account/security", {
        method: "POST",
        body: JSON.stringify({
          action: "revokeAuthorizedApplication",
          applicationId: "grant-1",
        }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.dbDelete).toHaveBeenCalledTimes(1);
    expect(data.authorizedApplications).toEqual([]);
  });

  it("requires an authorized application id before revoking", async () => {
    authenticate();

    const { POST } = await import("@/app/api/account/security/route");
    const res = await POST(
      new Request("http://localhost/api/account/security", {
        method: "POST",
        body: JSON.stringify({ action: "revokeAuthorizedApplication" }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/application id is required/i);
    expect(mocks.dbDelete).not.toHaveBeenCalled();
  });

  it("lists personal API key metadata without exposing secrets", async () => {
    authenticate();
    mocks.apiKeyRows = [
      {
        id: "api-key-1",
        name: "CLI",
        keyPrefix: "lin_api_aaaa…",
        workspaceName: "Linear QA",
        createdAt: new Date("2026-05-01T10:00:00.000Z"),
        lastUsedAt: null,
      },
    ];

    const { GET } = await import("@/app/api/account/security/route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.apiKeys).toEqual([
      {
        id: "api-key-1",
        name: "CLI",
        keyPrefix: "lin_api_aaaa…",
        workspaceName: "Linear QA",
        accessLevel: "Member",
        createdAt: "2026-05-01T10:00:00.000Z",
        lastUsedAt: null,
      },
    ]);
    expect(JSON.stringify(data)).not.toMatch(/keyHash|lin_api_[a-f0-9]{20}/i);
  });

  it("creates a personal API key and returns the raw secret only in the create response", async () => {
    authenticate();
    mocks.insertValues.mockImplementationOnce(async (value) => {
      mocks.apiKeyRows = [
        {
          id: "api-key-1",
          name: value.name,
          keyPrefix: value.keyPrefix,
          workspaceName: "Linear QA",
          createdAt: new Date("2026-05-01T10:00:00.000Z"),
          lastUsedAt: null,
        },
      ];
    });

    const { POST } = await import("@/app/api/account/security/route");
    const create = await POST(
      new Request("http://localhost/api/account/security", {
        method: "POST",
        body: JSON.stringify({ action: "createApiKey", name: "CLI" }),
      }),
    );
    const createData = await create.json();

    expect(create.status).toBe(200);
    expect(createData.createdCredential).toEqual({
      kind: "apiKey",
      label: "CLI API key",
      secret: expect.stringMatching(/^lin_api_[a-f0-9]{48}$/),
    });
    expect(createData.apiKeys).toEqual([
      expect.objectContaining({
        id: "api-key-1",
        name: "CLI",
        keyPrefix: `${createData.createdCredential.secret.slice(0, 12)}…`,
      }),
    ]);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "CLI",
        keyHash: `hash:${createData.createdCredential.secret}`,
        keyPrefix: `${createData.createdCredential.secret.slice(0, 12)}…`,
        userId: currentUserId,
        workspaceId: "workspace-1",
      }),
    );

    const { GET } = await import("@/app/api/account/security/route");
    const reload = await GET();
    const reloadData = await reload.json();

    expect(reloadData).not.toHaveProperty("createdCredential");
    expect(JSON.stringify(reloadData)).not.toContain(
      createData.createdCredential.secret,
    );
  });

  it("revokes only the authenticated user's own personal API key", async () => {
    authenticate();
    mocks.apiKeyRows = [
      {
        id: "api-key-1",
        name: "CLI",
        keyPrefix: "lin_api_aaaa…",
        workspaceName: "Linear QA",
        createdAt: new Date("2026-05-01T10:00:00.000Z"),
        lastUsedAt: null,
      },
    ];
    mocks.deleteWhere.mockImplementationOnce(async () => {
      mocks.apiKeyRows = [];
    });

    const { POST } = await import("@/app/api/account/security/route");

    const revoke = await POST(
      new Request("http://localhost/api/account/security", {
        method: "POST",
        body: JSON.stringify({ action: "revokeApiKey", apiKeyId: "api-key-1" }),
      }),
    );
    const revokeData = await revoke.json();

    expect(revoke.status).toBe(200);
    expect(revokeData.apiKeys).toEqual([]);
    expect(mocks.dbDelete).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid personal API key input and permission failures", async () => {
    authenticate();

    const { POST } = await import("@/app/api/account/security/route");
    const missingName = await POST(
      new Request("http://localhost/api/account/security", {
        method: "POST",
        body: JSON.stringify({ action: "createApiKey", name: "   " }),
      }),
    );
    expect(missingName.status).toBe(400);

    mocks.accessRows = [
      {
        workspaceId: "workspace-1",
        workspaceName: "Linear QA",
        settings: {
          security: { permissions: { apiKeyCreationRole: "admins" } },
        },
        memberRole: "member",
      },
    ];
    setupDbMock();

    const forbidden = await POST(
      new Request("http://localhost/api/account/security", {
        method: "POST",
        body: JSON.stringify({ action: "createApiKey", name: "CLI" }),
      }),
    );

    expect(forbidden.status).toBe(403);
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
