import { afterEach, describe, expect, it, vi } from "vitest";

const resolveWorkspaceAuthPolicyMock = vi.hoisted(() => vi.fn());
const isWorkspaceAuthMethodAllowedMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/passkeys", () => ({
  isPasskeyAuthEnabled: () => false,
}));

vi.mock("@/lib/workspace-auth-methods", () => ({
  resolveWorkspaceAuthPolicy: resolveWorkspaceAuthPolicyMock,
  isWorkspaceAuthMethodAllowed: isWorkspaceAuthMethodAllowedMock,
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
    resolveWorkspaceAuthPolicyMock.mockResolvedValue(null);
    isWorkspaceAuthMethodAllowedMock.mockReturnValue(true);

    const { GET } = await import("legacy-api/auth/provider-capabilities/route");
    const response = await GET(
      new Request("http://localhost/api/auth/provider-capabilities"),
    );
    const data = await response.json();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(data.providers.github).toEqual({
      supported: true,
      configured: true,
      devLinking: true,
      unavailableReason: null,
    });
    expect(data.providers.gitlab).toEqual({
      supported: true,
      configured: false,
      devLinking: true,
      unavailableReason:
        "GitLab OAuth is not configured. Dev and e2e can still exercise the linking surface.",
    });
    expect(data.providers.passkey).toBe(false);
    expect(data.providers.googleAllowed).toBe(true);
    expect(data.providers.emailPasskey).toBe(true);
    expect(data.workspace).toBeNull();
  });

  it("applies workspace authentication settings to login providers", async () => {
    process.env.AUTH_GOOGLE_ID = "google-client";
    process.env.AUTH_GOOGLE_SECRET = "google-secret";
    resolveWorkspaceAuthPolicyMock.mockResolvedValue({
      workspaceSlug: "foreverbrowsing",
      workspaceId: "workspace-1",
      authentication: { google: false, emailPasskey: false },
    });
    isWorkspaceAuthMethodAllowedMock.mockImplementation(
      (_policy: unknown, method: string) => {
        if (method === "google") return false;
        if (method === "emailPasskey") return false;
        return true;
      },
    );

    const { GET } = await import("legacy-api/auth/provider-capabilities/route");
    const response = await GET(
      new Request(
        "http://localhost/api/auth/provider-capabilities?callbackUrl=%2Fforeverbrowsing%2Fsettings%2Fsecurity",
      ),
    );
    const data = await response.json();

    expect(data.providers.googleAllowed).toBe(false);
    expect(data.providers.emailPasskey).toBe(false);
    expect(data.providers.passkey).toBe(false);
    expect(data.workspace).toEqual({
      slug: "foreverbrowsing",
      authentication: { google: false, emailPasskey: false },
    });
  });
});
