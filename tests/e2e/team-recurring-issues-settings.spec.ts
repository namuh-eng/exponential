import { expect, test } from "@playwright/test";

test.describe("team recurring issues settings", () => {
  test("creates, edits, disables, and deletes a recurring issue", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `recurring-settings-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Recurring Settings ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspacePayload = (await workspaceResponse.json()) as {
      team: { key: string };
    };
    const teamKey = workspacePayload.team.key;

    await page.goto(
      `/${workspaceSlug}/settings/teams/${teamKey}/recurring-issues`,
    );
    await expect(
      page.getByText("No recurring issues have been configured for this team."),
    ).toBeVisible();

    await page.getByRole("button", { name: "New recurring issue" }).click();
    await expect(
      page.getByRole("form", { name: "Create recurring issue" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Create recurring issue" }).click();
    await expect(page.getByText("Title is required")).toBeVisible();

    await page.getByLabel("Title").fill(`Weekly metrics ${suffix}`);
    await page
      .getByLabel("Description")
      .fill("Prepare the team metrics report");
    await page.getByLabel("Cadence").selectOption("weekly");
    await page.getByLabel("Start").fill("2026-07-01T09:00");
    await page.getByLabel("Timezone").fill("America/Los_Angeles");
    await page.getByRole("button", { name: "Create recurring issue" }).click();

    await expect(page.getByText(`Weekly metrics ${suffix}`)).toBeVisible();
    await expect(page.getByText("Enabled")).toBeVisible();
    await expect(page.getByText(/Next run/)).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Title").fill(`Updated metrics ${suffix}`);
    await page.getByRole("button", { name: "Save recurring issue" }).click();
    await expect(page.getByText(`Updated metrics ${suffix}`)).toBeVisible();

    await page.getByRole("button", { name: "Disable" }).click();
    await expect(page.getByText("Disabled")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(
      page.getByText("No recurring issues have been configured for this team."),
    ).toBeVisible();
  });
});
