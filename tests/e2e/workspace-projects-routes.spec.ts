import { expect, test } from "@playwright/test";

async function expectProjectsListRendered(
  page: import("@playwright/test").Page,
  projectName: string,
) {
  await expect(page.getByText("All projects")).toBeVisible();
  await expect(page.getByLabel("Filter projects by status")).toBeVisible();
  await expect(page.getByLabel("Sort projects")).toBeVisible();
  await expect(
    page.getByTestId("project-row").filter({ hasText: projectName }),
  ).toBeVisible();
  await expect(
    page.getByText("404: This page could not be found."),
  ).toHaveCount(0);
  await expect(page.getByText("This page could not be found")).toHaveCount(0);
}

test.describe("Workspace Projects routes", () => {
  test("root and slug-prefixed projects routes render the workspace projects list", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const projectName = `Workspace projects route ${suffix}`;
    const projectSlug = `workspace-projects-route-${suffix}`;

    const projectResponse = await page.request.post("/api/projects", {
      data: {
        name: projectName,
        slug: projectSlug,
        description: "Regression target for workspace projects routing",
      },
    });
    expect(projectResponse.status()).toBe(201);

    await page.goto("/projects");
    await expect(page).toHaveURL(/\/foreverbrowsing\/projects$/);
    await expectProjectsListRendered(page, projectName);

    await page.goto("/projects/all");
    await expect(page).toHaveURL(/\/foreverbrowsing\/projects\/all$/);
    await expectProjectsListRendered(page, projectName);

    await page.goto("/foreverbrowsing/projects");
    await expect(page).toHaveURL(/\/foreverbrowsing\/projects$/);
    await expectProjectsListRendered(page, projectName);

    await page.goto("/foreverbrowsing/projects/all");
    await expect(page).toHaveURL(/\/foreverbrowsing\/projects\/all$/);
    await expectProjectsListRendered(page, projectName);
  });

  test("sidebar Workspace Projects link lands on the working slug-prefixed projects page", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const projectName = `Sidebar workspace project ${suffix}`;

    const projectResponse = await page.request.post("/api/projects", {
      data: {
        name: projectName,
        description: "Regression target for sidebar workspace projects link",
      },
    });
    expect(projectResponse.status()).toBe(201);

    await page.goto("/foreverbrowsing/inbox");
    const projectsLink = page.getByRole("link", { name: /Projects/ }).first();
    await expect(projectsLink).toHaveAttribute(
      "href",
      "/foreverbrowsing/projects/all",
    );
    await projectsLink.click();

    await expect(page).toHaveURL(/\/foreverbrowsing\/projects\/all$/);
    await expectProjectsListRendered(page, projectName);
  });
});
