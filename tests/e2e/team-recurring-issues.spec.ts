import { expect, test } from "@playwright/test";

test.describe("Team recurring issues settings", () => {
  test("creates, edits, disables, and deletes a recurring issue from settings", async ({
    page,
  }) => {
    let recurringIssues: Array<{
      id: string;
      title: string;
      description: string;
      cadenceConfig: Record<string, unknown>;
      cadenceLabel: string;
      timezone: string;
      nextRunAt: string;
      enabled: boolean;
    }> = [];
    const requests: unknown[] = [];

    await page.route("**/api/teams/ENG/recurring-issues**", async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const id = url.pathname.split("/").pop();
      if (method === "GET") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            team: { id: "team-1", name: "Engineering", key: "ENG" },
            recurringIssues,
          }),
        });
        return;
      }

      if (method === "POST") {
        const body = route.request().postDataJSON();
        requests.push(body);
        const created = {
          id: "recurring-1",
          title: body.title,
          description: body.description,
          cadenceConfig: {
            cadence: body.cadence,
            interval: body.interval,
            startDate: body.startDate,
            time: body.time,
          },
          cadenceLabel: body.cadence === "weekly" ? "Weekly" : "Monthly",
          timezone: body.timezone,
          nextRunAt: "2026-05-21T09:00:00.000Z",
          enabled: body.enabled,
        };
        recurringIssues = [created];
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ recurringIssue: created }),
        });
        return;
      }

      if (method === "PATCH" && id) {
        const body = route.request().postDataJSON();
        requests.push(body);
        const updated = {
          ...recurringIssues[0],
          title: body.title,
          description: body.description,
          cadenceConfig: {
            cadence: body.cadence,
            interval: body.interval,
            startDate: body.startDate,
            time: body.time,
          },
          cadenceLabel: body.cadence === "monthly" ? "Monthly" : "Weekly",
          timezone: body.timezone,
          enabled: body.enabled,
        };
        recurringIssues = [updated];
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ recurringIssue: updated }),
        });
        return;
      }

      if (method === "DELETE") {
        recurringIssues = [];
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fallback();
    });

    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/foreverbrowsing/settings/teams/ENG/recurring-issues");

    await expect(
      page.getByRole("heading", { name: "Recurring issues" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New recurring issue" }).click();
    await expect(
      page.getByRole("dialog", { name: "Create recurring issue" }),
    ).toBeVisible();

    const createDialog = page.getByRole("dialog", {
      name: "Create recurring issue",
    });
    await createDialog
      .getByRole("button", { name: "Create recurring issue" })
      .click();
    await expect(page.getByText("Title is required.")).toBeVisible();

    await page.getByLabel("Issue title").fill("Weekly metrics review");
    await page.getByLabel("Description").fill("Review dashboards");
    await page.getByLabel("Cadence").selectOption("weekly");
    await page.getByLabel("Start date").fill("2026-05-21");
    await createDialog
      .getByRole("button", { name: "Create recurring issue" })
      .click();

    await expect(page.getByText("Weekly metrics review")).toBeVisible();
    await expect(page.getByText("Weekly", { exact: true })).toBeVisible();
    await expect(page.getByText("Enabled", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Disable" }).click();
    await expect(page.getByText("Disabled", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Issue title").fill("Monthly metrics review");
    await page.getByLabel("Cadence").selectOption("monthly");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Monthly metrics review")).toBeVisible();
    await expect(page.getByText("Monthly", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(
      page.getByText("No recurring issues have been configured for this team."),
    ).toBeVisible();
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Weekly metrics review",
          cadence: "weekly",
        }),
        expect.objectContaining({ enabled: false }),
        expect.objectContaining({
          title: "Monthly metrics review",
          cadence: "monthly",
        }),
      ]),
    );
  });
});
