import { expect, test } from "@playwright/test";

test.describe("customer request settings", () => {
  test("persist real customer request controls", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `customer-requests-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Customer Requests ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/customer-requests`);
    const customerRequestsToggle = page.getByRole("checkbox", {
      name: "Enable customer requests",
    });
    await expect(customerRequestsToggle).toBeVisible();
    await customerRequestsToggle.check();
    await expect(
      page.getByText("Customer request settings saved."),
    ).toBeVisible();

    await page.getByLabel("Request inbox email").fill("feedback@example.com");
    await page.getByLabel("Request inbox email").blur();
    await expect(
      page.getByText("Customer request settings saved."),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Issue linking behavior" })
      .selectOption("automatic");
    await expect(
      page.getByText("Customer request settings saved."),
    ).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Request inbox email")).toHaveValue(
      "feedback@example.com",
    );
    await expect(
      page.getByRole("combobox", { name: "Issue linking behavior" }),
    ).toHaveValue("automatic");
  });
});
