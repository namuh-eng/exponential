import { expect, test } from "@playwright/test";

test.describe("Agent dashboard", () => {
  test("opens from sidebar More, creates a mock run, and reviews suggestions", async ({
    page,
  }) => {
    const runTitle = `Audit agent sidebar route ${Date.now().toString(36)}`;

    await page.goto("/foreverbrowsing/my-issues/assigned");

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("link", { name: "Agent" }).click();

    await expect(page).toHaveURL(/\/foreverbrowsing\/agent$/);
    await expect(
      page.getByRole("heading", { name: "Agent workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Start an agent run" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Active and recent runs" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Agent settings" }),
    ).toHaveAttribute("href", "/foreverbrowsing/settings/account/agents");
    await expect(
      page.getByRole("link", { name: "Workspace AI settings" }),
    ).toHaveAttribute("href", "/foreverbrowsing/settings/ai");

    await page.getByLabel("Task title").fill(runTitle);
    await page.getByLabel("Issue, PR, or project context").fill("EXP-300");
    await page
      .getByLabel("Instructions")
      .fill("Create a mock agent run and summarize the required UI work.");
    await page.getByRole("button", { name: "Start mock agent run" }).click();

    await expect(
      page.getByRole("button", { name: new RegExp(runTitle) }),
    ).toBeVisible();
    await expect(page.getByText("Mock agent run queued")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Suggestions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Run history" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open context" }).first(),
    ).toHaveAttribute("href", "/foreverbrowsing/team/ENG/issue/EXP-300");

    await page.getByRole("button", { name: "Accept" }).first().click();
    await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
  });
});
