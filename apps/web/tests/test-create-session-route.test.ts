import { beforeEach, describe, expect, it, vi } from "vitest";

const userLimitMock = vi.fn();
const insertReturningMock = vi.fn();
const createSessionMock = vi.fn();
const ensureCanonicalWorkspaceForUserMock = vi.fn();

vi.mock("@/lib/canonical-workspace", () => ({
  ensureCanonicalWorkspaceForUser: (userId: string) =>
    ensureCanonicalWorkspaceForUserMock(userId),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: {
        createSession: (...args: unknown[]) => createSessionMock(...args),
      },
      secret: "test-secret",
      authCookies: {
        sessionToken: {
          name: "exponential_session",
          attributes: { httpOnly: true, path: "/", sameSite: "lax" },
        },
      },
    }),
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => userLimitMock()),
        }),
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi
          .fn()
          .mockImplementation(async () => insertReturningMock()),
      }),
    })),
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

describe("test create session route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    userLimitMock.mockReturnValue([
      { id: "user-1", email: "test@test.com", name: "Test User" },
    ]);
    createSessionMock.mockResolvedValue({
      token: "session-token",
      expiresAt: new Date(Date.now() + 3600000),
    });
    ensureCanonicalWorkspaceForUserMock.mockResolvedValue({
      workspace: {
        id: "workspace-foreverbrowsing",
        name: "Forever Browsing",
        urlSlug: "foreverbrowsing",
      },
      team: { id: "team-eng", name: "Engineering", key: "ENG" },
    });
  });

  it("returns 200 and session when in test mode", async () => {
    const { POST } = await import("legacy-api/test/create-session/route");

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: {
          "user-agent": "Regression Browser",
          "x-forwarded-for": "203.0.113.8, 10.0.0.1",
        },
        body: JSON.stringify({ email: "test@test.com" }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.sessionToken).toMatch(/^session-token\.[A-Za-z0-9_-]+$/);
    expect(payload.workspace.urlSlug).toBe("foreverbrowsing");
    expect(payload.team.key).toBe("ENG");
    expect(ensureCanonicalWorkspaceForUserMock).toHaveBeenCalledWith("user-1");
    expect(createSessionMock).toHaveBeenCalledWith("user-1", false, {
      userAgent: "Regression Browser",
      ipAddress: "203.0.113.8",
    });
    expect(response.headers.get("set-cookie")).toContain(
      "activeWorkspaceId=workspace-foreverbrowsing",
    );
  });

  it("returns 503 with setup instructions when Postgres is unavailable", async () => {
    userLimitMock.mockImplementation(() => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      });
    });
    const { POST } = await import("legacy-api/test/create-session/route");

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ email: "test@test.com" }),
      }),
    );

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error).toBe("Local database needs bootstrapping");
    expect(payload.setup).toContain("make dev-services");
  });

  it("returns 503 with setup instructions when the auth schema is missing", async () => {
    userLimitMock.mockImplementation(() => {
      throw Object.assign(new Error('relation "user" does not exist'), {
        code: "42P01",
      });
    });
    const { POST } = await import("legacy-api/test/create-session/route");

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ email: "test@test.com" }),
      }),
    );

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error).toBe("Local database needs bootstrapping");
    expect(payload.message).toMatch(
      /schema required by authenticated app routes/,
    );
    expect(payload.setup).toEqual(["make dev-services", "npm run db:push"]);
  });
});
