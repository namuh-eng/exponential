import { expect, test } from "@playwright/test";

test("workspace search preserves query and opens usable issue rows", async ({
  page,
}) => {
  await page.goto("/foreverbrowsing/search?q=ENG-1");

  await expect(page).toHaveURL(/\/foreverbrowsing\/search\?q=ENG-1$/);
  await expect(
    page.getByRole("heading", { name: 'Search results for "ENG-1"' }),
  ).toBeVisible();

  const firstIssueRow = page
    .locator('a[href^="/foreverbrowsing/team/ENG/issue/"]')
    .first();
  await expect(firstIssueRow).toBeVisible();
  await expect(firstIssueRow).toContainText(/ENG-1\d*/);
  await expect(firstIssueRow).toHaveAttribute(
    "href",
    /^\/foreverbrowsing\/team\/ENG\/issue\/ENG-1\d*$/,
  );

  await firstIssueRow.click();
  await expect(page).toHaveURL(
    /\/foreverbrowsing\/team\/ENG\/issue\/ENG-1\d*$/,
  );
  await expect(
    page.getByRole("link", { name: "Back to issues" }),
  ).toBeVisible();
});
