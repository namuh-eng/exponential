import { expect, test } from "@playwright/test";

async function deleteExistingProjectUpdateConfigurations(
  page: import("@playwright/test").Page,
) {
  const response = await page.request.get("/api/project-updates", {
    headers: {
      referer: "http://localhost:7015/foreverbrowsing/settings/project-updates",
    },
  });
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    configurations?: Array<{ id: string }>;
  };

  for (const configuration of payload.configurations ?? []) {
    const deleteResponse = await page.request.delete(
      `/api/project-updates/${configuration.id}`,
      {
        headers: {
          referer:
            "http://localhost:7015/foreverbrowsing/settings/project-updates",
        },
      },
    );
    expect(deleteResponse.status()).toBe(200);
  }
}

test.describe("Project updates settings", () => {
  test("renders via direct and workspace-prefixed navigation", async ({
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

    await page.goto("/settings/project-updates", {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/settings/project-updates$`),
    );
    await expect(
      page.getByRole("heading", { name: "Project updates" }),
    ).toBeVisible();
  });

  test("creates, reloads, edits, disables, validates, and deletes foreverbrowsing settings", async ({
    page,
  }) => {
    await deleteExistingProjectUpdateConfigurations(page);

    await page.goto("/foreverbrowsing/settings/project-updates");
    await expect(page).toHaveURL(
      /\/foreverbrowsing\/settings\/project-updates$/,
    );
    await expect(page.getByText("No update configurations")).toBeVisible();

    await page
      .getByRole("button", { name: "Create update configuration" })
      .click();
    await page.getByLabel("Name").fill("Weekly roadmap report");
    await page.getByLabel("Timezone").fill("UTC");
    await page.getByLabel("Reporting destination").selectOption("slack");
    await page.getByLabel("Share target").fill("#project-updates");
    await page.getByRole("button", { name: "Create configuration" }).click();

    await expect(page.getByText("Weekly roadmap report")).toBeVisible();
    await expect(page.getByText("#project-updates")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Weekly roadmap report")).toBeVisible();
    await expect(page.getByText("#project-updates")).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Name").fill("Biweekly roadmap report");
    await page.getByLabel("Cadence").selectOption("biweekly");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Biweekly roadmap report")).toBeVisible();
    await expect(page.getByText(/Every two weeks/)).toBeVisible();

    await page.getByRole("button", { name: "Disable" }).click();
    await expect(page.getByText("Disabled", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Disabled", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Create configuration" }).click();
    await page.getByLabel("Name").fill("Invalid timezone report");
    await page.getByLabel("Timezone").fill("Bad Zone!");
    await page
      .locator("form")
      .getByRole("button", { name: "Create configuration" })
      .click();
    await expect(page.getByText("Timezone is invalid")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No update configurations")).toBeVisible();
  });
});
