import { expect, test } from "@playwright/test";

test.describe("Project issues empty state", () => {
  test("creates the first issue from an empty project's Issues tab", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const projectName = `Empty issues project ${suffix}`;
    const projectSlug = `empty-issues-project-${suffix}`;
    const issueTitle = `First project issue ${suffix}`;

    const projectResponse = await page.request.post("/api/projects", {
      data: {
        name: projectName,
        slug: projectSlug,
        description: "Regression target for project issues empty state",
        teamKey: "ENG",
      },
    });
    expect(projectResponse.status()).toBe(201);
    const project = (await projectResponse.json()) as { slug: string };

    await page.goto(`/foreverbrowsing/project/${project.slug}/overview`);
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Issues", exact: true }).click();
    await expect(
      page.getByText("No issues in this project yet."),
    ).toBeVisible();

    await page.getByText("Create issue", { exact: true }).click();
    const composer = page.getByTestId("create-issue-composer");
    await expect(page.getByLabel("Create issue for Engineering")).toBeVisible();
    await expect(
      composer.getByRole("button", { name: "Project" }),
    ).toContainText(projectName);

    await page.getByLabel("Issue title").fill(issueTitle);
    await composer.getByRole("button", { name: "Create Issue" }).click();

    await expect(page.getByLabel("Create issue for Engineering")).toHaveCount(
      0,
    );
    await expect(page.getByText(issueTitle)).toBeVisible();
  });
});
