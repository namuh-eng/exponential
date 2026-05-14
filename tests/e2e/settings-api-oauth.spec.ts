import { expect, test } from "@playwright/test";

test.describe("Settings API OAuth applications", () => {
  test("validates redirect URLs in the new OAuth application modal", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `oauth-settings-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `OAuth Settings ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/api`);
    await expect(
      page.getByRole("heading", { name: "API", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "New OAuth application" }).click();
    await expect(
      page.getByRole("dialog", { name: "New OAuth application" }),
    ).toBeVisible();

    const redirectInput = page.getByLabel("Redirect URL");
    await expect(redirectInput).toHaveValue("");
    await expect(redirectInput).toHaveAttribute(
      "placeholder",
      "https://example.com/oauth/callback",
    );

    await page.getByLabel("Application name").fill(`Name only ${suffix}`);
    await page
      .getByRole("button", { name: "Create OAuth application" })
      .click();
    await expect(page.getByText("Redirect URL is required.")).toBeVisible();
    await expect(page.getByText("OAuth application created.")).toHaveCount(0);

    await redirectInput.fill("https://localhost:3015/oauth/callback");
    await page
      .getByRole("button", { name: "Create OAuth application" })
      .click();
    await expect(
      page.getByText(
        "Redirect URL must not use localhost, loopback, private, or link-local hosts.",
      ),
    ).toBeVisible();

    const appName = `Prod OAuth ${suffix}`;
    const callbackUrl = `https://app-${suffix}.example.com/oauth/callback`;
    await page.getByLabel("Application name").fill(appName);
    await redirectInput.fill(callbackUrl);
    await page
      .getByRole("button", { name: "Create OAuth application" })
      .click();

    await expect(page.getByText("OAuth application created.")).toBeVisible();
    await expect(page.getByText(`${appName} client secret`)).toBeVisible();
    await expect(page.getByText(/^linsec_/)).toBeVisible();
    await expect(page.getByText(appName, { exact: true })).toBeVisible();
    await expect(page.getByText(`Redirect URL: ${callbackUrl}`)).toBeVisible();
  });
});
