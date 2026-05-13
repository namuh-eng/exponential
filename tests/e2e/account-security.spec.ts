import { expect, test } from "@playwright/test";

test.describe("Account security and access", () => {
  test("shows Linear-style sections and supports session/API key revocation", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `account-security-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Account Security ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    // Create a second session for the same authenticated test user so the page
    // has a non-current session that can be revoked without logging itself out.
    const sessionResponse = await page.request.post(
      "/api/test/create-session",
      {
        data: { email: "test@example.com" },
      },
    );
    expect(sessionResponse.status()).toBe(200);

    await page.goto(`/${workspaceSlug}/settings/account/security`);

    await expect(
      page.getByRole("heading", { name: "Security & access" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Passkeys" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Personal API keys" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Authorized applications" }),
    ).toBeVisible();
    await expect(page.getByText(/Two-factor authentication/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Show details" }).first().click();
    await expect(page.getByText("Original sign-in")).toBeVisible();
    await expect(page.getByText("Last seen")).toBeVisible();

    const revokeButtons = page.getByRole("button", {
      name: "Revoke",
      exact: true,
    });
    const initialRevokeCount = await revokeButtons.count();
    expect(initialRevokeCount).toBeGreaterThanOrEqual(2);
    await expect(page.getByText("Current session")).toBeVisible();
    for (let index = 0; index < initialRevokeCount; index += 1) {
      const button = revokeButtons.nth(index);
      if (!(await button.isDisabled())) {
        await button.click();
        break;
      }
    }
    await expect(page.getByText("Session revoked.")).toBeVisible();

    await page.getByLabel("API key name").fill(`E2E key ${suffix}`);
    await page.getByRole("button", { name: "Create API key" }).click();
    await expect(page.getByText("Personal API key created.")).toBeVisible();
    await expect(page.getByText(/lin_api_/).first()).toBeVisible();
    const apiKeyHeading = page.getByRole("heading", {
      name: `E2E key ${suffix}`,
    });
    await expect(apiKeyHeading).toBeVisible();

    const apiKeyRow = apiKeyHeading.locator(
      "xpath=ancestor::div[contains(@class, 'py-4')][1]",
    );
    await apiKeyRow
      .getByRole("button", { name: "Revoke", exact: true })
      .click();
    await expect(page.getByText("Personal API key revoked.")).toBeVisible();
    await expect(apiKeyHeading).toHaveCount(0);
  });
});
