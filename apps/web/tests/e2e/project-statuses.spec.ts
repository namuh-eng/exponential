import { expect, test } from "@playwright/test";

test.describe("Project status settings", () => {
  test("edits, reorders, saves, and persists workspace project statuses", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `project-statuses-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Project Statuses ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/project-statuses`);
    await page.addStyleTag({
      content:
        '[aria-label="Ask exponential"], [aria-label="Ask exponential assistant"], [aria-label="Open Next.js Dev Tools"] { display: none !important; }',
    });
    await expect(
      page.getByRole("heading", { name: "Project statuses" }),
    ).toBeVisible();
    await expect(page.getByText("Project statuses are read-only")).toHaveCount(
      0,
    );

    const customName = `Blocked ${suffix}`;
    await page.getByRole("button", { name: "New status" }).click();
    await page.locator('input[value="New status"]').fill(customName);
    await page
      .locator('input[value="Describe when projects should use this status."]')
      .fill("Waiting on another team");
    await page.locator('input[value="#6b6f76"]').last().fill("#8844ff");
    await page.getByRole("button", { name: "Up" }).last().click();
    await page
      .getByRole("button", { name: "Save changes" })
      .click({ force: true });

    await expect(page.getByText("Project statuses saved.")).toBeVisible();
    await expect(page.locator(`input[value="${customName}"]`)).toBeVisible();
    await expect(
      page.locator('input[value="Waiting on another team"]'),
    ).toBeVisible();

    await page.reload();
    await expect(page.locator(`input[value="${customName}"]`)).toBeVisible();
    await expect(
      page.locator('input[value="Waiting on another team"]'),
    ).toBeVisible();

    const apiResponse = await page.request.get("/api/project-statuses");
    expect(apiResponse.status()).toBe(200);
    const payload = await apiResponse.json();
    expect(payload.customStatusesSupported).toBe(true);
    expect(payload.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: customName,
          description: "Waiting on another team",
        }),
      ]),
    );

    const projectName = `Custom Status Project ${suffix}`;
    const createProjectResponse = await page.request.post("/api/projects", {
      data: { name: projectName },
      headers: { referer: `http://localhost/${workspaceSlug}/projects` },
    });
    expect(createProjectResponse.status()).toBe(201);
    const createdProject = await createProjectResponse.json();

    await page.goto(
      `/${workspaceSlug}/project/${createdProject.slug}/overview`,
    );
    await page.addStyleTag({
      content:
        '[aria-label="Ask exponential"], [aria-label="Ask exponential assistant"], [aria-label="Open Next.js Dev Tools"] { display: none !important; }',
    });
    await expect(page.getByText(projectName)).toBeVisible();
    await page.getByRole("button", { name: "Edit" }).last().click();
    await page
      .locator('label:has-text("Status") select')
      .selectOption({ label: `• ${customName}` });
    await page.getByRole("button", { name: "Save" }).click({ force: true });
    await expect(
      page.locator("span").filter({ hasText: customName }).first(),
    ).toBeVisible();

    const projectResponse = await page.request.get(
      `/api/projects/${createdProject.slug}?workspaceSlug=${workspaceSlug}`,
    );
    expect(projectResponse.status()).toBe(200);
    const projectPayload = await projectResponse.json();
    expect(projectPayload.project).toEqual(
      expect.objectContaining({
        status: expect.any(String),
        statusLabel: customName,
      }),
    );

    const countsResponse = await page.request.get("/api/project-statuses");
    expect(countsResponse.status()).toBe(200);
    const countsPayload = await countsResponse.json();
    expect(countsPayload.statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: customName, projectCount: 1 }),
      ]),
    );
  });
  test("applies a custom project status from the project properties modal", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `project-status-apply-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Project Status Apply ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    const customName = `Blocked ${suffix}`;
    const statusesResponse = await page.request.patch("/api/project-statuses", {
      data: {
        statuses: [
          {
            id: "planned",
            key: "planned",
            name: "Planned",
            description: "Planned",
            color: "#6b6f76",
            icon: "○",
          },
          {
            id: "started",
            key: "started",
            name: "In progress",
            description: "Started",
            color: "#b58900",
            icon: "◐",
          },
          {
            id: "paused",
            key: "paused",
            name: "Paused",
            description: "Paused",
            color: "#6b6f76",
            icon: "Ⅱ",
          },
          {
            id: "completed",
            key: "completed",
            name: "Completed",
            description: "Completed",
            color: "#2e7d32",
            icon: "✓",
          },
          {
            id: "canceled",
            key: "canceled",
            name: "Canceled",
            description: "Canceled",
            color: "#6b6f76",
            icon: "×",
          },
          {
            id: `blocked_${suffix}`,
            key: `blocked_${suffix}`,
            name: customName,
            description: "Waiting on another team",
            color: "#8844ff",
            icon: "!",
          },
        ],
      },
    });
    expect(statusesResponse.status()).toBe(200);

    const projectName = `Apply status ${suffix}`;
    const projectResponse = await page.request.post("/api/projects", {
      data: { name: projectName, description: "Custom status target" },
      headers: { referer: `http://localhost:7015/${workspaceSlug}/projects` },
    });
    expect(projectResponse.status()).toBe(201);
    const project = (await projectResponse.json()) as { slug: string };

    await page.goto(`/${workspaceSlug}/project/${project.slug}/overview`);
    await expect(
      page.getByRole("heading", { name: projectName }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).nth(1).click();
    await page.locator("select").first().selectOption(`blocked_${suffix}`);
    await page.getByRole("button", { name: "Save" }).click({ force: true });

    await expect(page.getByText(customName).first()).toBeVisible();

    const projectDetailResponse = await page.request.get(
      `/api/projects/${project.slug}?workspaceSlug=${workspaceSlug}`,
    );
    expect(projectDetailResponse.status()).toBe(200);
    const projectDetail = await projectDetailResponse.json();
    expect(projectDetail.project.status).toBe(`blocked_${suffix}`);
    expect(projectDetail.project.statusLabel).toBe(customName);
  });
});
