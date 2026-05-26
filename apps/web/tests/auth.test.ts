import { describe, expect, it } from "vitest";

describe("headless auth compatibility", () => {
  it("keeps the legacy server auth shim non-authoritative", async () => {
    const { auth } = await import("@/lib/auth");

    await expect(auth.api.getSession()).resolves.toBeNull();
    const response = await auth.handler();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: "Better Auth has been removed",
    });
  });

  it("exports headless browser auth helpers", async () => {
    const { authClient, signIn, signOut, useSession } = await import(
      "@/lib/auth-client"
    );
    expect(authClient).toBeDefined();
    expect(signIn.social).toBeTypeOf("function");
    expect(signIn.magicLink).toBeTypeOf("function");
    expect(signOut).toBeTypeOf("function");
    expect(useSession()).toEqual({ data: null, isPending: false });
  });

  it("legacy auth API route returns removed responses outside first-party Go auth paths", async () => {
    const route = await import("legacy-api/auth/[...all]/route");

    const getResponse = await route.GET(
      new Request("https://app.test/api/auth/session"),
    );
    const postResponse = await route.POST(
      new Request("https://app.test/api/auth/sign-in/magic-link", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );

    expect(getResponse.status).toBe(410);
    expect(postResponse.status).toBe(410);
  });
});
