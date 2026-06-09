import { expect, test } from "@playwright/test";

test.describe("team cycles settings new cycle", () => {
  test("opens creation form, persists a new cycle, and shows validation errors", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `cycles-settings-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Cycles Settings ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspacePayload = (await workspaceResponse.json()) as {
      team: { key: string };
    };
    const teamKey = workspacePayload.team.key;

    const settingsResponse = await page.request.patch(
      `/api/teams/${teamKey}/settings`,
      {
        data: {
          cyclesEnabled: true,
          cycleDurationWeeks: 2,
        },
      },
    );
    expect(settingsResponse.ok()).toBeTruthy();

    await page.goto(`/${workspaceSlug}/settings/teams/${teamKey}/cycles`);
    await expect(
      page.getByText("No cycles have been created for this team."),
    ).toBeVisible();

    await page.getByRole("button", { name: "New cycle" }).click();
    await expect(
      page.getByRole("form", { name: "Create cycle" }),
    ).toBeVisible();

    await page
      .getByPlaceholder("Cycle name (optional)")
      .fill(`Cycle ${suffix}`);
    await page.getByLabel("Start").fill("2026-07-06");
    await page.getByLabel("End").fill("2026-07-19");
    await page.getByRole("button", { name: "Create cycle" }).click();

    await expect(page.getByText(`Cycle ${suffix}`)).toBeVisible();
    await expect(
      page.getByRole("form", { name: "Create cycle" }),
    ).not.toBeVisible();

    await page.getByRole("button", { name: "New cycle" }).click();
    await page.getByPlaceholder("Cycle name (optional)").fill("Overlap");
    await page.getByLabel("Start").fill("2026-07-10");
    await page.getByLabel("End").fill("2026-07-20");
    await page.getByRole("button", { name: "Create cycle" }).click();

    await expect(
      page.getByText("Cycle dates overlap with an existing cycle"),
    ).toBeVisible();
  });
});
