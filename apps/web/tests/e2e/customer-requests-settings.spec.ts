import { expect, test } from "@playwright/test";

test.describe("customer request settings", () => {
  test("persist real workspace customer request controls", async ({ page }) => {
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
    await expect(
      page.getByRole("heading", { name: "Customer requests" }),
    ).toBeVisible();

    await page
      .getByRole("checkbox", { name: "Enable customer requests" })
      .check();
    await expect(
      page.getByText("Customer request settings saved."),
    ).toBeVisible();

    await page.getByLabel("Intake email").fill("feedback@example.com");
    await page.getByLabel("Intake email").blur();
    await expect(
      page.getByText("Customer request settings saved."),
    ).toBeVisible();

    await page
      .getByRole("combobox", { name: "Default issue priority" })
      .selectOption("urgent");
    await expect(
      page.getByText("Customer request settings saved."),
    ).toBeVisible();

    await page.getByText("Require company name").click();
    await expect(
      page.getByText("Customer request settings saved."),
    ).toBeVisible();

    await expect
      .poll(async () => {
        const response = await page.request.get(
          "/api/workspaces/current/collaboration",
          {
            headers: {
              referer: `http://localhost/${workspaceSlug}/settings/customer-requests`,
            },
          },
        );
        const data = (await response.json()) as {
          collaboration?: {
            customerRequests?: {
              enabled?: boolean;
              intakeEmail?: string;
              defaultPriority?: string;
              requireCompany?: boolean;
            };
          };
        };
        return data.collaboration?.customerRequests;
      })
      .toMatchObject({
        enabled: true,
        intakeEmail: "feedback@example.com",
        defaultPriority: "urgent",
        requireCompany: true,
      });

    await page.reload();
    await expect(page.getByLabel("Intake email")).toHaveValue(
      "feedback@example.com",
    );
    await expect(
      page.getByRole("combobox", { name: "Default issue priority" }),
    ).toHaveValue("urgent");
    await expect(page.getByText("Company is required.")).toBeVisible();
  });
});
