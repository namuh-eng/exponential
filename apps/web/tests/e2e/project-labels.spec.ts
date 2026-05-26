import { expect, test } from "@playwright/test";

test.describe("Project label settings", () => {
  test("manages labels, applies one during project creation, filters projects, and deletes with usage context", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `project-labels-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Project Labels ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/project-labels`);
    await expect(
      page.getByRole("heading", { name: "Project labels", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Search project labels")).toBeVisible();

    const labelName = `Roadmap ${suffix}`;
    await page.getByRole("button", { name: "Create label" }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(labelName);
    await page
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Projects visible from settings");
    await page.getByRole("button", { name: "Color #3b82f6" }).click();
    await page
      .getByRole("button", { name: "Create label", exact: true })
      .last()
      .click();
    await expect(page.getByText(labelName)).toBeVisible();

    await page.getByRole("button", { name: "Create label" }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(labelName);
    await page
      .getByRole("button", { name: "Create label", exact: true })
      .last()
      .click();
    await expect(
      page.getByText("A project label with this name already exists"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Create project label" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByLabel("Search project labels").fill(labelName);
    await expect(page.getByText(labelName)).toBeVisible();
    await page.getByLabel("Search project labels").fill("missing label");
    await expect(
      page.getByText("No project labels match your search."),
    ).toBeVisible();
    await page.getByLabel("Search project labels").fill("");

    await page.goto(`/${workspaceSlug}/projects`);
    await page.getByRole("button", { name: "Create project" }).click();
    await page
      .getByPlaceholder("Project name")
      .fill(`Labeled project ${suffix}`);
    await page
      .getByLabel("Apply project labels")
      .selectOption({ label: labelName });
    await page.getByRole("button", { name: "Create project" }).click();

    await expect(
      page
        .getByTestId("project-row")
        .filter({ hasText: `Labeled project ${suffix}` }),
    ).toBeVisible();
    await expect(
      page.getByTestId("project-row").filter({ hasText: labelName }),
    ).toBeVisible();
    await page
      .getByLabel("Filter projects by label")
      .selectOption({ label: labelName });
    await expect(page.getByTestId("project-row")).toHaveCount(1);
    await expect(page.getByTestId("project-row")).toContainText(labelName);

    await page.goto(`/${workspaceSlug}/settings/project-labels`);
    await expect(page.getByText("1 project", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Delete ${labelName}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Currently used by 1 project");
    await page.getByRole("button", { name: "Delete label" }).click();
    await expect(page.getByText(labelName)).toHaveCount(0);

    await page.goto(`/${workspaceSlug}/projects`);
    await expect(page.getByLabel("Filter projects by label")).not.toContainText(
      labelName,
    );
    await expect(page.getByTestId("project-row")).not.toContainText(labelName);
  });
});
