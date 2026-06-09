import { expect, test } from "@playwright/test";

test.describe("Team board actions", () => {
  test("creates an issue from a board column and opens a board card", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/team/ENG/board");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/board$/);
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();

    const addButton = page
      .getByRole("button", { name: /^Add issue to / })
      .first();
    await expect(addButton).toBeVisible();
    const addLabel = (await addButton.getAttribute("aria-label")) ?? "";
    const statusName = addLabel.replace(/^Add issue to /, "");
    expect(statusName).toBeTruthy();

    const column = addButton.locator("xpath=ancestor::*[@data-testid][1]");
    const issueTitle = `Board column create ${Date.now()}`;

    await addButton.click();
    const composer = page.getByTestId("create-issue-composer");
    await expect(composer).toBeVisible();
    await expect(page.getByRole("button", { name: "Status" })).toContainText(
      statusName,
    );

    await composer
      .getByRole("textbox", { name: "Issue title" })
      .fill(issueTitle);
    const submitButton = composer.getByRole("button", { name: "Create Issue" });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    await expect(composer).toBeHidden();
    await expect(column.getByText(issueTitle)).toBeVisible();

    const createdCard = page.getByRole("link", {
      name: new RegExp(issueTitle),
    });
    await expect(createdCard).toBeVisible();
    await createdCard.click();
    await expect(page).toHaveURL(
      /\/foreverbrowsing\/team\/ENG\/issue\/ENG-\d+$/,
    );
  });
});
