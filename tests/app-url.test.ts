import { beforeEach, describe, expect, it, vi } from "vitest";

describe("app URL helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("defaults server-side canonical app URL to the dev app port", async () => {
    const { getConfiguredAppUrl } = await import("@/lib/app-url");

    expect(getConfiguredAppUrl()).toBe("http://localhost:3015");
  });

  it("uses explicit BETTER_AUTH_URL before public app URL", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://auth.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://public.example");
    const { getConfiguredAppUrl } = await import("@/lib/app-url");

    expect(getConfiguredAppUrl()).toBe("https://auth.example");
  });

  it("uses the request origin for per-request URLs when no override is set", async () => {
    const { getRequestAppUrl } = await import("@/lib/app-url");

    expect(
      getRequestAppUrl(
        new Request("http://localhost:3015/api/workspaces/invite"),
      ),
    ).toBe("http://localhost:3015");
  });

  it("uses explicit app URL override for per-request URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example");
    const { getRequestAppUrl } = await import("@/lib/app-url");

    expect(
      getRequestAppUrl(
        new Request("http://localhost:3015/api/workspaces/invite"),
      ),
    ).toBe("https://staging.example");
  });
});
