import { expect, test } from "@playwright/test";

test.describe("Connected accounts", () => {
  test("Connected accounts renders integration provider rows and configured/unavailable states", async ({
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
      page.getByRole("heading", { level: 1, name: "Connected accounts" }),
    ).toBeVisible();
    await expect(page.getByText("No connected accounts yet.")).toBeVisible();
    await expect(page.getByText("Available providers")).toBeVisible();
    await expect(page.getByText(/^GitHub$/)).toBeVisible();
    await expect(page.getByText(/^GitLab$/)).toBeVisible();
    await expect(page.getByText(/^Slack$/)).toBeVisible();
    await expect(page.getByText(/^Google$/)).toBeVisible();
    await expect(page.getByText(/personal GitHub account/)).toBeVisible();

    const capabilities = await page.request.get(
      "/api/auth/provider-capabilities",
    );
    expect(capabilities.ok()).toBeTruthy();
    const data = (await capabilities.json()) as {
      providers?: { github?: boolean; google?: boolean };
    };

    const connectButton = page.getByRole("button", { name: "Connect account" });
    if (data.providers?.github) {
      await expect(connectButton).toBeEnabled();
      await connectButton.click();
      await expect(
        page.getByText("Choose an account to connect"),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "GitHub" })).toBeVisible();
    } else {
      await expect(
        page.getByText("GitHub account linking is not configured"),
      ).toBeVisible();
    }

    if (!data.providers?.github && !data.providers?.google) {
      await expect(connectButton).toHaveCount(0);
      await expect(page.getByText("Choose an account to connect")).toHaveCount(
        0,
      );
    }
  });
});
