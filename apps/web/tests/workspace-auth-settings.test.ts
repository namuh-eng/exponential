import { beforeEach, describe, expect, it, vi } from "vitest";

const queuedResults: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(function (this: unknown) {
          return this;
        }),
        where: vi.fn(function (this: unknown) {
          return this;
        }),
        limit: vi.fn(() => Promise.resolve(queuedResults.shift() ?? [])),
      })),
    })),
  },
}));

describe("workspace auth settings", () => {
  beforeEach(() => {
    queuedResults.length = 0;
    vi.clearAllMocks();
  });

  it("reads auth settings with defaults", async () => {
    const { readWorkspaceAuthenticationSettings } = await import(
      "@/lib/workspace-auth-settings"
    );

    expect(
      readWorkspaceAuthenticationSettings({
        security: { authentication: { google: false } },
      }),
    ).toEqual({ google: false, emailPasskey: true });
  });

  it("extracts workspace slugs only from workspace-scoped callbacks", async () => {
    const { getWorkspaceSlugFromCallbackUrl } = await import(
      "@/lib/workspace-auth-settings"
    );

    expect(
      getWorkspaceSlugFromCallbackUrl("/foreverbrowsing/settings/security"),
    ).toBe("foreverbrowsing");
    expect(getWorkspaceSlugFromCallbackUrl("/login")).toBeNull();
    expect(
      getWorkspaceSlugFromCallbackUrl("https://evil.test/phish"),
    ).toBeNull();
  });

  it("blocks disabled member email/passkey auth", async () => {
    queuedResults.push(
      [
        {
          id: "workspace-1",
          urlSlug: "foreverbrowsing",
          settings: {
            security: { authentication: { google: true, emailPasskey: false } },
          },
        },
      ],
      [{ role: "member" }],
    );
    const { isWorkspaceAuthMethodAllowedForEmail } = await import(
      "@/lib/workspace-auth-settings"
    );

    await expect(
      isWorkspaceAuthMethodAllowedForEmail({
        method: "emailPasskey",
        callbackUrl: "/foreverbrowsing/inbox",
        email: "member@example.com",
      }),
    ).resolves.toBe(false);
  });

  it("allows disabled auth for admin and guest exceptions", async () => {
    queuedResults.push(
      [
        {
          id: "workspace-1",
          urlSlug: "foreverbrowsing",
          settings: {
            security: {
              authentication: { google: false, emailPasskey: false },
            },
          },
        },
      ],
      [{ role: "admin" }],
      [
        {
          id: "workspace-1",
          urlSlug: "foreverbrowsing",
          settings: {
            security: {
              authentication: { google: false, emailPasskey: false },
            },
          },
        },
      ],
      [{ role: "guest" }],
    );
    const { isWorkspaceAuthMethodAllowedForEmail } = await import(
      "@/lib/workspace-auth-settings"
    );

    await expect(
      isWorkspaceAuthMethodAllowedForEmail({
        method: "google",
        callbackUrl: "/foreverbrowsing/inbox",
        email: "admin@example.com",
      }),
    ).resolves.toBe(true);
    await expect(
      isWorkspaceAuthMethodAllowedForEmail({
        method: "emailPasskey",
        callbackUrl: "/foreverbrowsing/inbox",
        email: "guest@example.com",
      }),
    ).resolves.toBe(true);
  });
});
