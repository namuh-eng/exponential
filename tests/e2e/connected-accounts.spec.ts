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

    const apiRedirects: string[] = [];
    page.on("response", (response) => {
      const url = response.url();
      if (
        url.includes("/api/account/") &&
        response.status() >= 300 &&
        response.status() < 400
      ) {
        apiRedirects.push(`${response.status()} ${url}`);
      }
    });

    await page.goto(`/${workspaceSlug}/settings/account/connections`);
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/settings/account/connections$`),
    );

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
      providers?: {
        github?: boolean | { configured?: boolean; devLinking?: boolean };
        google?: boolean | { configured?: boolean; devLinking?: boolean };
      };
    };

    const connectButton = page.getByRole("button", { name: "Connect account" });
    const githubCapability = data.providers?.github;
    const googleCapability = data.providers?.google;
    const githubActionable =
      githubCapability === true ||
      (typeof githubCapability === "object" &&
        (githubCapability.configured || githubCapability.devLinking));
    const googleActionable =
      googleCapability === true ||
      (typeof googleCapability === "object" &&
        (googleCapability.configured || googleCapability.devLinking));

    if (githubActionable) {
      await expect(connectButton).toBeEnabled();
      await connectButton.click();
      await expect(
        page.getByText("Choose an account to connect"),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "GitHub", exact: true }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByText("GitHub account linking is not configured"),
      ).toBeVisible();
    }

    if (!githubActionable && !googleActionable) {
      await expect(connectButton).toHaveCount(0);
      await expect(page.getByText("Choose an account to connect")).toHaveCount(
        0,
      );
    }

    expect(apiRedirects).toEqual([]);
  });

  test("non-prefixed connected accounts route still renders for authenticated users", async ({
    page,
  }) => {
    await page.goto("/settings/account/connections");

    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Connected accounts" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/account\/connections$/);
  });
});
