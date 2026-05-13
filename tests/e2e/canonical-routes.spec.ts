import { expect, test } from "@playwright/test";

async function expectRenderedAppPage(page: import("@playwright/test").Page) {
  await expect(
    page.getByText("This page could not be found"),
  ).not.toBeVisible();
}

test.describe("Canonical Forever Browsing routes", () => {
  test("renders canonical workspace/team deep links and redirects legacy ENG route", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/inbox");
    await expect(page).toHaveURL(/\/foreverbrowsing\/inbox$/);
    await expect(page.getByText("Inbox").first()).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/foreverbrowsing/team/ENG/all");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/all$/);
    await expect(
      page.getByText(
        "The team ENG doesn't exist or you don't have access to it.",
      ),
    ).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All issues" }),
    ).toBeVisible();
    await expect(
      page.locator('a[href="/foreverbrowsing/team/ENG/all"]').first(),
    ).toHaveAttribute("href", "/foreverbrowsing/team/ENG/all");

    await page.goto("/foreverbrowsing/team/ENG/board");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/board$/);
    await expect(
      page.getByText(
        "The team ENG doesn't exist or you don't have access to it.",
      ),
    ).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(page.getByText("Backlog").first()).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/foreverbrowsing/team/ENG/cycles");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/cycles$/);
    await expect(
      page.getByText(
        "The team ENG doesn't exist or you don't have access to it.",
      ),
    ).not.toBeVisible();
    await expect(page.getByText("Cycles").first()).toBeVisible();

    await page.goto("/team/ENG/all");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/all$/);
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All issues" }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/team/ENG/board");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/board$/);
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(page.getByText("Backlog").first()).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/foreverbrowsing/inbox");
    await page
      .getByRole("link", { name: /Issues icon Issues/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/all$/);
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.getByLabel("Search").click();
    await page.getByPlaceholder("Type a command or search...").fill("board");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/board$/);
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
  });

  test("issue detail canonical routes render and Back to issues lands on workspace team all", async ({
    page,
  }) => {
    await page.goto("/team/ENG/issue/ENG-1");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/issue\/ENG-1$/);
    await expect(page.getByText("ENG-1").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to issues" }),
    ).toBeVisible();
    await expectRenderedAppPage(page);

    await page.getByRole("link", { name: "Back to issues" }).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/all$/);
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All issues" }),
    ).toBeVisible();
    await expectRenderedAppPage(page);

    await page.goto("/issue/ENG-1");
    await expect(page).toHaveURL(/\/foreverbrowsing\/issue\/ENG-1$/);
    await expect(page.getByText("ENG-1").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to issues" }),
    ).toBeVisible();
    await expectRenderedAppPage(page);
  });
});
