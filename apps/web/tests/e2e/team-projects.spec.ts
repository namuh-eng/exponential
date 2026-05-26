import { expect, test } from "@playwright/test";

test.describe("Team project creation", () => {
  test("keeps projects created from a team projects empty state scoped to that team", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `team-projects-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Team Projects ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspacePayload = (await workspaceResponse.json()) as {
      team: { key: string; name: string };
    };
    const teamKey = workspacePayload.team.key;
    const teamName = workspacePayload.team.name;
    const projectName = `Onboarding roadmap ${suffix}`;

    await page.goto(`/${workspaceSlug}/team/${teamKey}/projects`);
    await expect(
      page.getByRole("heading", { name: "No projects" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Create project" }).click();
    await page.getByPlaceholder("Project name").fill(projectName);
    await page.getByRole("button", { name: "Create project" }).click();

    await expect(page.getByText(projectName)).toBeVisible();
    await expect(page.getByText("1 of 1 projects")).toBeVisible();

    await page.goto(`/${workspaceSlug}/projects/all`);
    await expect(page.getByText(projectName)).toBeVisible();

    await page.getByRole("link", { name: new RegExp(projectName) }).click();
    await expect(page.getByText("Teams")).toBeVisible();
    await expect(page.getByText(teamName).nth(1)).toBeVisible();
  });
});
