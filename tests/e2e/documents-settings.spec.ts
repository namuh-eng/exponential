import { expect, test } from "@playwright/test";

test.describe("documents settings", () => {
  test("saves workspace defaults and creates templates", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `documents-settings-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Documents Settings ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/documents`);
    await expect(
      page.getByRole("heading", { name: "Documents" }),
    ).toBeVisible();
    await expect(page.getByLabel("Default document visibility")).toHaveValue(
      "workspace",
    );

    await page
      .getByLabel("Default document visibility")
      .selectOption("private");
    await expect(page.getByRole("status")).toContainText(
      "Document settings saved.",
    );

    await page.getByLabel("Template name").fill("Incident review");
    await page
      .getByLabel("Template description")
      .fill("Capture timeline, impact, and follow-ups");
    await page
      .getByRole("button", { name: "Create document template" })
      .click();

    await expect(page.getByText("Incident review")).toBeVisible();
    await expect(
      page.getByText("Capture timeline, impact, and follow-ups"),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Default document visibility")).toHaveValue(
      "private",
    );
    await expect(page.getByText("Incident review")).toBeVisible();
  });
});
