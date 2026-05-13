import { expect, test } from "@playwright/test";

test.describe("Project templates", () => {
  test("creates a project template from settings and persists it after refresh", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Template QA ${suffix}`,
        urlSlug: `template-qa-${suffix}`,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto("/settings/project-templates");

    await page.getByRole("button", { name: "Create project template" }).click();
    await expect(
      page.getByRole("dialog", { name: "Create project template" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template name is required.")).toBeVisible();

    const templateName = `Launch checklist ${suffix}`;
    await page.getByLabel("Template name").fill(templateName);
    await page
      .getByLabel("Description")
      .fill("Milestones and starter issues for launches");
    await page.getByRole("button", { name: "Save template" }).click();

    await expect(page.getByText(templateName)).toBeVisible();
    await expect(
      page.getByText("Milestones and starter issues for launches"),
    ).toBeVisible();
    await expect(page.getByText("No project templates")).not.toBeVisible();

    await page.reload();
    await expect(page.getByText(templateName)).toBeVisible();
    await expect(
      page.getByText("Milestones and starter issues for launches"),
    ).toBeVisible();
  });
});
