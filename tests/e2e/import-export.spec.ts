import { expect, test } from "@playwright/test";

test.describe("Import/export settings", () => {
  test("Start import opens provider picker and validates an empty CSV import", async ({
    page,
  }) => {
    const messages: string[] = [];
    page.on("console", (message) => messages.push(message.text()));

    await page.goto("/settings/import-export");

    await expect(
      page.getByRole("heading", { level: 1, name: "Import & export" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/foreverbrowsing\/settings\/import-export$/);

    await page.getByRole("button", { name: "Start import" }).click();

    const dialog = page.getByRole("dialog", { name: "Start import" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "CSV" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "GitHub" })).toBeVisible();
    await expect(dialog.getByText("Coming soon").first()).toBeVisible();

    await dialog.getByRole("button", { name: "CSV" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();

    await expect(
      dialog.getByText("Choose a CSV file before continuing with the import."),
    ).toBeVisible();
    expect(messages).not.toContain("Import");
  });
});
