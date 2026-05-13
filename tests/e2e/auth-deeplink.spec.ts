import { expect, test } from "@playwright/test";

const workspaceDeepLinks = [
  "/foreverbrowsing",
  "/foreverbrowsing/settings/account/security",
  "/foreverbrowsing/team/ENG/all",
  "/foreverbrowsing/projects?view=list",
];

test.describe("Unauthenticated workspace deep links", () => {
  for (const deepLink of workspaceDeepLinks) {
    test(`renders login in place for ${deepLink}`, async ({ page }) => {
      await page.goto(deepLink);

      await expect(
        page.getByRole("heading", { name: "Log in to Linear" }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Google sign-in is not configured. Use email or SAML SSO instead.",
        ),
      ).toHaveCount(0);
      const expectedUrl = new URL(deepLink, "http://localhost:3000");
      await expect(page).toHaveURL((url) => {
        return (
          url.pathname === expectedUrl.pathname &&
          url.search === expectedUrl.search
        );
      });
    });
  }

  test("email login from workspace root uses the root as callback URLs", async ({
    page,
  }) => {
    let magicLinkPayload: Record<string, unknown> | undefined;

    await page.route("**/api/auth/**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        magicLinkPayload = request.postDataJSON() as Record<string, unknown>;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/foreverbrowsing");
    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Google sign-in is not configured. Use email or SAML SSO instead.",
      ),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Continue with email" }).click();
    await page
      .getByPlaceholder("Enter your email address…")
      .fill("test@example.com");
    await page.getByRole("button", { name: "Continue with email" }).click();

    await expect(
      page.getByRole("heading", { name: "Check your email" }),
    ).toBeVisible();
    expect(magicLinkPayload).toMatchObject({
      email: "test@example.com",
      callbackURL: "http://localhost:3000/foreverbrowsing",
      errorCallbackURL: "http://localhost:3000/foreverbrowsing",
    });
  });

  test("direct /login and /signup still render", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Google sign-in is not configured. Use email or SAML SSO instead.",
      ),
    ).toHaveCount(0);

    await page.goto("/signup");
    await expect(page).toHaveURL(/\/signup$/);
    await expect(
      page.getByRole("heading", { name: "Create your workspace" }),
    ).toBeVisible();
  });
});
