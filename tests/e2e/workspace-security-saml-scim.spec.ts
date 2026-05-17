import { expect, test } from "@playwright/test";

test.describe("Workspace security SAML and SCIM", () => {
  test("configures SAML and manages SCIM token lifecycle", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `security-saml-scim-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Security SAML SCIM ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/security`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Security" }),
    ).toBeVisible();
    await expect(page.getByText("SAML & SCIM", { exact: true })).toBeVisible();

    await page.getByLabel("SAML domains").fill("Example.com");
    await page.getByLabel("IdP SSO URL").fill("https://idp.example.com/saml");
    await page.getByLabel("SAML issuer").fill("https://idp.example.com/entity");
    await page.getByRole("button", { name: "Save and test SAML" }).click();
    await expect(
      page.getByText("SAML settings saved and test state refreshed."),
    ).toBeVisible();
    await page.getByRole("switch", { name: "Enable SAML SSO" }).click();
    await expect(page.getByText("SAML enabled.")).toBeVisible();

    const discovery = await page.request.post("/api/auth/saml/discovery", {
      data: { email: "person@example.com" },
    });
    expect(discovery.status()).toBe(200);
    await expect(discovery.json()).resolves.toEqual({
      url: "https://idp.example.com/saml",
    });

    await page.getByRole("button", { name: "Generate SCIM token" }).click();
    await expect(page.getByText("Copy this SCIM token now:")).toBeVisible();
    await expect(page.locator("code", { hasText: /scim_/ })).toBeVisible();

    await page.getByRole("button", { name: "Revoke token" }).click();
    await expect(page.getByText("SCIM token revoked.")).toBeVisible();

    const securityResponse = await page.request.get(
      "/api/workspaces/current/security",
    );
    expect(securityResponse.ok()).toBeTruthy();
    const security = await securityResponse.json();
    expect(security.security.saml).toMatchObject({
      enabled: true,
      domains: ["example.com"],
      idpSsoUrl: "https://idp.example.com/saml",
      status: "tested",
    });
    expect(security.security.scim).toMatchObject({
      enabled: false,
      status: "revoked",
    });
  });
});
