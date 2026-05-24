import { expect, test } from "@playwright/test";

test.describe("Documents settings", () => {
  test("creates, edits, reloads, and deletes templates and folders", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `documents-qa-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Documents QA ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/documents`);
    await expect(
      page.getByRole("heading", { name: "Documents" }),
    ).toBeVisible();
    await expect(page.getByText("No document templates")).toBeVisible();
    await expect(page.getByText("No common folders")).toBeVisible();
    await expect(page.getByLabel("Default document visibility")).toHaveValue(
      "workspace",
    );

    await page
      .getByLabel("Default document visibility")
      .selectOption("private");
    await expect(page.getByText("Document settings saved.")).toBeVisible();

    const templateName = `Release notes ${suffix}`;
    await page.getByRole("button", { name: "New template" }).first().click();
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template name is required.")).toBeVisible();
    await page.getByLabel("Template name").fill(templateName);
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template content is required.")).toBeVisible();
    await page.getByLabel("Description").fill("Release communication template");
    await page.getByLabel("Template content").fill("Summary\nImpact\nRollout");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText(templateName)).toBeVisible();
    await expect(page.getByText(/Summary/)).toBeVisible();

    const folderName = `Runbooks ${suffix}`;
    await page.getByRole("button", { name: "New folder" }).first().click();
    await page.getByRole("button", { name: "Save folder" }).click();
    await expect(page.getByText("Folder name is required.")).toBeVisible();
    await page.getByLabel("Folder name").fill(folderName);
    await page.getByLabel("Description").fill("Operational documents");
    await page.getByLabel("Folder color").selectOption("green");
    await page.getByRole("button", { name: "Save folder" }).click();
    await expect(page.getByText(folderName)).toBeVisible();
    await expect(page.getByText("green folder")).toBeVisible();

    const editedTemplate = `Release notes edited ${suffix}`;
    await page
      .getByRole("region", { name: "Document templates" })
      .getByRole("button", { name: "Edit" })
      .click();
    await page.getByLabel("Template name").fill(editedTemplate);
    await page.getByLabel("Template content").fill("Summary\nDecision\nOwner");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText(editedTemplate)).toBeVisible();
    await expect(page.getByText(/Decision/)).toBeVisible();

    const editedFolder = `Team runbooks ${suffix}`;
    await page
      .getByRole("region", { name: "Common folders" })
      .getByRole("button", { name: "Edit" })
      .click();
    await page.getByLabel("Folder name").fill(editedFolder);
    await page.getByLabel("Folder color").selectOption("purple");
    await page.getByRole("button", { name: "Save folder" }).click();
    await expect(page.getByText(editedFolder)).toBeVisible();
    await expect(page.getByText("purple folder")).toBeVisible();

    await page.reload();
    await expect(page.getByText(editedTemplate)).toBeVisible();
    await expect(page.getByText(editedFolder)).toBeVisible();
    await expect(page.getByLabel("Default document visibility")).toHaveValue(
      "private",
    );

    const apiResponse = await page.request.get("/api/document-settings", {
      headers: {
        referer: `http://localhost:3015/${workspaceSlug}/settings/documents`,
      },
    });
    expect(apiResponse.status()).toBe(200);
    const apiPayload = await apiResponse.json();
    expect(apiPayload.documents.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: editedTemplate }),
      ]),
    );
    expect(apiPayload.documents.folders).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: editedFolder })]),
    );

    await page
      .getByRole("region", { name: "Document templates" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByText(editedTemplate)).toHaveCount(0);
    await page
      .getByRole("region", { name: "Common folders" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByText(editedFolder)).toHaveCount(0);
  });
});
