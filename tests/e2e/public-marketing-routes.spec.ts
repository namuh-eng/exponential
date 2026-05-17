import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const publicRoutes = [
  {
    path: "/homepage",
    text: "The product development system for teams and agents",
  },
  { path: "/pricing", text: "Free" },
  { path: "/customers", text: "Why OpenAI chose Linear" },
  { path: "/changelog", text: "Code Intelligence" },
];

test.describe("public marketing routes", () => {
  for (const route of publicRoutes) {
    test(`${route.path} renders without auth`, async ({ page }) => {
      await page.goto(route.path);

      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByText(route.text).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute(
        "href",
        "/login",
      );
      await expect(page.getByRole("link", { name: "Sign up" })).toHaveAttribute(
        "href",
        "/signup",
      );
      await expect(page.getByRole("link", { name: "Pricing" })).toHaveAttribute(
        "href",
        "/pricing",
      );
      await expect(
        page.getByRole("link", { name: "Customers" }),
      ).toHaveAttribute("href", "/customers");
      await expect(page.getByRole("link", { name: "Now" })).toHaveAttribute(
        "href",
        "/now",
      );
      await expect(
        page.getByRole("link", { name: "Homepage" }),
      ).toHaveAttribute("href", "/homepage");
    });
  }

  test("app routes remain auth protected", async ({ page }) => {
    await page.goto("/settings/security");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fsettings%2Fsecurity/);

    await page.goto("/team/ENG/all");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fteam%2FENG%2Fall/);
  });
});
