import { beforeEach, describe, expect, it, vi } from "vitest";

const createAuthClientMock = vi.hoisted(() => vi.fn());
const signInPasskeyMock = vi.hoisted(() => vi.fn());
const magicLinkClientMock = vi.hoisted(() =>
  vi.fn(() => ({ id: "magic-link" })),
);
const passkeyClientMock = vi.hoisted(() => vi.fn(() => ({ id: "passkey" })));

vi.mock("better-auth/react", () => ({
  createAuthClient: createAuthClientMock,
}));

vi.mock("better-auth/client/plugins", () => ({
  magicLinkClient: magicLinkClientMock,
}));

vi.mock("@better-auth/passkey/client", () => ({
  passkeyClient: passkeyClientMock,
}));

describe("auth client origin", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    createAuthClientMock.mockReset();
    createAuthClientMock.mockReturnValue({
      signIn: {
        social: vi.fn(),
        magicLink: vi.fn(),
        passkey: signInPasskeyMock,
      },
      passkey: { addPasskey: vi.fn() },
      signOut: vi.fn(),
      useSession: vi.fn(),
    });
    magicLinkClientMock.mockClear();
    signInPasskeyMock.mockReset();
  });

  it("uses same-origin auth requests when NEXT_PUBLIC_APP_URL is unset", async () => {
    await import("@/lib/auth-client");

    expect(createAuthClientMock).toHaveBeenCalledWith({
      plugins: [{ id: "magic-link" }, { id: "passkey" }],
    });
  });

  it("honors NEXT_PUBLIC_APP_URL as an explicit auth origin override", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://whetline.example");

    await import("@/lib/auth-client");

    expect(createAuthClientMock).toHaveBeenCalledWith({
      baseURL: "https://whetline.example",
      plugins: [{ id: "magic-link" }, { id: "passkey" }],
    });
  });

  it("starts Better Auth passkey sign-in and maps user cancellation", async () => {
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      value: function PublicKeyCredential() {},
      configurable: true,
    });
    Object.defineProperty(window.navigator, "credentials", {
      value: { get: vi.fn(), create: vi.fn() },
      configurable: true,
    });
    signInPasskeyMock.mockResolvedValueOnce({
      data: null,
      error: { code: "AUTH_CANCELLED" },
    });

    const { signInWithPasskey } = await import("@/lib/auth-client");

    await expect(
      signInWithPasskey({ callbackURL: "http://localhost:3015/team/ABC" }),
    ).rejects.toMatchObject({
      code: "CANCELED",
      message: "Passkey sign-in was canceled. Try again.",
    });
    expect(signInPasskeyMock).toHaveBeenCalledTimes(1);
  });

  it("maps thrown WebAuthn AbortError to a retryable cancellation", async () => {
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      value: function PublicKeyCredential() {},
      configurable: true,
    });
    Object.defineProperty(window.navigator, "credentials", {
      value: { get: vi.fn(), create: vi.fn() },
      configurable: true,
    });
    signInPasskeyMock.mockRejectedValueOnce(
      new DOMException("The operation was aborted.", "AbortError"),
    );

    const { signInWithPasskey } = await import("@/lib/auth-client");

    await expect(
      signInWithPasskey({ callbackURL: "http://localhost:3015/" }),
    ).rejects.toMatchObject({
      code: "CANCELED",
      message: "Passkey sign-in was canceled. Try again.",
    });
    expect(signInPasskeyMock).toHaveBeenCalledTimes(1);
  });
});
