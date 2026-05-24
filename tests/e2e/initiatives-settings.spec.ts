import { expect, test } from "@playwright/test";

test.describe("Initiatives settings", () => {
  test("opens from the settings sidebar and supports direct navigation", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `initiatives-settings-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Initiatives Settings ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings`);
    await page.getByRole("link", { name: "Initiatives", exact: true }).click();

    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/settings/initiatives$`),
    );
    await expect(
      page.getByRole("heading", { name: "Initiatives", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Feature settings")).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
    await expect(page.getByLabel("Workspace initiatives")).toBeChecked();
    await expect(page.getByLabel("Project rollups")).toBeChecked();

    await page.getByLabel("Workspace initiatives").uncheck();
    await expect(page.getByText("Initiative settings saved")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Workspace initiatives")).not.toBeChecked();
    const settingsResponse = await page.request.get(
      "/api/workspaces/current/initiatives-settings",
    );
    expect(settingsResponse.status()).toBe(200);
    await expect(settingsResponse.json()).resolves.toMatchObject({
      initiativesSettings: { enabled: false, projectRollups: true },
      canManage: true,
    });

    await page.goto(`/${workspaceSlug}/initiatives`);
    await expect(
      page.getByRole("button", { name: /Initiatives disabled/ }),
    ).toBeDisabled();

    await page.goto("/settings/initiatives");
    await expect(
      page.getByRole("heading", { name: "Initiatives", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
  });
});
