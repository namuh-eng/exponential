import { expect, test } from "@playwright/test";
import { createIsolatedTestSession } from "./test-session";

test.describe("Google Sheets analytics sync", () => {
  test("admin creates, refreshes, and disconnects the workspace analytics sheet", async ({
    page,
  }) => {
    await createIsolatedTestSession(page, "google-sheets-sync");
    const suffix = Date.now().toString(36);
    const workspaceSlug = `sheets-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: { name: `Sheets ${suffix}`, urlSlug: workspaceSlug },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/integrations`);
    await page.getByRole("button", { name: "Explore integrations" }).click();
    await expect(
      page.getByRole("heading", { name: "Google Sheets" }),
    ).toBeVisible();
    await expect(page.getByLabel("Include private teams")).not.toBeChecked();
    await page.getByRole("button", { name: "Create sheet" }).click();

    await expect(
      page.getByText("Google Sheets analytics sync created."),
    ).toBeVisible();
    await expect(page.getByText("Open analytics sheet")).toBeVisible();
    await expect(page.getByText(/Last refresh/)).toBeVisible();

    await page.getByRole("button", { name: "Refresh now" }).click();
    await expect(
      page.getByText("Google Sheets analytics sync refreshed."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByText("Integration disconnected.")).toBeVisible();
    await expect(page.getByText("No active integrations")).toBeVisible();
  });
});
