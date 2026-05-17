import { expect, test } from "@playwright/test";

test.describe("Project updates settings routing", () => {
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

    await page.goto(`/${workspaceSlug}/settings/project-updates`);
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/settings/project-updates$`),
    );
    await expect(
      page.getByRole("heading", { name: "Project updates" }),
    ).toBeVisible();
    await expect(
      page.getByText("Manage how project updates are collected"),
    ).toBeVisible();
    await expect(page.getByText("No update configurations")).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/settings/project-updates");
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/settings/project-updates$`),
    );
    await expect(
      page.getByRole("heading", { name: "Project updates" }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto(`/${workspaceSlug}/settings/account/preferences`);
    const updatesLink = page.getByRole("link", {
      name: "Updates",
      exact: true,
    });
    await expect(updatesLink).toHaveAttribute(
      "href",
      `/${workspaceSlug}/settings/project-updates`,
    );
    await updatesLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/settings/project-updates$`),
    );
    await expect(
      page.getByRole("heading", { name: "Project updates" }),
    ).toBeVisible();
  });
});
