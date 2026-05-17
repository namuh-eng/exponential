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
    await page.getByRole("link", { name: "Initiatives" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/settings/initiatives$`),
    );
    await expect(
      page.getByRole("heading", { name: "Initiatives" }),
    ).toBeVisible();
    await expect(page.getByText("Feature settings")).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/settings/initiatives");
    await expect(
      page.getByRole("heading", { name: "Initiatives" }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
  });
});
