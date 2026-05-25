import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const assignMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("location", {
  ...window.location,
  origin: "http://localhost:7015",
  assign: assignMock,
});

function mockKratosFlow() {
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ui: {
          action: "http://localhost:4433/self-service/login?flow=abc",
          nodes: [{ attributes: { name: "csrf_token", value: "csrf" } }],
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirect_browser_to: "http://localhost:7015/" }),
    });
}

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

  it("starts a Kratos OIDC login through the same-origin proxy", async () => {
    mockKratosFlow();
    const { signIn } = await import("@/lib/auth-client");

    const result = await signIn.social({
      provider: "google",
      callbackURL: "http://localhost:7015/team/ABC",
    });

    expect(result?.data?.url).toBe("http://localhost:7015/");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/kratos/self-service/login/browser?return_to=http%3A%2F%2Flocalhost%3A7015%2Fteam%2FABC",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/kratos/self-service/login?flow=abc",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          method: "oidc",
          provider: "google",
          csrf_token: "csrf",
        }),
      }),
    );
  });

  it("starts a Kratos magic-link login through the same-origin proxy", async () => {
    mockKratosFlow();
    const { signIn } = await import("@/lib/auth-client");

    await signIn.magicLink({
      email: "person@example.com",
      callbackURL: "http://localhost:7015/",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/kratos/self-service/login?flow=abc",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          method: "link",
          identifier: "person@example.com",
          csrf_token: "csrf",
        }),
      }),
    );
  });

  it("reports unsupported passkey sign-in before calling Kratos", async () => {
    const { signInWithPasskey } = await import("@/lib/auth-client");

    await expect(
      signInWithPasskey({ callbackURL: "http://localhost:7015/" }),
    ).rejects.toMatchObject({ code: "BROWSER_UNSUPPORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps configured-browser passkey sign-in to a Kratos-not-configured error", async () => {
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
