import { describe, expect, it, vi } from "vitest";

// Mock next/server
const mockRedirect = vi.fn(
  (url: URL) =>
    new Response(null, {
      status: 307,
      headers: { Location: url.toString() },
    }),
);
const mockNext = vi.fn(() => new Response(null, { status: 200 }));
const mockRewrite = vi.fn(
  (url: URL) => new Response(url.toString(), { status: 200 }),
);

vi.mock("next/server", () => ({
  NextResponse: {
    redirect: mockRedirect,
    next: mockNext,
    rewrite: mockRewrite,
  },
}));

function createMockRequest(path: string, cookies: Record<string, string> = {}) {
  const url = new URL(`http://localhost:3000${path}`);
  const nextUrl = {
    pathname: url.pathname,
    search: url.search,
    clone: () => new URL(url.toString()),
  };
  return {
    nextUrl,
    url: url.toString(),
    cookies: {
      get: (name: string) =>
        cookies[name] ? { value: cookies[name] } : undefined,
    },
  };
}

describe("Auth proxy", () => {
  it("allows /login path without auth", async () => {
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/login");
    await proxy(req as never);
    expect(mockNext).toHaveBeenCalled();
  });

  it("allows /signup path without auth", async () => {
    mockNext.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/signup");
    await proxy(req as never);
    expect(mockNext).toHaveBeenCalled();
  });

  it("allows /api/auth paths without auth", async () => {
    mockNext.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/api/auth/callback/google");
    await proxy(req as never);
    expect(mockNext).toHaveBeenCalled();
  });

  it("allows static assets without auth", async () => {
    mockNext.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/_next/static/chunks/main.js");
    await proxy(req as never);
    expect(mockNext).toHaveBeenCalled();
  });

  it("redirects to /login when no session cookie", async () => {
    mockRedirect.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/inbox");
    await proxy(req as never);
    expect(mockRedirect).toHaveBeenCalled();
    const redirectUrl = mockRedirect.mock.calls[0][0] as URL;
    expect(redirectUrl.pathname).toBe("/login");
    expect(redirectUrl.searchParams.get("callbackUrl")).toBe("/inbox");
  });

  it("redirects unauthenticated users away from /create-workspace", async () => {
    mockRedirect.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/create-workspace");
    await proxy(req as never);
    const redirectUrl = mockRedirect.mock.calls[0][0] as URL;
    expect(redirectUrl.pathname).toBe("/login");
    expect(redirectUrl.searchParams.get("callbackUrl")).toBe(
      "/create-workspace",
    );
  });

  it("redirects unauthenticated users away from /onboarding routes", async () => {
    mockRedirect.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/onboarding/invite");
    await proxy(req as never);
    const redirectUrl = mockRedirect.mock.calls[0][0] as URL;
    expect(redirectUrl.pathname).toBe("/login");
    expect(redirectUrl.searchParams.get("callbackUrl")).toBe(
      "/onboarding/invite",
    );
  });

  it("redirects legacy connected accounts path to canonical connections path", async () => {
    mockRedirect.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/settings/account/connected?tab=auth", {
      "better-auth.session_token": "valid-session-token",
    });
    await proxy(req as never);
    expect(mockRedirect).toHaveBeenCalled();
    const redirectUrl = mockRedirect.mock.calls[0][0] as URL;
    expect(redirectUrl.pathname).toBe("/settings/account/connections");
    expect(redirectUrl.search).toBe("?tab=auth");
  });

  it("redirects workspace-prefixed legacy connected accounts path", async () => {
    mockRedirect.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest(
      "/foreverbrowsing/settings/account/connected",
      {
        "better-auth.session_token": "valid-session-token",
      },
    );
    await proxy(req as never);
    expect(mockRedirect).toHaveBeenCalled();
    const redirectUrl = mockRedirect.mock.calls[0][0] as URL;
    expect(redirectUrl.pathname).toBe(
      "/foreverbrowsing/settings/account/connections",
    );
  });

  it("allows authenticated requests with session cookie", async () => {
    mockNext.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/inbox", {
      "better-auth.session_token": "valid-session-token",
    });
    await proxy(req as never);
    expect(mockNext).toHaveBeenCalled();
  });

  it("rewrites workspace-prefixed members and teams routes", async () => {
    mockRewrite.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/foreverbrowsing/members", {
      "better-auth.session_token": "valid-session-token",
    });
    await proxy(req as never);
    expect(mockRewrite).toHaveBeenCalled();
    expect(mockRewrite.mock.calls[0]?.[0].pathname).toBe("/members");
  });

  it("does not rewrite settings teams routes as workspace-prefixed directory routes", async () => {
    mockRewrite.mockClear();
    mockNext.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/settings/teams/ENG/general", {
      "better-auth.session_token": "valid-session-token",
    });
    await proxy(req as never);
    expect(mockRewrite).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalled();
  });

  it("allows authenticated requests with secure cookie", async () => {
    mockNext.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/team/ENG/all", {
      "__Secure-better-auth.session_token": "valid-session-token",
    });
    await proxy(req as never);
    expect(mockNext).toHaveBeenCalled();
  });

  it("preserves callback URL in redirect", async () => {
    mockRedirect.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/team/ENG/board");
    await proxy(req as never);
    const redirectUrl = mockRedirect.mock.calls[0][0] as URL;
    expect(redirectUrl.searchParams.get("callbackUrl")).toBe("/team/ENG/board");
  });

  it("preserves query params in callback URL redirects", async () => {
    mockRedirect.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/accept-invite?token=signed-token");
    await proxy(req as never);
    const redirectUrl = mockRedirect.mock.calls[0][0] as URL;
    expect(redirectUrl.searchParams.get("callbackUrl")).toBe(
      "/accept-invite?token=signed-token",
    );
  });

  it("exports matcher config", async () => {
    const { config } = await import("@/proxy");
    expect(config.matcher).toBeDefined();
    expect(config.matcher.length).toBeGreaterThan(0);
  });
});
