import { beforeEach, describe, expect, it, vi } from "vitest";

const createAuthClientMock = vi.hoisted(() => vi.fn());
const magicLinkClientMock = vi.hoisted(() =>
  vi.fn(() => ({ id: "magic-link" })),
);

vi.mock("better-auth/react", () => ({
  createAuthClient: createAuthClientMock,
}));

vi.mock("better-auth/client/plugins", () => ({
  magicLinkClient: magicLinkClientMock,
}));

describe("auth client origin", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    createAuthClientMock.mockReset();
    createAuthClientMock.mockReturnValue({
      signIn: { social: vi.fn(), magicLink: vi.fn() },
      signOut: vi.fn(),
      useSession: vi.fn(),
    });
    magicLinkClientMock.mockClear();
  });

  it("uses same-origin auth requests when NEXT_PUBLIC_APP_URL is unset", async () => {
    await import("@/lib/auth-client");

    expect(createAuthClientMock).toHaveBeenCalledWith({
      plugins: [{ id: "magic-link" }],
    });
  });

  it("honors NEXT_PUBLIC_APP_URL as an explicit auth origin override", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://whetline.example");

    await import("@/lib/auth-client");

    expect(createAuthClientMock).toHaveBeenCalledWith({
      baseURL: "https://whetline.example",
      plugins: [{ id: "magic-link" }],
    });
  });

  it("starts WebAuthn for passkey sign-in and maps user cancellation", async () => {
    const credentialsGet = vi.fn(
      (_options: CredentialRequestOptions): Promise<Credential | null> =>
        Promise.reject(
          new DOMException("The operation was aborted", "NotAllowedError"),
        ),
    );
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      value: function PublicKeyCredential() {},
      configurable: true,
    });
    Object.defineProperty(window.navigator, "credentials", {
      value: { get: credentialsGet },
      configurable: true,
    });

    const { signInWithPasskey } = await import("@/lib/auth-client");

    await expect(
      signInWithPasskey({ callbackURL: "http://localhost:3015/team/ABC" }),
    ).rejects.toMatchObject({
      code: "CANCELED",
      message: "Passkey sign-in was canceled. Try again.",
    });
    expect(credentialsGet).toHaveBeenCalledTimes(1);
    const firstCallOptions = credentialsGet.mock.calls[0]?.[0];
    expect(firstCallOptions).toMatchObject({
      publicKey: {
        timeout: 60_000,
        userVerification: "preferred",
      },
    });
    expect(firstCallOptions?.publicKey?.challenge).toBeInstanceOf(Uint8Array);
  });
});
