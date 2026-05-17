import { expect, test } from "@playwright/test";

test.describe("Project status settings", () => {
  test("edits, reorders, saves, and persists workspace project statuses", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `project-statuses-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Project Statuses ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/project-statuses`);
    await expect(
      page.getByRole("heading", { name: "Project statuses" }),
    ).toBeVisible();
    await expect(page.getByText("Project statuses are read-only")).toHaveCount(
      0,
    );

    const customName = `Blocked ${suffix}`;
    await page.getByRole("button", { name: "New status" }).click();
    await page.locator('input[value="New status"]').fill(customName);
    await page
      .locator('input[value="Describe when projects should use this status."]')
      .fill("Waiting on another team");
    await page.locator('input[value="#6b6f76"]').last().fill("#8844ff");
    await page.getByRole("button", { name: "Up" }).last().click();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Project statuses saved.")).toBeVisible();
    await expect(page.locator(`input[value="${customName}"]`)).toBeVisible();
    await expect(
      page.locator('input[value="Waiting on another team"]'),
    ).toBeVisible();

    await page.reload();
    await expect(page.locator(`input[value="${customName}"]`)).toBeVisible();
    await expect(
      page.locator('input[value="Waiting on another team"]'),
    ).toBeVisible();

    const apiResponse = await page.request.get("/api/project-statuses");
    expect(apiResponse.status()).toBe(200);
    const payload = await apiResponse.json();
    expect(payload.customStatusesSupported).toBe(true);
    expect(payload.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: customName,
          description: "Waiting on another team",
        }),
      ]),
    );
  });
});
