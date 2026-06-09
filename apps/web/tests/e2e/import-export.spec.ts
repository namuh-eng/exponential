import { expect, test } from "@playwright/test";

test.describe("Import/export settings", () => {
  test("admin can request export and run CSV import preview/job flow", async ({
    page,
  }) => {
    const messages: string[] = [];
    page.on("console", (message) => messages.push(message.text()));

    await page.goto("/settings/import-export");

    await expect(
      page.getByRole("heading", { level: 1, name: "Import & export" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/foreverbrowsing\/settings\/import-export$/);
    await expect(page.getByText(/not implemented/i)).toHaveCount(0);
    await expect(page.getByText(/coming soon/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Request export" }).click();
    await expect(
      page.getByText(/Workspace export completed with/).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download" }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Start import" }).click();

    const dialog = page.getByRole("dialog", { name: "Start import" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /CSV/ })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: /GitHub/ })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: /Jira/ })).toBeEnabled();

    await dialog.getByRole("button", { name: /CSV/ }).click();
    await dialog.getByLabel("CSV file").setInputFiles({
      name: "issues.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "title,description,priority,team\nE2E imported issue,Created by Playwright,medium,ENG",
      ),
    });

    await expect(
      dialog.getByText("Preview: 1 valid, 0 with errors, 1 total"),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Start import job" }).click();
    await expect(
      page.getByText("CSV import completed with 1 issues created.").first(),
    ).toBeVisible();
    expect(messages).not.toContain("Import");
  });
});
