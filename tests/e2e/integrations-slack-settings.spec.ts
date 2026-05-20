import { expect, test } from "@playwright/test";

test.describe("Integrations and team Slack notifications", () => {
  test("connects local Slack, saves team broadcasts, and keeps applications manageable", async ({
    page,
  }) => {
    await page.request.delete("/api/integrations/slack");

    await page.goto("/settings/integrations");
    await expect(
      page.getByRole("heading", { name: "Integrations", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Explore integrations" }).click();
    await expect(
      page.getByText("Connect and manage supported workspace integrations."),
    ).toBeVisible();
    await expect(page.getByText(/Setup unavailable/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(
      page.getByText("Slack OAuth credentials are not configured", {
        exact: false,
      }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "Explore integrations" })
      .getByRole("button", { name: "Create local Slack connection" })
      .click();
    await expect(
      page.getByText("Slack integration connected for this workspace."),
    ).toBeVisible();
    await expect(
      page.getByText("Connected to Local Slack workspace"),
    ).toBeVisible();

    await page.goto("/settings/teams/ENG/slack-notifications");
    await expect(page.getByText("Workspace Slack connected")).toBeVisible();
    await page.getByLabel("Enabled").check();
    await page.getByLabel("Slack channel").selectOption("CTRIAGE");
    await page.getByLabel(/New comments/).check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByText("Slack notification settings saved."),
    ).toBeVisible();
    await expect(page.getByLabel("Slack channel")).toHaveValue("CTRIAGE");

    await page.goto("/settings/applications");
    await expect(
      page.getByRole("heading", { name: "Applications", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Explore integrations" }),
    ).toBeVisible();
  });
});
