import { expect, test } from "@playwright/test";

test.describe("Team Insights analytics dashboard", () => {
  test("renders metric cards, persists controls, copies share URL, and opens drilldowns", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `insights-dashboard-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Insights Dashboard ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspacePayload = (await workspaceResponse.json()) as {
      team: { id: string; key: string };
    };
    const teamKey = workspacePayload.team.key;

    const issueResponse = await page.request.post("/api/issues", {
      data: {
        title: `Insights drilldown issue ${suffix}`,
        teamId: workspacePayload.team.id,
        priority: "medium",
      },
    });
    expect(issueResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/team/${teamKey}/insights`);

    await expect(page.getByText("exponential Insights")).toBeVisible();
    await expect(page.getByLabel("Insights metric cards")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Throughput/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Workload/ })).toBeVisible();
    await expect(page.getByLabel("Insights trend chart")).toBeVisible();

    await page.getByLabel("Date range").selectOption("30d");
    await expect(page).toHaveURL(/range=30d/);
    await page.reload();
    await expect(page.getByLabel("Date range")).toHaveValue("30d");

    await page.getByRole("button", { name: "Copy share link" }).click();
    await expect(
      page.getByText(
        /Copied share link with the current Insights controls|Share link is ready in the address bar/,
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: /Workload/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/team/${teamKey}/all\\?`),
    );
    await expect(page).toHaveURL(/insight=metric%3Aworkload/);
  });

  test("shows honest empty state for filters with no matching issue history", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `insights-empty-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Insights Empty ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspacePayload = (await workspaceResponse.json()) as {
      team: { key: string };
    };

    await page.goto(
      `/${workspaceSlug}/team/${workspacePayload.team.key}/insights?status=completed`,
    );

    await expect(page.getByText("exponential Insights")).toBeVisible();
    await expect(
      page
        .getByLabel("Insights trend chart")
        .getByText(/No issues match these analytics filters/),
    ).toBeVisible();
    await expect(
      page.getByText(/Create or complete issues to populate throughput/),
    ).toBeVisible();
  });
});
