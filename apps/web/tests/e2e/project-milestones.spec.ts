import { expect, test } from "@playwright/test";

test("creates, edits, deletes, and assigns project milestones", async ({
  page,
}) => {
  const suffix = Date.now().toString(36);
  const workspaceSlug = `milestone-qa-${suffix}`;
  const workspaceResponse = await page.request.post("/api/workspaces", {
    data: { name: `Milestone QA ${suffix}`, urlSlug: workspaceSlug },
  });
  expect(workspaceResponse.status()).toBe(201);
  const workspace = await workspaceResponse.json();
  const teamId = workspace.team.id as string;

  const projectResponse = await page.request.post("/api/projects", {
    data: {
      name: `Milestone project ${suffix}`,
      teamId,
      projectMilestones: [{ name: "Plan", description: "Initial scope" }],
    },
    headers: { "x-workspace-slug": workspaceSlug },
  });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json();

  await page.goto(`/${workspaceSlug}/project/${project.slug}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText("Plan", { exact: true })).toBeVisible();
  await expect(page.getByText("Initial scope")).toBeVisible();

  await page.getByRole("button", { name: "Add milestone" }).click();
  await page.getByLabel("Milestone name").fill("Build");
  await page.getByLabel("Milestone description").fill("Build the thing");
  await page.getByRole("button", { name: "Create milestone" }).click();
  await expect(page.getByText("Build")).toBeVisible();
  await expect(page.getByText("Build the thing")).toBeVisible();

  await page.getByRole("button", { name: "Rename Build" }).click();
  await page.getByLabel("Milestone name").fill("Ship");
  await page.getByLabel("Milestone description").fill("Ready to release");
  await page.getByRole("button", { name: "Save milestone" }).click();
  await expect(page.getByText("Ship")).toBeVisible();
  await expect(page.getByText("Ready to release")).toBeVisible();

  const issueResponse = await page.request.post("/api/issues", {
    data: { title: `Milestone issue ${suffix}`, teamId, projectId: project.id },
    headers: { "x-workspace-slug": workspaceSlug },
  });
  expect(issueResponse.status()).toBe(201);
  const issue = await issueResponse.json();

  await page.goto(`/${workspaceSlug}/project/${project.slug}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Issues" }).click();
  await page
    .getByLabel(`Milestone for ${issue.identifier}`)
    .selectOption({ label: "Ship" });
  await expect(
    page.getByLabel(`Milestone for ${issue.identifier}`),
  ).toHaveValue(/.+/);

  await page.getByRole("button", { name: "Delete Plan" }).click();
  await expect(page.getByText("Plan", { exact: true })).toHaveCount(0);

  const detailResponse = await page.request.get(
    `/api/projects/${project.slug}?workspaceSlug=${workspaceSlug}`,
  );
  expect(detailResponse.status()).toBe(200);
  const detail = await detailResponse.json();
  const ship = detail.milestones.find(
    (milestone: { name: string }) => milestone.name === "Ship",
  );
  expect(ship.issueCount).toBe(1);
});
