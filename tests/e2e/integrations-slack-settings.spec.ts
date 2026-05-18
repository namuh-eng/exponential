import { expect, test } from "@playwright/test";

test.describe("integrations and team Slack settings", () => {
  test("connects Slack and saves team notification rules", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `integrations-${suffix}`;
    const response = await page.request.post("/api/workspaces", {
      data: { name: `Integrations ${suffix}`, urlSlug: workspaceSlug },
    });
    expect(response.status()).toBe(201);
    const data = await response.json();
    const teamKey = data.team.key;

    await page.goto(`/${workspaceSlug}/settings/integrations`);
    await expect(
      page.getByRole("heading", { name: "Integrations" }),
    ).toBeVisible();
    await expect(
      page.getByText("Setup unavailable in this workspace"),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Connect" }).first().click();
    await expect(page.getByText("Integration connected.")).toBeVisible();
    await page
      .getByText("Slack")
      .locator("xpath=ancestor::article")
      .getByRole("button", { name: "Connect" })
      .click();
    await expect(page.getByText("Integration connected.")).toBeVisible();

    await page.goto(
      `/${workspaceSlug}/settings/teams/${teamKey}/slack-notifications`,
    );
    await expect(
      page.getByRole("heading", { name: "Slack notifications" }),
    ).toBeVisible();
    await page.getByLabel("Slack channel").selectOption("#eng");
    await page.getByLabel("New issues").uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByText("Slack notification settings saved."),
    ).toBeVisible();

    const api = await page.request.get(
      `/api/teams/${teamKey}/slack-notifications`,
    );
    expect(api.status()).toBe(200);
    const saved = await api.json();
    expect(saved.settings.channelName).toBe("#eng");
    expect(saved.settings.events.issueCreated).toBe(false);
  });
});
