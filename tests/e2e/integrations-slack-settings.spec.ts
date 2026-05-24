import { expect, test } from "@playwright/test";
import { createIsolatedTestSession } from "./test-session";

test.describe("Integrations and Slack notification settings", () => {
  test("exercises catalog setup state, team Slack save path, and application revoke", async ({
    page,
  }) => {
    await createIsolatedTestSession(page, "integrations");
    const suffix = Date.now().toString(36);
    const workspaceSlug = `integrations-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: { name: `Integrations ${suffix}`, urlSlug: workspaceSlug },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspace = await workspaceResponse.json();
    const teamKey = workspace.team.key;

    await page.goto(`/${workspaceSlug}/settings/integrations`);
    await page.getByRole("button", { name: "Explore integrations" }).click();
    await expect(
      page.getByRole("dialog", { name: "Explore integrations" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Slack" })).toBeVisible();
    await expect(
      page.getByText("Setup unavailable in this workspace"),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(
      page.getByText(/Slack OAuth|AUTH_SLACK/).first(),
    ).toBeVisible();

    await page.goto(
      `/${workspaceSlug}/settings/teams/${teamKey}/slack-notifications`,
    );
    await expect(page.getByText("Slack is not connected")).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Connect Slack" }).click();
    await expect(
      page.getByText(/Slack OAuth|AUTH_SLACK/).first(),
    ).toBeVisible();

    const slackResponse = await page.request.post(
      "/api/test/slack-integration",
      {
        headers: { "x-workspace-slug": workspaceSlug },
      },
    );
    expect(slackResponse.status()).toBe(200);

    await page.reload();
    await expect(page.getByText(/Workspace Slack connected/)).toBeVisible();
    await page.getByLabel("Slack channel").fill("#eng-alerts");
    await page.getByLabel(/Cycle updates/).check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByText("Slack notification settings saved."),
    ).toBeVisible();
    await expect(page.getByLabel("Slack channel")).toHaveValue("#eng-alerts");

    const grantResponse = await page.request.post(
      "/api/test/authorized-application",
      {
        data: { name: "Integrations E2E App", scopes: ["read"] },
      },
    );
    expect(grantResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/applications`);
    await expect(
      page.getByRole("heading", { name: "Integrations E2E App", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("button", { name: "Confirm revoke" }).click();
    await expect(page.getByText("Application access revoked.")).toBeVisible();
    await expect(page.getByText("No applications")).toBeVisible();
  });
});
