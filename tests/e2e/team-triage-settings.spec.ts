import { expect, test } from "@playwright/test";

test.describe("Team triage settings", () => {
  test("configures intake review and default triage decision destinations", async ({
    page,
  }) => {
    let teamSettings = {
      name: "Engineering",
      triageEnabled: true,
      triageAcceptDestinationStateId: "state-backlog",
      triageDeclineDestinationStateId: "state-canceled",
      acceptDestinationStates: [
        { id: "state-backlog", name: "Backlog", category: "backlog" },
        { id: "state-ready", name: "Ready", category: "unstarted" },
      ],
      declineDestinationStates: [
        { id: "state-canceled", name: "Canceled", category: "canceled" },
        { id: "state-duplicate", name: "Duplicate", category: "canceled" },
      ],
    };
    const patchBodies: unknown[] = [];

    await page.route("**/api/teams/ENG/settings", async (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        patchBodies.push(body);
        teamSettings = { ...teamSettings, ...body };
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ team: teamSettings }),
        });
        return;
      }

      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ team: teamSettings }),
      });
    });

    await page.goto("/foreverbrowsing/settings/teams/ENG/triage");

    await expect(page.getByRole("heading", { name: "Triage" })).toBeVisible();
    await expect(page.getByLabel("Enable triage")).toBeChecked();

    await page.getByLabel("Enable triage").click();
    await expect(page.getByText("Triage settings updated")).toBeVisible();

    await page
      .getByLabel("Default accept destination")
      .selectOption("state-ready");
    await page
      .getByLabel("Default decline destination")
      .selectOption("state-duplicate");

    await expect
      .poll(() => patchBodies)
      .toContainEqual({
        triageEnabled: false,
      });
    await expect
      .poll(() => patchBodies)
      .toContainEqual({
        triageAcceptDestinationStateId: "state-ready",
      });
    await expect
      .poll(() => patchBodies)
      .toContainEqual({
        triageDeclineDestinationStateId: "state-duplicate",
      });
  });
});
