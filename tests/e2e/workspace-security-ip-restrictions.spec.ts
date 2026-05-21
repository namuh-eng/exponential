import { expect, test } from "@playwright/test";

test.describe("Workspace security IP restrictions", () => {
  test("adds, enforces, and persists an IP restriction from workspace security settings", async ({
    browser,
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.10" });
    const suffix = Date.now().toString(36);
    const workspaceSlug = `security-ip-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Security IP ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/security`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Security" }),
    ).toBeVisible();
    await expect(
      page.getByText("IP restrictions", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No IP restrictions")).toBeVisible();

    await page.getByRole("button", { name: "Add IP restriction" }).click();
    await page.getByPlaceholder("203.0.113.0/24").fill("198.51.100.10/32");
    await page.getByPlaceholder("Office network").fill("VPN gateway");
    await page.getByRole("button", { name: "Add restriction" }).click();

    await expect(page.getByText("198.51.100.10/32")).toBeVisible();
    await expect(page.getByText("VPN gateway")).toBeVisible();

    const securityResponse = await page.request.get(
      "/api/workspaces/current/security",
      { headers: { "x-forwarded-for": "198.51.100.10" } },
    );
    expect(securityResponse.ok()).toBeTruthy();

    const deniedSecurityResponse = await page.request.get(
      "/api/workspaces/current/security",
      { headers: { "x-forwarded-for": "203.0.113.42" } },
    );
    expect(deniedSecurityResponse.status()).toBe(403);
    await expect(deniedSecurityResponse.json()).resolves.toMatchObject({
      error: "Access denied by workspace IP restrictions",
      reason: "ip_not_allowed",
    });
    await expect
      .poll(async () => {
        const data = (await (
          await page.request.get("/api/workspaces/current/security", {
            headers: { "x-forwarded-for": "198.51.100.10" },
          })
        ).json()) as {
          security?: { ipRestrictions?: Array<{ range: string }> };
        };
        return data.security?.ipRestrictions?.map((entry) => entry.range) ?? [];
      })
      .toContain("198.51.100.10/32");

    await page.reload();
    await expect(page.getByText("198.51.100.10/32")).toBeVisible();
    await expect(page.getByText("VPN gateway")).toBeVisible();

    const deniedContext = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": "203.0.113.42" },
      storageState: "tests/e2e/.auth/user.json",
    });
    const deniedPage = await deniedContext.newPage();
    await deniedPage.goto(`/${workspaceSlug}/inbox`);
    await expect(
      deniedPage.getByRole("heading", {
        name: "Your IP address is not allowed for this workspace",
      }),
    ).toBeVisible();
    await deniedContext.close();
  });
});

test.describe("Workspace SAML and SCIM settings", () => {
  test("configures SAML and manages SCIM tokens from security settings", async ({
    page,
  }) => {
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
    await page.getByRole("button", { name: /SAML & SCIM management/ }).click();
    await page
      .getByPlaceholder("https://idp.example.com/sso")
      .fill("https://idp.example.com/sso");
    await page
      .getByPlaceholder("https://idp.example.com/entity")
      .fill("https://idp.example.com/entity");
    await page
      .getByPlaceholder("example.com, acme.co")
      .fill(`${workspaceSlug}.example.com`);
    await page.getByPlaceholder("Paste X.509 certificate").fill("CERTIFICATE");
    await page.getByRole("switch", { name: "Enable SAML SSO" }).click();
    await page.getByRole("button", { name: "Save SAML" }).click();
    await expect(page.getByText("SAML settings saved.")).toBeVisible();

    const discoveryResponse = await page.request.post(
      "/api/auth/saml/discovery",
      {
        data: { email: `person@${workspaceSlug}.example.com` },
      },
    );
    expect(discoveryResponse.status()).toBe(200);
    await expect(discoveryResponse.json()).resolves.toEqual({
      url: "https://idp.example.com/sso",
    });

    await page.getByRole("button", { name: "Generate SCIM token" }).click();
    await expect(page.getByText(/New token \(copy once\)/)).toBeVisible();
    await expect(page.getByText(/SCIM token · scim_/)).toBeVisible();
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(
      page.getByText(/SCIM token · scim_.* · revoked/),
    ).toBeVisible();
  });
});
