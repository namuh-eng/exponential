import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/passkeys", () => ({
  isPasskeyAuthEnabled: () => false,
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
  });

  it("exposes integration-backed connected account provider flags", async () => {
    process.env.AUTH_GITHUB_ID = "github-client";
    process.env.AUTH_GITHUB_SECRET = "github-secret";

    const { GET } = await import("@/app/api/auth/provider-capabilities/route");
    const response = GET();
    const data = await response.json();

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(data.providers).toEqual({
      google: false,
      github: true,
      gitlab: false,
      slack: false,
      passkey: false,
    });
  });
});
