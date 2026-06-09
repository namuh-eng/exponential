import { expect, test } from "@playwright/test";

test.describe("Initiatives roadmap metadata", () => {
  test("creates, edits, and rolls up initiative owner teams target health and active projects", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const initiativeName = `Roadmap Initiative ${suffix}`;
    const projectName = `Initiative Rollup Project ${suffix}`;
    const projectSlug = `initiative-rollup-project-${suffix}`;

    const projectResponse = await page.request.post("/api/projects", {
      data: {
        name: projectName,
        slug: projectSlug,
        description: "Project feeding active-project initiative rollup",
        teamKey: "ENG",
      },
    });
    expect(projectResponse.status()).toBe(201);
    const createdProject = (await projectResponse.json()) as { slug: string };

    const projectPatch = await page.request.patch(
      `/api/projects/${createdProject.slug}?workspaceSlug=foreverbrowsing`,
      {
        data: {
          status: "started",
          projectUpdate: "Project is progressing for the initiative rollup.",
        },
      },
    );
    expect(projectPatch.ok()).toBeTruthy();

    await page.goto("/foreverbrowsing/initiatives");
    await page.getByRole("button", { name: /New initiative/ }).click();
    await page.getByPlaceholder("Initiative name").fill(initiativeName);
    await page
      .getByPlaceholder("Summary or initiative document (optional)")
      .fill("Grow the roadmap surface with leadership metadata.");
    await page.getByLabel("Initiative owner").selectOption({ index: 1 });
    await page.getByLabel("Initiative target date").fill("2026-09-30");
    await page.getByLabel("Initiative health").selectOption("onTrack");
    if ((await page.locator('input[name="teamIds"]').count()) > 0) {
      await page.locator('input[name="teamIds"]').first().check();
    }
    await page
      .locator("form")
      .getByRole("button", { name: "Create initiative" })
      .click();

    const row = page
      .getByTestId("initiative-row")
      .filter({ hasText: initiativeName });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText("Unassigned");
    await expect(row).toContainText("ENG");
    await expect(row).toContainText("Sep 30, 2026");
    await expect(row).toContainText("On track");

    await row.click();
    await page
      .getByLabel("Available projects")
      .selectOption({ label: projectName });
    await page.getByRole("button", { name: "Link project" }).click();
    await expect(
      page.getByRole("link", { name: new RegExp(projectName) }),
    ).toBeVisible();

    await page.getByLabel("Initiative update health").selectOption("atRisk");
    await page
      .getByPlaceholder("Post the latest initiative update.")
      .fill("Dependency risk surfaced in the latest roadmap review.");
    await page.getByRole("button", { name: "Post update" }).click();
    await expect(page.getByText("Dependency risk surfaced")).toBeVisible();

    await page.goto("/foreverbrowsing/initiatives");
    const updatedRow = page
      .getByTestId("initiative-row")
      .filter({ hasText: initiativeName });
    await expect(updatedRow).toContainText("At risk");
    await expect(updatedRow).toContainText("1/1 with updates");
  });
});
