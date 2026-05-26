import { expect, test } from "@playwright/test";

test.describe("Project templates", () => {
  test("creates, edits, duplicates, applies, and deletes project templates", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `template-qa-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Template QA ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/project-templates`, {
      waitUntil: "domcontentloaded",
    });

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
    await page.getByLabel("Default status").selectOption("started");
    await page.getByLabel("Default priority").selectOption("high");
    await page.getByLabel("Template milestones").fill("Plan\nBuild");
    await page.getByRole("button", { name: "Save template" }).click();

    await expect(page.getByText(templateName)).toBeVisible();
    await expect(
      page.getByText("Status: started · Priority: high · 2 milestones"),
    ).toBeVisible();
    await expect(page.getByText("No project templates")).not.toBeVisible();

    await page.goto(`/${workspaceSlug}/settings/project-templates`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText(templateName)).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    await expect(
      page.getByRole("dialog", { name: "Edit project template" }),
    ).toBeVisible();
    await page.getByLabel("Template milestones").fill("Plan\nBuild\nShip");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Project template updated.")).toBeVisible();
    await expect(page.getByText("3 milestones")).toBeVisible();

    await page.getByRole("button", { name: "Duplicate" }).click();
    await expect(page.getByText("Project template duplicated.")).toBeVisible();
    await expect(page.getByText(`${templateName} copy`)).toBeVisible();

    const projectName = `Project from template ${suffix}`;
    await page.goto(`/${workspaceSlug}/projects/all`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", { name: /New project|Create project/ })
      .click();
    await page.getByPlaceholder("Project name").fill(projectName);
    await page
      .getByLabel("Apply project template")
      .selectOption({ label: templateName });
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText(projectName)).toBeVisible();
    const createdProjectRow = page
      .getByTestId("project-row")
      .filter({ hasText: projectName });
    await expect(createdProjectRow.getByLabel("High")).toBeVisible();

    const templatesResponse = await page.request.get("/api/project-templates");
    expect(templatesResponse.status()).toBe(200);
    const templatesPayload = await templatesResponse.json();
    const template = templatesPayload.templates.find(
      (candidate: { name: string }) => candidate.name === templateName,
    );
    expect(template.settings).toMatchObject({
      status: "started",
      priority: "high",
      milestones: ["Plan", "Build", "Ship"],
    });

    const projectResponse = await page.request.post("/api/projects", {
      data: {
        name: `API project from template ${suffix}`,
        templateId: template.id,
      },
    });
    expect(projectResponse.status()).toBe(201);
    const projectPayload = await projectResponse.json();
    expect(projectPayload.appliedTemplateId).toBe(template.id);
    expect(projectPayload.appliedMilestones).toEqual(["Plan", "Build", "Ship"]);
    expect(projectPayload.status).toBe("started");
    expect(projectPayload.priority).toBe("high");

    await page.goto(`/${workspaceSlug}/settings/project-templates`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator("article", { hasText: `${templateName} copy` })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByText("Project template deleted.")).toBeVisible();
    await expect(page.getByText(`${templateName} copy`)).toHaveCount(0);
  });
});
