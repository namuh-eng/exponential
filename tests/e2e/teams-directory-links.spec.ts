import { expect, test } from "@playwright/test";

test.describe("Teams directory links", () => {
  test("preserve workspace slug for card issue and settings actions", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/teams");
    await expect(page).toHaveURL(/\/foreverbrowsing\/teams$/);
    await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();

    const viewIssues = page.getByRole("link", { name: "View issues" }).first();
    const settings = page.getByRole("link", { name: "Settings" }).first();

    await expect(viewIssues).toHaveAttribute(
      "href",
      "/foreverbrowsing/team/ENG/all",
    );
    await expect(settings).toHaveAttribute(
      "href",
      "/foreverbrowsing/settings/teams/ENG",
    );

    await viewIssues.click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/all$/);
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/teams");
    await expect(page).toHaveURL(/\/foreverbrowsing\/teams$/);
    await expect(
      page.getByRole("link", { name: "View issues" }).first(),
    ).toHaveAttribute("href", "/foreverbrowsing/team/ENG/all");

    await page.getByRole("link", { name: "Settings" }).first().click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/settings\/teams\/ENG$/);
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
  });
});
