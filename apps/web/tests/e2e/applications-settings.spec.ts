import { expect, test } from "@playwright/test";
import { createIsolatedTestSession } from "./test-session";

test.describe("Workspace applications settings", () => {
  test("shows true empty state, then displays and revokes a connected application", async ({
    page,
  }) => {
    await createIsolatedTestSession(page, "applications");
    const suffix = Date.now().toString(36);
    const workspaceSlug = `applications-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: { name: `Applications ${suffix}`, urlSlug: workspaceSlug },
    });
    expect(workspaceResponse.status()).toBe(201);

    const clearResponse = await page.request.delete(
      "/api/test/authorized-application",
    );
    expect(clearResponse.status()).toBe(200);

    await page.goto(`/${workspaceSlug}/settings/applications`);
    await expect(
      page.getByRole("heading", { name: "Applications", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("No applications")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Explore integrations" }),
    ).toHaveAttribute("href", `/${workspaceSlug}/settings/integrations`);

    const grantResponse = await page.request.post(
      "/api/test/authorized-application",
      {
        data: { name: "E2E Workspace App", scopes: ["read", "webhooks:write"] },
      },
    );
    expect(grantResponse.status()).toBe(201);
    const grant = await grantResponse.json();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "E2E Workspace App", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Authorized by /)).toBeVisible();
    await expect(page.getByText(grant.clientId)).toBeVisible();
    await expect(
      page.getByText(/Workspace data: View workspace/),
    ).toBeVisible();
    await expect(page.getByText("Webhook access enabled")).toBeVisible();

    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(
      page.getByRole("alertdialog", {
        name: "Confirm revoking E2E Workspace App",
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("heading", { name: "E2E Workspace App", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("button", { name: "Confirm revoke" }).click();
    await expect(page.getByText("Application access revoked.")).toBeVisible();
    await expect(page.getByText("E2E Workspace App")).toHaveCount(0);
    await expect(page.getByText("No applications")).toBeVisible();
  });
});
