import { expect, test } from "@playwright/test";

test.describe("workspace search results", () => {
  test("preserves query, renders issue metadata, and opens result rows", async ({
    page,
  }) => {
    const query = "ENG-179";

    await page.goto(`/foreverbrowsing/search?q=${query}`);
    await expect(page).toHaveURL(/\/foreverbrowsing\/search\?q=ENG-179$/);
    await expect(
      page.getByRole("heading", { name: `Search results for "${query}"` }),
    ).toBeVisible();

    const row = page.getByTestId("issue-row").filter({ hasText: query });
    await expect(row).toBeVisible();
    await expect(row.getByRole("img", { name: "Triage" })).toBeVisible();
    await expect(row).toContainText(/[A-Z][a-z]{2} \d{1,2}/);

    await page.goto(`/search?q=${query}`);
    await expect(page).toHaveURL(/\/foreverbrowsing\/search\?q=ENG-179$/);
    await expect(
      page.getByTestId("issue-row").filter({ hasText: query }),
    ).toBeVisible();

    await page.getByTestId("issue-row").filter({ hasText: query }).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/issue\/ENG-179$/);
    await expect(page.getByText(query).first()).toBeVisible();
  });
});
