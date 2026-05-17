import { beforeEach, describe, expect, it, vi } from "vitest";

const betterAuthMock = vi.hoisted(() => vi.fn((config) => ({ config })));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email", () => ({
  sendMagicLinkEmail: vi.fn(() => Promise.resolve()),
}));
vi.mock("better-auth", () => ({ betterAuth: betterAuthMock }));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(() => ({ type: "drizzle" })),
}));
vi.mock("better-auth/plugins", () => ({
  magicLink: vi.fn((options) => ({ id: "magic-link", options })),
}));

describe("Better Auth server URL", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    betterAuthMock.mockClear();
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://test@localhost/test");
  });

  it("defaults Better Auth base URL and trusted origin to dev port 3015", async () => {
    await import("@/lib/auth");

    expect(betterAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "http://localhost:3015",
        trustedOrigins: ["http://localhost:3015"],
      }),
    );
  });

  it("preserves explicit NEXT_PUBLIC_APP_URL override", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example");

    await import("@/lib/auth");

    expect(betterAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://staging.example",
        trustedOrigins: ["https://staging.example"],
      }),
    );
  });
});
