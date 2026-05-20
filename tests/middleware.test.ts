import { describe, expect, it, vi } from "vitest";

// Mock next/server
const mockRedirect = vi.fn(
  (url: URL) =>
    new Response(null, {
      status: 307,
      headers: { Location: url.toString() },
    }),
);
const mockNext = vi.fn(
  (_init?: unknown) => new Response(null, { status: 200 }),
);
const mockRewrite = vi.fn(
  (url: URL, _init?: unknown) => new Response(url.toString(), { status: 200 }),
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

  it.each([
    "/foreverbrowsing",
    "/foreverbrowsing/settings/account/security",
    "/foreverbrowsing/team/ENG/all",
    "/foreverbrowsing/projects",
    "/foreverbrowsing/roadmap",
    "/foreverbrowsing/team/ENG/views",
    "/foreverbrowsing/team/ENG/analytics",
    "/foreverbrowsing/team/ENG/insights",
  ])(
    "rewrites unauthenticated workspace deep link %s to login without changing the browser URL",
    async (path) => {
      mockRedirect.mockClear();
      mockRewrite.mockClear();
      const { proxy } = await import("@/proxy");
      const req = createMockRequest(`${path}?view=list`);
      await proxy(req as never);

      expect(mockRedirect).not.toHaveBeenCalled();
      expect(mockRewrite).toHaveBeenCalled();
      const rewriteUrl = mockRewrite.mock.calls[0][0] as URL;
      expect(rewriteUrl.pathname).toBe("/login");
      expect(rewriteUrl.searchParams.get("callbackUrl")).toBe(
        `${path}?view=list`,
      );
    },
  );

  it("redirects authenticated workspace roots to the default inbox without dropping search", async () => {
    mockRedirect.mockClear();
    mockRewrite.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/foreverbrowsing?view=list", {
      "better-auth.session_token": "valid-session-token",
    });
    await proxy(req as never);
    expect(mockRewrite).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalled();
    const redirectUrl = mockRedirect.mock.calls[0][0] as URL;
    expect(redirectUrl.pathname).toBe("/foreverbrowsing/inbox");
    expect(redirectUrl.search).toBe("?view=list");
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

  it.each([
    ["/foreverbrowsing/members", "/members"],
    ["/foreverbrowsing/agent", "/agent"],
    ["/foreverbrowsing/roadmap", "/roadmap"],
  ])(
    "rewrites authenticated workspace-prefixed app route %s without changing the browser URL",
    async (sourcePath, rewrittenPath) => {
      mockRewrite.mockClear();
      mockRedirect.mockClear();
      const { proxy } = await import("@/proxy");
      const req = createMockRequest(`${sourcePath}?view=list`, {
        "better-auth.session_token": "valid-session-token",
      });
      await proxy(req as never);
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(mockRewrite).toHaveBeenCalled();
      expect(mockRewrite.mock.calls[0]?.[0].pathname).toBe(rewrittenPath);
      expect(mockRewrite.mock.calls[0]?.[0].search).toBe("?view=list");
      const rewriteOptions = mockRewrite.mock.calls[0]?.[1] as
        | { request?: { headers?: Headers } }
        | undefined;
      expect(rewriteOptions?.request?.headers?.get("x-workspace-slug")).toBe(
        "foreverbrowsing",
      );
      expect(
        rewriteOptions?.request?.headers?.get("x-workspace-source-path"),
      ).toBe(sourcePath);
    },
  );

  it.each(["/all", "/board"])(
    "rewrites authenticated workspace-prefixed team%s routes without changing the browser URL",
    async (teamRoute) => {
      mockRewrite.mockClear();
      mockRedirect.mockClear();
      const { proxy } = await import("@/proxy");
      const req = createMockRequest(
        `/foreverbrowsing/team/ENG${teamRoute}?group=status`,
        {
          "better-auth.session_token": "valid-session-token",
        },
      );
      await proxy(req as never);
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(mockRewrite).toHaveBeenCalled();
      expect(mockRewrite.mock.calls[0]?.[0].pathname).toBe(
        `/team/ENG${teamRoute}`,
      );
      expect(mockRewrite.mock.calls[0]?.[0].search).toBe("?group=status");
    },
  );

  it("lets authenticated workspace-prefixed settings routes render canonically", async () => {
    mockRewrite.mockClear();
    mockRedirect.mockClear();
    mockNext.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest(
      "/foreverbrowsing/settings/project-updates?tab=reminders",
      {
        "better-auth.session_token": "valid-session-token",
      },
    );
    await proxy(req as never);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockRewrite).not.toHaveBeenCalled();
    expect(mockNext).toHaveBeenCalled();
    const nextOptions = mockNext.mock.calls[0]?.[0] as
      | { request?: { headers?: Headers } }
      | undefined;
    expect(nextOptions?.request?.headers?.get("x-workspace-slug")).toBe(
      "foreverbrowsing",
    );
  });

  it.each([
    "/foreverbrowsing/projects",
    "/foreverbrowsing/projects/all",
    "/foreverbrowsing/project/roadmap",
    "/foreverbrowsing/project/roadmap/overview",
    "/foreverbrowsing/team/ENG/projects",
    "/foreverbrowsing/team/ENG/views",
    "/foreverbrowsing/team/ENG/views/issues",
    "/foreverbrowsing/team/ENG/views/projects",
    "/foreverbrowsing/team/ENG/analytics",
    "/foreverbrowsing/team/ENG/analytics/drilldown",
    "/foreverbrowsing/team/ENG/insights",
    "/foreverbrowsing/team/ENG/insights/drilldown",
    "/foreverbrowsing/initiatives",
    "/foreverbrowsing/initiatives/init-1",
  ])(
    "lets explicit workspace-prefixed route %s render canonically",
    async (path) => {
      mockRewrite.mockClear();
      mockRedirect.mockClear();
      mockNext.mockClear();
      const { proxy } = await import("@/proxy");
      const req = createMockRequest(`${path}?view=list`, {
        "better-auth.session_token": "valid-session-token",
      });
      await proxy(req as never);
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(mockRewrite).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
      const nextOptions = mockNext.mock.calls[0]?.[0] as
        | { request?: { headers?: Headers } }
        | undefined;
      expect(nextOptions?.request?.headers?.get("x-workspace-slug")).toBe(
        "foreverbrowsing",
      );
    },
  );

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

  it("redirects legacy canonical ENG issue routes to workspace-scoped routes", async () => {
    mockRedirect.mockClear();
    const { proxy } = await import("@/proxy");
    const req = createMockRequest("/issue/ENG-1?focusedComment=c-1", {
      "__Secure-better-auth.session_token": "valid-session-token",
    });
    await proxy(req as never);
    expect(mockRedirect).toHaveBeenCalled();
    const redirectUrl = mockRedirect.mock.calls[0][0] as URL;
    expect(redirectUrl.pathname).toBe("/foreverbrowsing/issue/ENG-1");
    expect(redirectUrl.search).toBe("?focusedComment=c-1");
  });

  it.each([
    "/all",
    "/board",
    "/projects",
    "/views",
    "/views/issues",
    "/views/projects",
    "/analytics",
    "/insights",
  ])(
    "redirects legacy canonical ENG team%s routes to workspace-scoped routes",
    async (teamRoute) => {
      mockRedirect.mockClear();
      const { proxy } = await import("@/proxy");
      const req = createMockRequest(`/team/ENG${teamRoute}?view=list`, {
        "__Secure-better-auth.session_token": "valid-session-token",
      });
      await proxy(req as never);
      expect(mockRedirect).toHaveBeenCalled();
      const redirectUrl = mockRedirect.mock.calls[0][0] as URL;
      expect(redirectUrl.pathname).toBe(
        `/foreverbrowsing/team/ENG${teamRoute}`,
      );
      expect(redirectUrl.search).toBe("?view=list");
    },
  );

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
