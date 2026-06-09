import { expect, test } from "@playwright/test";

test.describe("Account security and access", () => {
  test("shows exponential-style sections with personal API key controls", async ({
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

    const clearAppsResponse = await page.request.delete(
      "/api/test/authorized-application",
    );
    expect(clearAppsResponse.status()).toBe(200);

    await page.goto(`/${workspaceSlug}/settings/account/security`);

    await expect(
      page.getByRole("heading", { name: "Security & access" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Passkeys" })).toBeVisible();
    await expect(
      page.getByText(/Passkeys are not configured for this workspace yet/i),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add passkey" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Add passkey" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add passkey" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Passkey enrollment cancelled.")).toBeVisible();
    await expect(
      page.getByText(/No passkeys have been added yet/i),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add passkey" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add passkey" }),
    ).toBeVisible();
    await expect(page.getByLabel("Passkey name")).toHaveValue("Passkey 1");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Passkey enrollment cancelled.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "API keys", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open workspace API settings" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Personal API keys" }),
    ).toBeVisible();
    await expect(page.getByLabel("API key name")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create API key" }),
    ).toBeVisible();
    await expect(
      page.getByText(/No personal API keys have been created yet/i),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Authorized applications" }),
    ).toBeVisible();
    await expect(page.getByText(/No authorized applications/i)).toBeVisible();
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
  });

  test("shows and revokes an authorized OAuth application", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `account-security-app-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Account Security App ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    const clearAppsResponse = await page.request.delete(
      "/api/test/authorized-application",
    );
    expect(clearAppsResponse.status()).toBe(200);
    const grantResponse = await page.request.post(
      "/api/test/authorized-application",
      {
        data: { name: "E2E OAuth App", scopes: ["read", "write"] },
      },
    );
    expect(grantResponse.status()).toBe(201);
    const grant = await grantResponse.json();

    await page.goto(`/${workspaceSlug}/settings/account/security`);

    await expect(page.getByText("E2E OAuth App")).toBeVisible();
    await expect(
      page.getByText(new RegExp(`App ID: ${grant.appId}`)),
    ).toHaveCount(0);
    await expect(page.getByText(/Permissions: View workspace/)).toBeVisible();
    await expect(page.getByText(/Webhook access/)).toBeVisible();
    await expect(page.getByText(/Last used\s+Unavailable/)).toBeVisible();

    await page
      .getByRole("region", { name: "Authorized applications" })
      .getByRole("button", { name: "Revoke" })
      .click();
    await expect(
      page.getByRole("alertdialog", { name: "Confirm revoking E2E OAuth App" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("E2E OAuth App")).toBeVisible();
    await page
      .getByRole("region", { name: "Authorized applications" })
      .getByRole("button", { name: "Revoke" })
      .click();
    await page.getByRole("button", { name: "Confirm revoke" }).click();

    await expect(
      page.getByText("Authorized application revoked."),
    ).toBeVisible();
    await expect(page.getByText("E2E OAuth App")).toHaveCount(0);
    await expect(page.getByText(/No authorized applications/i)).toBeVisible();
  });

  test("creates, hides after reload, and revokes a personal API key", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `account-security-key-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Account Security Key ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/account/security`);
    await page.getByRole("button", { name: "Create API key" }).click();
    await page.getByLabel("API key name").fill(`E2E personal ${suffix}`);
    await page
      .getByRole("region", { name: "Personal API keys" })
      .getByRole("button", { name: "Create API key" })
      .last()
      .click();

    await expect(page.getByText(/Copy your new API key now/i)).toBeVisible();
    const secret = page.locator("code").filter({ hasText: /^lin_api_/ });
    await expect(secret).toBeVisible();
    await expect(page.getByText(`E2E personal ${suffix}`)).toBeVisible();

    await page.reload();
    await expect(page.getByText(`E2E personal ${suffix}`)).toBeVisible();
    await expect(page.getByText(/Copy your new API key now/i)).toHaveCount(0);
    await expect(
      page.locator("code").filter({ hasText: /^lin_api_/ }),
    ).toHaveCount(0);

    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("region", { name: "Personal API keys" })
      .getByRole("button", { name: "Revoke" })
      .click();
    await expect(page.getByText("API key revoked.")).toBeVisible();
    await expect(page.getByText(`E2E personal ${suffix}`)).toHaveCount(0);
  });
});
