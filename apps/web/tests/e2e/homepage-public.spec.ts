import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("public homepage and auth footer navigation", () => {
  test("login learn more stays clone-local", async ({ page }) => {
    await page.goto("/login");

    const learnMore = page.getByRole("link", { name: "learn more" });
    await expect(learnMore).toHaveAttribute("href", "/homepage");

    const href = await learnMore.evaluate(
      (link) => (link as HTMLAnchorElement).href,
    );
    expect(new URL(href).origin).toBe(new URL(page.url()).origin);
  });

  test("/homepage renders public marketing content instead of login", async ({
    page,
  }) => {
    await page.goto("/homepage");

    await expect(
      page.getByRole("heading", {
        name: "Purpose-built for planning and building products",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Log in to exponential" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Start building" }),
    ).toHaveAttribute("href", "/signup");
  });
});
