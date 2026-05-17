import { expect, test } from "@playwright/test";

async function expectNoMainPane404(page: import("@playwright/test").Page) {
  await expect(
    page.getByText("This page could not be found"),
  ).not.toBeVisible();
}

test.describe("Slug-prefixed team issue routes", () => {
  test("seeded Forever Browsing team issue routes render and preserve workspace slug", async ({
    page,
  }) => {
    for (const route of ["all", "active", "backlog"] as const) {
      await page.goto(`/foreverbrowsing/team/ENG/${route}`);
      await expect(page).toHaveURL(
        new RegExp(`/foreverbrowsing/team/ENG/${route}$`),
      );
      await expect(
        page.getByRole("heading", { name: "Engineering" }),
      ).toBeVisible();
      await expectNoMainPane404(page);
    }

    await page.getByRole("button", { name: "Active" }).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/active$/);
    await expectNoMainPane404(page);

    await page.getByRole("button", { name: "Backlog" }).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/backlog$/);
    await expectNoMainPane404(page);

    await page.getByRole("button", { name: "Display options" }).click();
    await page.getByRole("button", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/board$/);
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expectNoMainPane404(page);

    await page.getByRole("button", { name: "Display options" }).click();
    await page.getByRole("button", { name: "List" }).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/all$/);
    await expectNoMainPane404(page);

    await page.goto("/team/ENG/all");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/all$/);
    await expectNoMainPane404(page);
  });

  test("new workspace team routes render under dynamic workspace slug", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `slug-team-routes-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Slug Team Routes ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspacePayload = (await workspaceResponse.json()) as {
      team: { key: string; name: string };
    };
    const teamKey = workspacePayload.team.key;

    await page.goto(`/${workspaceSlug}/team/${teamKey}/all`);
    await expect(
      page.getByRole("heading", { name: "No issues" }),
    ).toBeVisible();
    await expectNoMainPane404(page);

    await page.goto(`/${workspaceSlug}/team/${teamKey}/board`);
    await expect(
      page.getByRole("heading", { name: "No issues" }),
    ).toBeVisible();
    await expectNoMainPane404(page);
  });
});
