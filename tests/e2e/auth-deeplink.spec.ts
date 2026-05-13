import { expect, test } from "@playwright/test";

const workspaceDeepLinks = [
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
      const expectedUrl = new URL(deepLink, "http://localhost:3000");
      await expect(page).toHaveURL((url) => {
        return (
          url.pathname === expectedUrl.pathname &&
          url.search === expectedUrl.search
        );
      });
    });
  }

  test("direct /login and /signup still render", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Log in to Linear" }),
    ).toBeVisible();

    await page.goto("/signup");
    await expect(page).toHaveURL(/\/signup$/);
    await expect(
      page.getByRole("heading", { name: "Create your workspace" }),
    ).toBeVisible();
  });
});
