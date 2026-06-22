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

  test("admin can complete mocked GitHub guided import", async ({ page }) => {
    await page.route(
      "**/api/workspaces/current/import-export",
      async (route) => {
        const body = route.request().postDataJSON() as { action?: string };
        if (body.action === "fetch_provider_snapshot") {
          await route.fulfill({
            json: {
              import: {
                id: "import-gh-e2e",
                provider: "github",
                status: "review",
                createdAt: "2026-06-16T00:00:00.000Z",
                message: "GitHub review snapshot fetched with 1 issues.",
              },
              snapshot: {
                totals: { issues: 1, comments: 1, open: 1, closed: 0 },
                repositories: [{ fullName: "namuh-eng/exponential" }],
                issues: [
                  {
                    externalId: "namuh-eng/exponential#559",
                    repository: "namuh-eng/exponential",
                    number: 559,
                    title: "Parity importer issue",
                    state: "open",
                    labels: [{ name: "enhancement" }],
                  },
                ],
              },
            },
          });
          return;
        }
        await route.fulfill({
          json: {
            import: {
              id: "import-gh-e2e",
              provider: "github",
              status: "completed",
              createdAt: "2026-06-16T00:00:00.000Z",
              message:
                "GitHub import completed with 1 created, 0 skipped, and 0 failed.",
              importedCount: 1,
              errorCount: 0,
            },
          },
        });
      },
    );

    await page.goto("/settings/import-export");
    await page.getByRole("button", { name: "Start import" }).click();
    const dialog = page.getByRole("dialog", { name: "Start import" });
    await dialog.getByRole("button", { name: /GitHub/ }).click();
    await dialog.getByLabel("GitHub token").fill("ghp_mocked");
    await dialog
      .getByLabel("GitHub repositories")
      .fill("namuh-eng/exponential");
    await dialog.getByRole("button", { name: "Fetch GitHub issues" }).click();
    await expect(
      dialog.getByText(/Review GitHub snapshot: 1 issues/),
    ).toBeVisible();
    await expect(dialog.getByText("Parity importer issue")).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm GitHub import" }).click();
    await expect(
      dialog.getByText(/GitHub import completed with 1 created/),
    ).toBeVisible();
  });
});
