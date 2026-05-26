import { expect, test } from "@playwright/test";

test.describe("Team templates settings", () => {
  test("renders valid slug-prefixed route and invalid team as controlled error", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/settings/teams/ENG/templates");
    await expect(
      page.getByRole("heading", { name: "Templates" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New template" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Create reusable templates for issues/),
    ).toBeVisible();

    await page.goto("/foreverbrowsing/settings/teams/ONB/templates");
    await expect(page.getByText("Team not found")).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
  });
});
