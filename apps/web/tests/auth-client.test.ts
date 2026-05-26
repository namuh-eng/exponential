import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const assignMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("location", {
  ...window.location,
  origin: "http://localhost:7015",
  assign: assignMock,
});

describe("headless auth client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window.navigator, "credentials", {
      value: undefined,
      configurable: true,
    });
  });

  it("starts Google OAuth through the first-party Go API", async () => {
    const { signIn } = await import("@/lib/auth-client");

    const result = await signIn.social({
      provider: "google",
      callbackURL: "http://localhost:7015/team/ABC",
    });

    expect(result?.data?.url).toBe(
      "/api/auth/google/start?callback_url=%2Fteam%2FABC",
    );
    expect(result?.data?.redirect).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts a first-party magic-link login", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    const { signIn } = await import("@/lib/auth-client");

    await signIn.magicLink({
      email: "person@example.com",
      callbackURL: "http://localhost:7015/team/ABC",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/magic-link",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          email: "person@example.com",
          callbackURL: "/team/ABC",
        }),
      }),
    );
  });

  it("reports unsupported passkey sign-in before calling auth APIs", async () => {
    const { signInWithPasskey } = await import("@/lib/auth-client");

    await expect(
      signInWithPasskey({ callbackURL: "http://localhost:7015/" }),
    ).rejects.toMatchObject({ code: "BROWSER_UNSUPPORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps configured-browser passkey sign-in to a not-configured error", async () => {
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      value: function PublicKeyCredential() {},
      configurable: true,
    });
    Object.defineProperty(window.navigator, "credentials", {
      value: { get: vi.fn(), create: vi.fn() },
      configurable: true,
    });

    const { signInWithPasskey } = await import("@/lib/auth-client");

    await expect(
      signInWithPasskey({ callbackURL: "http://localhost:7015/" }),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});
