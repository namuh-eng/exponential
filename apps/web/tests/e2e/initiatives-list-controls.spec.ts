import { expect, test } from "@playwright/test";

test.describe("Initiatives list controls", () => {
  test("filters, groups, sorts, and persists scoped initiative views", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const matchingName = `Controls Roadmap ${suffix}`;
    const hiddenName = `Hidden Roadmap ${suffix}`;

    const matchingResponse = await page.request.post("/api/initiatives", {
      headers: { referer: "http://localhost:3000/foreverbrowsing/initiatives" },
      data: {
        name: matchingName,
        description: "Scoped toolbar regression target",
        status: "active",
        targetDate: "2026-09-30",
        health: "atRisk",
      },
    });
    expect(matchingResponse.status()).toBe(201);

    const hiddenResponse = await page.request.post("/api/initiatives", {
      headers: { referer: "http://localhost:3000/foreverbrowsing/initiatives" },
      data: {
        name: hiddenName,
        description: "Should disappear under search filters",
        status: "active",
        health: "onTrack",
      },
    });
    expect(hiddenResponse.status()).toBe(201);

    await page.goto("/foreverbrowsing/initiatives");
    await expect(page.getByLabel("Initiatives list controls")).toBeVisible();
    await expect(page.getByLabel("Search initiatives")).toBeVisible();
    await expect(page.getByLabel("Filter by owner")).toBeVisible();
    await expect(page.getByLabel("Filter by team")).toBeVisible();
    await expect(page.getByLabel("Filter by health")).toBeVisible();
    await expect(page.getByLabel("Filter by target date")).toBeVisible();
    await expect(
      page.getByLabel("Filter by active project state"),
    ).toBeVisible();
    await expect(page.getByLabel("Sort initiatives")).toBeVisible();
    await expect(page.getByLabel("Group initiatives")).toBeVisible();

    await page.getByLabel("Search initiatives").fill(matchingName);
    await page.getByLabel("Filter by health").selectOption("atRisk");
    await page.getByLabel("Filter by target date").selectOption("set");
    await page.getByLabel("Sort initiatives").selectOption("health");
    await page.getByLabel("Group initiatives").selectOption("health");

    await expect(
      page.getByTestId("initiative-row").filter({ hasText: matchingName }),
    ).toBeVisible();
    await expect(
      page.getByTestId("initiative-row").filter({ hasText: hiddenName }),
    ).toHaveCount(0);
    await expect(page.getByLabel("At risk initiatives group")).toBeVisible();
    await expect(page).toHaveURL(/q=Controls\+Roadmap/);
    await expect(page).toHaveURL(/health=atRisk/);
    await expect(page).toHaveURL(/target=set/);
    await expect(page).toHaveURL(/sort=health/);
    await expect(page).toHaveURL(/group=health/);

    await page.reload();
    await expect(page.getByLabel("Search initiatives")).toHaveValue(
      matchingName,
    );
    await expect(page.getByLabel("Filter by health")).toHaveValue("atRisk");
    await expect(
      page.getByTestId("initiative-row").filter({ hasText: matchingName }),
    ).toBeVisible();
    await expect(
      page.getByTestId("initiative-row").filter({ hasText: hiddenName }),
    ).toHaveCount(0);
  });
});
