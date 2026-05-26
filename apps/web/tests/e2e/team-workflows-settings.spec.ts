import { expect, test } from "@playwright/test";

test.describe("Team workflows settings", () => {
  test("configures Git automation, auto-assignment, and transition rules", async ({
    page,
  }) => {
    let teamSettings = {
      name: "Engineering",
      detailedHistory: false,
      workflowStates: [
        { id: "state-backlog", name: "Backlog", category: "backlog" },
        { id: "state-ready", name: "Ready", category: "unstarted" },
        { id: "state-done", name: "Done", category: "completed" },
      ],
      workflowAutomation: {
        gitBranchFormat: "{teamKey}-{issueNumber}-{issueTitle}",
        gitBranchAutomationEnabled: false,
        gitPrAutomationEnabled: false,
        gitBranchCreateTargetStatusId: null,
        gitPrMergeTargetStatusId: null,
        autoAssignEnabled: false,
        autoAssignMode: "none",
        defaultAssigneeId: null,
        statusTransitionRules: [],
      },
    };
    const patchBodies: unknown[] = [];

    await page.route("**/api/teams/ENG/settings", async (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        patchBodies.push(body);
        teamSettings = {
          ...teamSettings,
          ...body,
          workflowAutomation:
            body.workflowAutomation ?? teamSettings.workflowAutomation,
        };
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ team: teamSettings }),
        });
        return;
      }

      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ team: teamSettings }),
      });
    });

    await page.goto("/foreverbrowsing/settings/teams/ENG/workflows");

    await expect(
      page.getByRole("heading", { name: "Workflows & automations" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Git workflows" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Auto-assignment" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Status transition rules" }),
    ).toBeVisible();
    await expect(page.getByText("Back to team settings")).toHaveAttribute(
      "href",
      "/foreverbrowsing/settings/teams/ENG",
    );

    await page.getByLabel("Branch name format").fill("ENG-{issueNumber}");
    await page.getByLabel("Move issue when branch is created").click();
    await page
      .getByLabel("Branch creation target status")
      .selectOption("state-ready");
    await page.getByLabel("Enable auto-assignment").click();
    await page.getByLabel("Assignment mode").selectOption("round_robin");

    await page.getByText("Add transition rule").click();
    await page.getByLabel("Rule 1 name").fill("Complete merged PRs");
    await page.getByLabel("Rule 1 trigger").selectOption("pull_request_merged");
    await page.getByLabel("Rule 1 target status").selectOption("state-done");
    await page.getByText("Save automation settings").click();

    await expect(page.getByText("Workflow automation updated")).toBeVisible();
    await expect
      .poll(() => patchBodies)
      .toContainEqual({
        workflowAutomation: expect.objectContaining({
          gitBranchFormat: "ENG-{issueNumber}",
          gitBranchAutomationEnabled: true,
          gitBranchCreateTargetStatusId: "state-ready",
          autoAssignEnabled: true,
          autoAssignMode: "round_robin",
          statusTransitionRules: [
            expect.objectContaining({
              name: "Complete merged PRs",
              trigger: "pull_request_merged",
              targetStatusId: "state-done",
            }),
          ],
        }),
      });

    await page.getByText("Delete").click();
    await page.getByText("Save automation settings").click();
    await expect
      .poll(() => patchBodies)
      .toContainEqual({
        workflowAutomation: expect.objectContaining({
          statusTransitionRules: [],
        }),
      });
  });
});
