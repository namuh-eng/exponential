import { beforeEach, describe, expect, it, vi } from "vitest";

const authPostMock = vi.hoisted(() => vi.fn());
const authGetMock = vi.hoisted(() => vi.fn());
const isWorkspaceAuthMethodAllowedForEmailMock = vi.hoisted(() => vi.fn());
const verificationLimitMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: vi.fn(() => ({ GET: authGetMock, POST: authPostMock })),
}));
vi.mock("@/lib/workspace-auth-settings", () => ({
  isWorkspaceAuthMethodAllowedForEmail:
    isWorkspaceAuthMethodAllowedForEmailMock,
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
    authPostMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    authGetMock.mockResolvedValue(new Response(null, { status: 302 }));
    isWorkspaceAuthMethodAllowedForEmailMock.mockResolvedValue(true);
    verificationLimitMock.mockResolvedValue([]);
  });

  it("rejects direct magic-link requests when email/passkey is disabled for a member", async () => {
    isWorkspaceAuthMethodAllowedForEmailMock.mockResolvedValue(false);
    const { POST } = await import("@/app/api/auth/[...all]/route");

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
    expect(isWorkspaceAuthMethodAllowedForEmailMock).toHaveBeenCalledWith({
      method: "emailPasskey",
      callbackUrl: "https://app.test/foreverbrowsing/inbox",
      email: "member@example.com",
      baseUrl: "https://app.test",
    });
    expect(authPostMock).not.toHaveBeenCalled();
  });

  it("delegates direct magic-link requests when the role is exempt", async () => {
    isWorkspaceAuthMethodAllowedForEmailMock.mockResolvedValue(true);
    const { POST } = await import("@/app/api/auth/[...all]/route");
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

    expect(response.status).toBe(200);
    expect(authPostMock).toHaveBeenCalledWith(request);
  });

  it("rejects direct Google id-token sign-in when Google is disabled for a member", async () => {
    isWorkspaceAuthMethodAllowedForEmailMock.mockResolvedValue(false);
    const { POST } = await import("@/app/api/auth/[...all]/route");

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
    expect(isWorkspaceAuthMethodAllowedForEmailMock).toHaveBeenCalledWith({
      method: "google",
      callbackUrl: "https://app.test/foreverbrowsing/inbox",
      email: "member@example.com",
      baseUrl: "https://app.test",
    });
    expect(authPostMock).not.toHaveBeenCalled();
  });

  it("rejects magic-link verification when the stored email is no longer allowed", async () => {
    verificationLimitMock.mockResolvedValue([
      { value: JSON.stringify({ email: "member@example.com" }) },
    ]);
    isWorkspaceAuthMethodAllowedForEmailMock.mockResolvedValue(false);
    const { GET } = await import("@/app/api/auth/[...all]/route");

    const response = await GET(
      new Request(
        "https://app.test/api/auth/magic-link/verify?token=123456&callbackURL=https%3A%2F%2Fapp.test%2Fforeverbrowsing%2Finbox",
      ),
    );

    expect(response.status).toBe(403);
    expect(isWorkspaceAuthMethodAllowedForEmailMock).toHaveBeenCalledWith({
      method: "emailPasskey",
      callbackUrl: "https://app.test/foreverbrowsing/inbox",
      email: "member@example.com",
      baseUrl: "https://app.test",
    });
    expect(authGetMock).not.toHaveBeenCalled();
  });
});
