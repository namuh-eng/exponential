import { afterEach, describe, expect, it, vi } from "vitest";

const getWorkspaceAuthPolicyBySlugMock = vi.hoisted(() => vi.fn());
const getWorkspaceSlugFromCallbackUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/passkeys", () => ({
  isPasskeyAuthEnabled: () => false,
}));

vi.mock("@/lib/workspace-auth-settings", () => ({
  getWorkspaceAuthPolicyBySlug: getWorkspaceAuthPolicyBySlugMock,
  getWorkspaceSlugFromCallbackUrl: getWorkspaceSlugFromCallbackUrlMock,
}));

const OAUTH_ENV_KEYS = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
  "AUTH_GITLAB_ID",
  "AUTH_GITLAB_SECRET",
  "AUTH_SLACK_ID",
  "AUTH_SLACK_SECRET",
] as const;

describe("provider capabilities route", () => {
  afterEach(() => {
    for (const key of OAUTH_ENV_KEYS) {
      delete process.env[key];
    }
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("exposes integration-backed connected account provider flags", async () => {
    process.env.AUTH_GITHUB_ID = "github-client";
    process.env.AUTH_GITHUB_SECRET = "github-secret";
    getWorkspaceAuthPolicyBySlugMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/auth/provider-capabilities/route");
    const response = await GET(
      new Request("https://app.test/api/auth/provider-capabilities"),
    );
    const data = await response.json();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(data).toEqual({
      providers: {
        google: {
          supported: true,
          configured: false,
          devLinking: true,
          unavailableReason:
            "Google OAuth is not configured. Dev and e2e can still exercise the linking surface.",
        },
        github: {
          supported: true,
          configured: true,
          devLinking: true,
          unavailableReason: null,
        },
        gitlab: {
          supported: true,
          configured: false,
          devLinking: true,
          unavailableReason:
            "GitLab OAuth is not configured. Dev and e2e can still exercise the linking surface.",
        },
        slack: {
          supported: true,
          configured: false,
          devLinking: true,
          unavailableReason:
            "Slack OAuth is not configured. Dev and e2e can still exercise the linking surface.",
        },
        email: true,
        passkey: false,
      },
      workspace: null,
    });
  });

  it("applies workspace authentication settings to login providers", async () => {
    process.env.AUTH_GOOGLE_ID = "google-client";
    process.env.AUTH_GOOGLE_SECRET = "google-secret";
    getWorkspaceSlugFromCallbackUrlMock.mockReturnValue("foreverbrowsing");
    getWorkspaceAuthPolicyBySlugMock.mockResolvedValue({
      workspaceSlug: "foreverbrowsing",
      workspaceId: "workspace-1",
      authentication: { google: false, emailPasskey: false },
    });

    const { GET } = await import("@/app/api/auth/provider-capabilities/route");
    const response = await GET(
      new Request(
        "https://app.test/api/auth/provider-capabilities?callbackUrl=%2Fforeverbrowsing%2Fsettings%2Fsecurity",
      ),
    );
    const data = await response.json();

    expect(getWorkspaceSlugFromCallbackUrlMock).toHaveBeenCalledWith(
      "/foreverbrowsing/settings/security",
      "https://app.test",
    );
    expect(data.providers.google).toBe(false);
    expect(data.providers.email).toBe(false);
    expect(data.providers.passkey).toBe(false);
    expect(data.workspace).toEqual({
      slug: "foreverbrowsing",
      authentication: { google: false, emailPasskey: false },
    });
  });
});
