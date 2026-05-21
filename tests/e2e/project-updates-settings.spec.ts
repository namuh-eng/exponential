import { expect, test } from "@playwright/test";

test.describe("Project updates settings", () => {
  test("creates, edits, deletes, reloads, and routes project update configurations", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `project-updates-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Project Updates ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/project-updates`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/settings/project-updates$`),
    );
    await expect(
      page.getByRole("heading", { name: "Project updates" }),
    ).toBeVisible();
    await expect(page.getByText("No update configurations")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create update configuration" }),
    ).toBeEnabled();

    await page
      .getByRole("button", { name: "Create update configuration" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Create update configuration" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save configuration" }).click();
    await expect(
      page.getByText("Configuration name is required."),
    ).toBeVisible();

    const configurationName = `Friday update ${suffix}`;
    await page.getByLabel("Configuration name").fill(configurationName);
    await page.getByLabel("Reminder cadence").selectOption("weekly");
    await page.getByLabel("Due day").selectOption("5");
    await page.getByLabel("Due time").fill("15:30");
    await page.getByLabel("Timezone").fill("America/Los_Angeles");
    await page.getByLabel("Project scope").selectOption("statuses");
    await page.getByLabel("Planned").uncheck();
    await page.getByLabel("In progress").check();
    await page.getByLabel("Slack channel").check();
    await page.getByLabel("Slack channel name").fill("#project-updates");
    await page.getByRole("button", { name: "Save configuration" }).click();

    await expect(
      page.getByText("Project update configuration created."),
    ).toBeVisible();
    await expect(page.getByText(configurationName)).toBeVisible();
    await expect(
      page.getByText("Weekly on Friday at 15:30 America/Los_Angeles"),
    ).toBeVisible();
    await expect(page.getByText("#project-updates")).toBeVisible();

    await page.goto(`/${workspaceSlug}/settings/project-updates`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText(configurationName)).toBeVisible();

    const apiResponse = await page.request.get(
      "/api/project-update-configurations",
    );
    expect(apiResponse.status()).toBe(200);
    const apiPayload = await apiResponse.json();
    const saved = apiPayload.configurations.find(
      (configuration: { name: string }) =>
        configuration.name === configurationName,
    );
    expect(saved).toMatchObject({
      cadence: "weekly",
      projectScope: "statuses",
      shareTargets: ["workspace", "slack"],
      slackChannel: "#project-updates",
    });

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(
      page.getByRole("dialog", { name: "Edit update configuration" }),
    ).toBeVisible();
    await page.getByLabel("Enable update reminders").uncheck();
    await page.getByLabel("Reminder cadence").selectOption("monthly");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByText("Project update configuration updated."),
    ).toBeVisible();
    await expect(page.getByText("Disabled")).toBeVisible();
    await expect(page.getByText("Monthly on Friday at 15:30")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(
      page.getByText("Project update configuration deleted."),
    ).toBeVisible();
    await expect(page.getByText(configurationName)).toHaveCount(0);
    await expect(page.getByText("No update configurations")).toBeVisible();

    await page.goto("/settings/project-updates", {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/settings/project-updates$`),
    );
    await expect(
      page.getByRole("heading", { name: "Project updates" }),
    ).toBeVisible();

    await page.goto(`/${workspaceSlug}/settings/account/preferences`);
    const updatesLink = page.getByRole("link", {
      name: "Updates",
      exact: true,
    });
    await expect(updatesLink).toHaveAttribute(
      "href",
      `/${workspaceSlug}/settings/project-updates`,
    );
  });
});
