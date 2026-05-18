import { expect, test } from "@playwright/test";

test.describe("workspace search results", () => {
  test("preserves root search query when normalizing to workspace route", async ({
    page,
  }) => {
    await page.goto("/search?q=a");

    await expect(page).toHaveURL(/\/foreverbrowsing\/search\?q=a$/);
    await expect(
      page.getByRole("heading", { name: 'Search results for "a"' }),
    ).toBeVisible();
    await expect(page.getByTestId("issue-row").first()).toBeVisible();
  });

  test("renders seeded issue metadata and opens the issue detail route", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/search?q=FOREVER-AGENT");

    const result = page
      .getByTestId("issue-row")
      .filter({ hasText: "Issue added to FOREVER-AGENT" })
      .first();

    await expect(page).toHaveURL(/\/foreverbrowsing\/search\?q=FOREVER-AGENT$/);
    await expect(
      page.getByText('Search results for "FOREVER-AGENT"'),
    ).toBeVisible();
    await expect(result).toBeVisible();
    await expect(result).toContainText("ENG-179");
    await expect(result).toHaveAttribute(
      "href",
      "/foreverbrowsing/issue/ENG-179",
    );

    await result.click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/issue\/ENG-179$/);
    await expect(page.getByText("ENG-179").first()).toBeVisible();
  });
});
