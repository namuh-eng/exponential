import { expect, test } from "@playwright/test";

test.describe("Team issue status workflow settings", () => {
  test("manages category defaults behavior metadata and downstream consumers", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `team-statuses-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: { name: `Team Statuses ${suffix}`, urlSlug: workspaceSlug },
    });
    expect(workspaceResponse.status()).toBe(201);

    const teamKey = `TS${suffix.slice(-4).toUpperCase()}`;
    const teamResponse = await page.request.post("/api/teams", {
      data: { name: `Team Statuses ${suffix}`, key: teamKey },
    });
    expect(teamResponse.status()).toBe(201);
    const teamPayload = await teamResponse.json();
    const teamId = teamPayload.team.id as string;

    await page.goto(`/${workspaceSlug}/settings/teams/${teamKey}/statuses`);
    await expect(
      page.getByRole("heading", { name: "Issue statuses" }),
    ).toBeVisible();
    await expect(page.getByText("Defaults per workflow type")).toBeVisible();
    await expect(page.getByText("Terminal semantics")).toBeVisible();

    const statusName = `Needs verification ${suffix}`;
    await page.getByRole("button", { name: "Add status" }).nth(4).click();
    await page.getByRole("textbox", { name: "Name" }).fill(statusName);
    await page
      .getByRole("textbox", { name: "Description" })
      .fill("QA must verify this issue before closing it");
    await expect(page.getByLabel("Workflow type")).toHaveValue("completed");
    await page.getByLabel("SLA behavior").selectOption("pauses");
    await page.getByLabel("Auto-close/archive issues in this status").check();
    await page.getByLabel("Auto-close after days").fill("7");
    await page.getByLabel("Available to workflow automations").check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Status created.")).toBeVisible();
    await expect(
      page.locator("span", { hasText: statusName }).first(),
    ).toBeVisible();

    let statusesResponse = await page.request.get(
      `/api/teams/${teamKey}/statuses`,
    );
    expect(statusesResponse.status()).toBe(200);
    let statusesPayload = await statusesResponse.json();
    const created = statusesPayload.statuses.completed.find(
      (status: { name: string }) => status.name === statusName,
    );
    expect(created).toEqual(
      expect.objectContaining({
        behavior: expect.objectContaining({
          slaBehavior: "pauses",
          autoCloseEnabled: true,
          autoCloseDays: 7,
        }),
      }),
    );

    await page.getByLabel("Default Completed status").selectOption(created.id);
    await expect(page.getByText("Default status saved.")).toBeVisible();
    await expect(page.getByLabel("Default Completed status")).toHaveValue(
      created.id,
    );

    await page
      .getByTestId("status-item")
      .filter({ hasText: statusName })
      .getByRole("button", { name: "Edit" })
      .click();
    await expect(page.getByLabel("Workflow type")).toHaveValue("completed");
    await expect(page.getByLabel("Terminal behavior")).toHaveValue("completed");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    statusesResponse = await page.request.get(`/api/teams/${teamKey}/statuses`);
    statusesPayload = await statusesResponse.json();
    expect(statusesPayload.statuses.completed).toContainEqual(
      expect.objectContaining({
        id: created.id,
        isDefault: true,
        behavior: expect.objectContaining({ terminalBehavior: "completed" }),
      }),
    );

    await page.getByLabel("Duplicate issue status").selectOption(created.id);
    await expect(page.getByText("Duplicate issue status saved.")).toBeVisible();

    const optionsResponse = await page.request.get(
      `/api/teams/${teamKey}/create-issue-options`,
    );
    expect(optionsResponse.status()).toBe(200);
    const optionsPayload = await optionsResponse.json();
    expect(optionsPayload.statuses).toContainEqual(
      expect.objectContaining({ id: created.id, category: "completed" }),
    );

    const issueResponse = await page.request.post("/api/issues", {
      data: {
        title: `Status consumer ${suffix}`,
        teamId,
        stateId: created.id,
      },
    });
    expect(issueResponse.status()).toBe(201);
    const issuePayload = await issueResponse.json();

    await page.goto(`/${workspaceSlug}/team/${teamKey}/board`);
    await expect(
      page.locator("span", { hasText: statusName }).first(),
    ).toBeVisible();
    await expect(page.getByText(issuePayload.title).first()).toBeVisible();
  });
});
