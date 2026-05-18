import { expect, test } from "@playwright/test";

test.describe("Workspace security IP restrictions", () => {
  test("adds, persists, and enforces IP restrictions from workspace security settings", async ({
    browser,
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "x-test-client-ip": "198.51.100.10" });
    const suffix = Date.now().toString(36);
    const workspaceSlug = `security-ip-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Security IP ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspacePayload = (await workspaceResponse.json()) as {
      workspace: { id: string; urlSlug: string };
    };

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
      { headers: { "x-test-client-ip": "198.51.100.10" } },
    );
    expect(securityResponse.ok()).toBeTruthy();
    await expect
      .poll(async () => {
        const data = (await (
          await page.request.get("/api/workspaces/current/security", {
            headers: { "x-test-client-ip": "198.51.100.10" },
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
      baseURL: page.url().startsWith("http")
        ? new URL(page.url()).origin
        : undefined,
      storageState: await page.context().storageState(),
      extraHTTPHeaders: { "x-test-client-ip": "203.0.113.99" },
    });

    await deniedContext.addCookies([
      {
        name: "activeWorkspaceId",
        value: workspacePayload.workspace.id,
        domain: new URL(page.url()).hostname,
        path: "/",
      },
      {
        name: "activeWorkspaceSlug",
        value: workspaceSlug,
        domain: new URL(page.url()).hostname,
        path: "/",
      },
    ]);

    const deniedSecurityResponse = await deniedContext.request.get(
      "/api/workspaces/current/security",
      {
        headers: {
          "x-test-client-ip": "203.0.113.99",
          "x-workspace-slug": workspaceSlug,
        },
      },
    );
    expect(deniedSecurityResponse.status()).toBe(403);
    await expect(deniedSecurityResponse.json()).resolves.toMatchObject({
      code: "workspace_ip_restricted",
    });

    const deniedApiResponse = await deniedContext.request.get(
      "/api/workspaces/current/api",
      {
        headers: {
          "x-test-client-ip": "203.0.113.99",
          "x-workspace-slug": workspaceSlug,
        },
      },
    );
    expect(deniedApiResponse.status()).toBe(403);

    const deniedPage = await deniedContext.newPage();
    await deniedPage.goto(`/${workspaceSlug}/settings/security`);
    await expect(
      deniedPage.getByRole("heading", {
        name: "Your network is not allowed for this workspace",
      }),
    ).toBeVisible();
    await deniedContext.close();
  });
});
