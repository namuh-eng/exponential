import { expect, test } from "@playwright/test";

test.describe("Issue templates", () => {
  test("creates an issue template from settings and persists it after refresh", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Issue Template QA ${suffix}`,
        urlSlug: `issue-template-qa-${suffix}`,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto("/settings/issue-templates");

    await page.getByRole("button", { name: "Create template" }).click();
    await expect(
      page.getByRole("dialog", { name: "Create issue template" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template name is required.")).toBeVisible();

    const templateName = `Bug report ${suffix}`;
    await page.getByLabel("Template name").fill(templateName);
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(
      page.getByText("Issue description is required."),
    ).toBeVisible();

    await page
      .getByLabel("Issue description")
      .fill("Steps to reproduce\nExpected result\nActual result");
    await page.getByRole("button", { name: "Save template" }).click();

    await expect(page.getByText(templateName)).toBeVisible();
    await expect(page.getByText(/Steps to reproduce/)).toBeVisible();
    await expect(page.getByText("No templates")).not.toBeVisible();

    await page.reload();
    await expect(page.getByText(templateName)).toBeVisible();
    await expect(page.getByText(/Steps to reproduce/)).toBeVisible();
  });
});
