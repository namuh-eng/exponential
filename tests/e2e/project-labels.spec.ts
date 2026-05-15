import { expect, test } from "@playwright/test";

test.describe("Project label settings", () => {
  test("creates, cancels deletion, deletes, and persists removal", async ({
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

    const labelName = `Roadmap ${suffix}`;
    await page.getByRole("button", { name: "Create label" }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(labelName);
    await page
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Delete me from settings");
    await page.getByRole("button", { name: "Color #3b82f6" }).click();
    await page
      .getByRole("button", { name: "Create label", exact: true })
      .last()
      .click();
    await expect(page.getByText(labelName)).toBeVisible();

    await page.getByRole("button", { name: `Delete ${labelName}` }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText(
      `Delete the project label "${labelName}"?`,
    );
    await expect(dialog).toContainText("remove it from all projects");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(labelName)).toBeVisible();

    await page.getByRole("button", { name: `Delete ${labelName}` }).click();
    await page.getByRole("button", { name: "Delete label" }).click();
    await expect(page.getByText(labelName)).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(labelName)).toHaveCount(0);

    const labelsResponse = await page.request.get("/api/project-labels");
    expect(labelsResponse.status()).toBe(200);
    const payload = await labelsResponse.json();
    expect(payload.labels).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: labelName })]),
    );
  });
});
