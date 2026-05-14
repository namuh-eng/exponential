import { expect, test } from "@playwright/test";

test.describe("Connected accounts", () => {
  test("Connect account is disabled with configuration-required copy when no link provider is configured", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `connected-accounts-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Connected Accounts ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/account/connections`);

    await expect(
      page.getByRole("heading", { name: "Connected accounts", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No connected accounts")).toBeVisible();

    const capabilities = await page.request.get(
      "/api/auth/provider-capabilities",
    );
    expect(capabilities.ok()).toBeTruthy();
    const data = (await capabilities.json()) as {
      providers?: { google?: boolean };
    };

    const connectButton = page.getByRole("button", { name: "Connect account" });
    if (data.providers?.google) {
      await expect(connectButton).toBeEnabled();
      await connectButton.click();
      await expect(
        page.getByText("Choose an account to connect"),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Google" })).toBeVisible();
    } else {
      await expect(connectButton).toBeDisabled();
      await expect(
        page.getByText(
          /Account linking is unavailable because no social login providers are configured/,
        ),
      ).toBeVisible();
      await expect(
        page.getByText(/Ask an admin to configure Google OAuth/),
      ).toBeVisible();
      await expect(page.getByText("Choose an account to connect")).toHaveCount(
        0,
      );
    }
  });
});
