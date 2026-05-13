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
});
