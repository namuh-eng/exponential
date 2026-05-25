import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveWorkspaceAuthPolicyMock = vi.hoisted(() => vi.fn());
const isWorkspaceAuthMethodAllowedMock = vi.hoisted(() => vi.fn());
const verificationLimitMock = vi.hoisted(() => vi.fn());

// Sentinel object returned by resolveWorkspaceAuthPolicy. The route only
// passes it back to isWorkspaceAuthMethodAllowed, so it doesn't need to match
// the real WorkspaceAuthPolicy shape — only to be identifiable in assertions.
const SENTINEL_POLICY = { __policy: "sentinel" };

vi.mock("@/lib/workspace-auth-methods", () => ({
  resolveWorkspaceAuthPolicy: resolveWorkspaceAuthPolicyMock,
  isWorkspaceAuthMethodAllowed: isWorkspaceAuthMethodAllowedMock,
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: verificationLimitMock })),
      })),
    })),
  },
}));

describe("auth catch-all workspace policy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Default: a workspace policy exists and allows everything. Individual
    // tests flip isWorkspaceAuthMethodAllowed to false to assert the 403 path.
    resolveWorkspaceAuthPolicyMock.mockResolvedValue(SENTINEL_POLICY);
    isWorkspaceAuthMethodAllowedMock.mockReturnValue(true);
    verificationLimitMock.mockResolvedValue([]);
  });

  it("rejects direct magic-link requests when email/passkey is disabled for a member", async () => {
    isWorkspaceAuthMethodAllowedMock.mockReturnValue(false);
    const { POST } = await import("legacy-api/auth/[...all]/route");

    const response = await POST(
      new Request("https://app.test/api/auth/sign-in/magic-link", {
        method: "POST",
        body: JSON.stringify({
          email: "member@example.com",
          callbackURL: "https://app.test/foreverbrowsing/inbox",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "WORKSPACE_AUTH_METHOD_DISABLED",
    });
    expect(resolveWorkspaceAuthPolicyMock).toHaveBeenCalledWith({
      callbackUrl: "https://app.test/foreverbrowsing/inbox",
      baseUrl: "https://app.test",
      email: "member@example.com",
    });
    expect(isWorkspaceAuthMethodAllowedMock).toHaveBeenCalledWith(
      SENTINEL_POLICY,
      "emailPasskey",
    );
  });

  it("returns the removed Better Auth response when a legacy magic-link request is otherwise allowed", async () => {
    isWorkspaceAuthMethodAllowedMock.mockReturnValue(true);
    const { POST } = await import("legacy-api/auth/[...all]/route");
    const request = new Request(
      "https://app.test/api/auth/sign-in/magic-link",
      {
        method: "POST",
        body: JSON.stringify({
          email: "admin@example.com",
          callbackURL: "https://app.test/foreverbrowsing/inbox",
        }),
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: "Better Auth has been removed. Use first-party Go auth endpoints.",
    });
  });

  it("rejects direct Google id-token sign-in when Google is disabled for a member", async () => {
    isWorkspaceAuthMethodAllowedMock.mockReturnValue(false);
    const { POST } = await import("legacy-api/auth/[...all]/route");

    const response = await POST(
      new Request("https://app.test/api/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({
          provider: "google",
          callbackURL: "https://app.test/foreverbrowsing/inbox",
          idToken: { user: { email: "member@example.com" } },
        }),
      }),
    );

    expect(response.status).toBe(403);
    // Social sign-in flow doesn't extract an email from the id-token, so
    // resolveWorkspaceAuthPolicy is called with email undefined.
    expect(resolveWorkspaceAuthPolicyMock).toHaveBeenCalledWith({
      callbackUrl: "https://app.test/foreverbrowsing/inbox",
      baseUrl: "https://app.test",
      email: undefined,
    });
    expect(isWorkspaceAuthMethodAllowedMock).toHaveBeenCalledWith(
      SENTINEL_POLICY,
      "google",
    );
  });

  it("rejects magic-link verification when the stored email is no longer allowed", async () => {
    verificationLimitMock.mockResolvedValue([
      { value: JSON.stringify({ email: "member@example.com" }) },
    ]);
    isWorkspaceAuthMethodAllowedMock.mockReturnValue(false);
    const { GET } = await import("legacy-api/auth/[...all]/route");

    const response = await GET(
      new Request(
        "https://app.test/api/auth/magic-link/verify?token=123456&callbackURL=https%3A%2F%2Fapp.test%2Fforeverbrowsing%2Finbox",
      ),
    );

    expect(response.status).toBe(403);
    expect(resolveWorkspaceAuthPolicyMock).toHaveBeenCalledWith({
      callbackUrl: "https://app.test/foreverbrowsing/inbox",
      baseUrl: "https://app.test",
      email: undefined,
    });
    expect(isWorkspaceAuthMethodAllowedMock).toHaveBeenCalledWith(
      SENTINEL_POLICY,
      "emailPasskey",
    );
  });
});
