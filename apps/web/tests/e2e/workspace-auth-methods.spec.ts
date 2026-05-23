import { expect, test } from "@playwright/test";

test.describe("Workspace auth method enforcement", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("hides workspace-disabled Google, email, and passkey methods on rewritten login", async ({
    page,
  }) => {
    await page.route("**/api/auth/provider-capabilities**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          providers: {
            google: { configured: false },
            googleAllowed: false,
            emailPasskey: false,
            passkey: false,
          },
        }),
      });
    });

    await page.goto("/auth-methods-off/inbox");

    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Continue with email" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Log in with passkey" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Continue with SAML SSO" }),
    ).toBeVisible();
  });
});
