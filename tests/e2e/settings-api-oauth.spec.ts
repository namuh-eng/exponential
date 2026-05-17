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

  test("manages OAuth, webhook, and API key lifecycle controls", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `api-lifecycle-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `API Lifecycle ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    const oauthName = `Lifecycle OAuth ${suffix}`;
    const webhookName = `Lifecycle webhook ${suffix}`;
    const apiKeyName = `Lifecycle key ${suffix}`;

    const createOAuthResponse = await page.request.post(
      "/api/workspaces/current/api",
      {
        data: {
          action: "createOAuthApplication",
          name: oauthName,
          redirectUrl: `https://app-${suffix}.example.com/oauth/callback`,
        },
      },
    );
    expect(createOAuthResponse.status()).toBe(200);

    const createWebhookResponse = await page.request.post(
      "/api/workspaces/current/api",
      {
        data: {
          action: "createWebhook",
          label: webhookName,
          url: `https://hooks-${suffix}.example.com/linear`,
          events: ["created"],
        },
      },
    );
    expect(createWebhookResponse.status()).toBe(200);

    const createApiKeyResponse = await page.request.post(
      "/api/workspaces/current/api",
      {
        data: {
          action: "createApiKey",
          name: apiKeyName,
        },
      },
    );
    expect(createApiKeyResponse.status()).toBe(200);

    await page.goto(`/${workspaceSlug}/settings/api`);
    await expect(page.getByText(oauthName, { exact: true })).toBeVisible();
    await expect(page.getByText(webhookName, { exact: true })).toBeVisible();
    await expect(page.getByText(apiKeyName, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Disable webhook" }).click();
    await expect(page.getByText("Webhook disabled.")).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Enable webhook" }),
    ).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete webhook" }).click();
    await expect(page.getByText("Webhook deleted.")).toBeVisible();
    await page.reload();
    await expect(page.getByText(webhookName, { exact: true })).toHaveCount(0);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Revoke API key" }).click();
    await expect(page.getByText("API key revoked.")).toBeVisible();
    await page.reload();
    await expect(page.getByText(apiKeyName, { exact: true })).toHaveCount(0);

    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Delete OAuth application" })
      .click();
    await expect(page.getByText("OAuth application deleted.")).toBeVisible();
    await page.reload();
    await expect(page.getByText(oauthName, { exact: true })).toHaveCount(0);
  });

  test("issues scoped OAuth tokens and rejects invalid OAuth exchanges", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `oauth-flow-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `OAuth Flow ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    const redirectUri = `https://app-${suffix}.example.com/oauth/callback`;
    const createOAuthResponse = await page.request.post(
      "/api/workspaces/current/api",
      {
        data: {
          action: "createOAuthApplication",
          name: `Flow OAuth ${suffix}`,
          redirectUrls: [redirectUri],
          scopes: ["read", "issues:read"],
        },
      },
    );
    expect(createOAuthResponse.status()).toBe(200);
    const created = await createOAuthResponse.json();
    const app = created.api.oauthApplications[0];
    const clientSecret = created.createdCredential.secret;

    const invalidRedirect = await page.request.get(
      `/api/oauth/authorize?response_type=code&client_id=${app.clientId}&redirect_uri=${encodeURIComponent(`https://evil-${suffix}.example.com/callback`)}&scope=read&state=bad`,
      { maxRedirects: 0 },
    );
    expect(invalidRedirect.status()).toBe(307);
    expect(invalidRedirect.headers().location).toContain(
      "error=invalid_redirect_uri",
    );

    const authorizeResponse = await page.request.get(
      `/api/oauth/authorize?response_type=code&client_id=${app.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read%20issues:read&state=ok`,
      { maxRedirects: 0 },
    );
    expect(authorizeResponse.status()).toBe(307);
    const callback = new URL(authorizeResponse.headers().location ?? "");
    expect(`${callback.origin}${callback.pathname}`).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe("ok");
    const code = callback.searchParams.get("code");
    expect(code).toMatch(/^lincode_/);

    const badSecretResponse = await page.request.post("/api/oauth/token", {
      data: {
        grant_type: "authorization_code",
        code,
        client_id: app.clientId,
        client_secret: "wrong",
        redirect_uri: redirectUri,
      },
    });
    expect(badSecretResponse.status()).toBe(401);

    const tokenResponse = await page.request.post("/api/oauth/token", {
      data: {
        grant_type: "authorization_code",
        code,
        client_id: app.clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      },
    });
    expect(tokenResponse.status()).toBe(200);
    await expect(tokenResponse.json()).resolves.toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "read issues:read",
    });
  });
});
