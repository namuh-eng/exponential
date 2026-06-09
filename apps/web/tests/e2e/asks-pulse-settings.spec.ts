import { expect, test } from "@playwright/test";

test.describe("asks and pulse settings", () => {
  test("persist real workspace controls", async ({ page }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `asks-pulse-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Asks Pulse ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/asks`);
    await page.getByRole("checkbox", { name: "Enable Asks" }).check();
    await expect(page.getByText("Asks settings saved.")).toBeVisible();
    await page.getByLabel("Intake email").fill("help@example.com");
    await page.getByLabel("Intake email").blur();
    await expect(page.getByText("Asks settings saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Intake email")).toHaveValue(
      "help@example.com",
    );

    await page.goto(`/${workspaceSlug}/settings/pulse`);
    await page
      .getByRole("combobox", { name: "Digest frequency" })
      .selectOption("daily");
    await expect(page.getByText("Pulse settings saved.")).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Digest frequency" }),
    ).toHaveValue("daily");
  });
});
