import { expect, test } from "@playwright/test";

test.describe("Team status workflow settings", () => {
  test("creates edits category/default behavior and exposes statuses downstream", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `status-workflow-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: { name: `Status Workflow ${suffix}`, urlSlug: workspaceSlug },
    });
    expect(workspaceResponse.status()).toBe(201);

    const teamKey = `SW${suffix.slice(-4).toUpperCase()}`;
    const teamResponse = await page.request.post("/api/teams", {
      data: { name: `Status Workflow ${suffix}`, key: teamKey },
    });
    expect(teamResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/teams/${teamKey}/statuses`);
    await expect(
      page.getByRole("heading", { name: "Issue statuses" }),
    ).toBeVisible();
    await expect(page.getByText("Default unstarted status:")).toBeVisible();

    const statusName = `Needs verification ${suffix}`;
    await page.getByLabel("Add status").nth(2).click();
    await page.getByLabel("Name").fill(statusName);
    await page.getByLabel("Description").fill("Ready for QA");
    await page
      .getByRole("combobox", { name: /^Workflow type/ })
      .selectOption("unstarted");
    await page.getByLabel("Terminal behavior").selectOption("standard");
    await page.getByLabel("SLA behavior").selectOption("pause");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Status created.")).toBeVisible();
    await expect(page.locator("span", { hasText: statusName })).toBeVisible();

    await page
      .getByTestId("status-item")
      .filter({ hasText: statusName })
      .getByRole("button", { name: "Edit" })
      .click();
    await page.getByLabel("Terminal behavior").selectOption("completed");
    await page.getByLabel("Auto-close/archive after days").fill("14");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Status updated.")).toBeVisible();

    const statusesResponse = await page.request.get(
      `/api/teams/${teamKey}/statuses`,
    );
    expect(statusesResponse.status()).toBe(200);
    const statusesPayload = await statusesResponse.json();
    const completed = statusesPayload.statuses.unstarted.find(
      (status: { name: string }) => status.name === statusName,
    );
    expect(completed).toEqual(
      expect.objectContaining({
        behavior: expect.objectContaining({
          terminalBehavior: "completed",
          autoArchiveDays: 14,
          slaBehavior: "pause",
        }),
      }),
    );

    const optionsResponse = await page.request.get(
      `/api/teams/${teamKey}/create-issue-options`,
    );
    expect(optionsResponse.status()).toBe(200);
    const optionsPayload = await optionsResponse.json();
    expect(
      optionsPayload.statuses.some(
        (status: {
          id: string;
          name: string;
          category: string;
          behavior?: { terminalBehavior?: string };
        }) =>
          status.id === completed.id &&
          status.name === statusName &&
          status.category === "unstarted" &&
          status.behavior?.terminalBehavior === "completed",
      ),
    ).toBe(true);
  });
});
