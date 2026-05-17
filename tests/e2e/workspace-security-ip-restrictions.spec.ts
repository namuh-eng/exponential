import { expect, test } from "@playwright/test";

test.describe("Workspace security IP restrictions", () => {
  test("adds and persists an IP restriction from workspace security settings", async ({
    page,
  }) => {
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
    );
    expect(securityResponse.ok()).toBeTruthy();
    await expect
      .poll(async () => {
        const data = (await (
          await page.request.get("/api/workspaces/current/security")
        ).json()) as {
          security?: { ipRestrictions?: Array<{ range: string }> };
        };
        return data.security?.ipRestrictions?.map((entry) => entry.range) ?? [];
      })
      .toContain("198.51.100.10/32");

    await page.reload();
    await expect(page.getByText("198.51.100.10/32")).toBeVisible();
    await expect(page.getByText("VPN gateway")).toBeVisible();
  });
});
