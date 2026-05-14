import { expect, test } from "@playwright/test";

test.describe("settings empty-state CTAs", () => {
  test("show useful behavior instead of console no-ops", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `settings-ctas-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Settings CTAs ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/integrations`);
    await page.getByRole("button", { name: "Explore integrations" }).click();
    await expect(
      page.getByRole("dialog", { name: "Explore integrations" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "GitHub" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Slack" })).toBeVisible();

    await page.goto(`/${workspaceSlug}/settings/asks`);
    await expect(
      page.getByRole("button", { name: "Enable Asks" }),
    ).toBeDisabled();
    await expect(
      page.getByText("Asks setup is not available in this workspace yet."),
    ).toBeVisible();

    await page.goto(`/${workspaceSlug}/settings/emojis`);
    await expect(
      page.getByRole("button", { name: "Upload emoji" }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        "Custom emoji uploads are not available in this workspace yet.",
      ),
    ).toBeVisible();

    await page.goto(`/${workspaceSlug}/settings/applications`);
    const exploreLink = page.getByRole("link", {
      name: "Explore integrations",
    });
    await expect(exploreLink).toHaveAttribute(
      "href",
      `/${workspaceSlug}/settings/integrations`,
    );
    await exploreLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/settings/integrations$`),
    );
  });
});
