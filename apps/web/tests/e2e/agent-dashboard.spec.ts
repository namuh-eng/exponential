import { expect, test } from "@playwright/test";
import { expandAppSidebar } from "./sidebar-helpers";

test.describe("Agent dashboard", () => {
  test("opens from sidebar More, creates a workspace-aware run, and reviews suggestions", async ({
    page,
  }) => {
    const runTitle = `Audit agent sidebar route ${Date.now().toString(36)}`;

    await page.goto("/foreverbrowsing/my-issues/assigned");
    await expandAppSidebar(page);

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
    await page.getByLabel("Issue, project, or team context").fill("ENG-1");
    await page
      .getByLabel("Instructions")
      .fill(
        "Summarize workspace evidence and propose the required UI issue update.",
      );
    await page.getByRole("button", { name: "Start agent run" }).click();

    await expect(
      page.getByRole("button", { name: new RegExp(runTitle) }),
    ).toBeVisible();
    await expect(page.getByText("Workspace summary generated")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Suggestions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Run history" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open context" }).first(),
    ).toHaveAttribute("href", "/foreverbrowsing/team/ENG/issue/ENG-1");

    await page.getByRole("button", { name: "Accept" }).first().click();
    await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
  });
});
