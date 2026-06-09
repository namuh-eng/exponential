import { type Page, expect, test } from "@playwright/test";

async function gotoAndExpectPath(
  page: Page,
  targetPath: string,
  expectedPath = targetPath,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(targetPath, { waitUntil: "domcontentloaded" });
    } catch (error) {
      if (!String(error).includes("net::ERR_ABORTED") || attempt === 2) {
        throw error;
      }
    }

    try {
      await expect(page).toHaveURL((url) => url.pathname === expectedPath);
      return;
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
    }
  }
}

function engineeringTeamCard(page: Page) {
  return page.locator("article").filter({
    has: page.getByRole("heading", { name: "Engineering" }),
  });
}

test.describe("Teams directory links", () => {
  test("preserve workspace slug for card issue and settings actions", async ({
    page,
  }) => {
    await gotoAndExpectPath(page, "/foreverbrowsing/teams");
    await expect(page).toHaveURL(/\/foreverbrowsing\/teams$/);
    await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();

    const teamCard = engineeringTeamCard(page);
    await expect(teamCard).toBeVisible();

    const viewIssues = teamCard.getByRole("link", { name: "View issues" });
    const settings = teamCard.getByRole("link", { name: "Settings" });

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

    await gotoAndExpectPath(page, "/teams", "/foreverbrowsing/teams");
    await expect(page).toHaveURL(/\/foreverbrowsing\/teams$/);

    const redirectedTeamCard = engineeringTeamCard(page);
    await expect(redirectedTeamCard).toBeVisible();
    await expect(
      redirectedTeamCard.getByRole("link", { name: "View issues" }),
    ).toHaveAttribute("href", "/foreverbrowsing/team/ENG/all");

    await redirectedTeamCard.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/settings\/teams\/ENG$/);
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
  });
});
