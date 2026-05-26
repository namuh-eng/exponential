import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("location", {
  ...window.location,
  origin: "http://localhost:7015",
  assign: vi.fn(),
});

describe("first-party auth URL construction", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses same-origin Go API requests for browser sign-in", async () => {
    const { signIn } = await import("@/lib/auth-client");

    const result = await signIn.social({
      provider: "google",
      callbackURL: "http://localhost:7015/team/ABC",
    });

    expect(result.data?.url).toBe(
      "/api/auth/google/start?callback_url=%2Fteam%2FABC",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
