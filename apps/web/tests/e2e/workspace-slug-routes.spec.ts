import { expect, test } from "@playwright/test";

test.describe("Workspace slug routes", () => {
  test("renders slug-prefixed inbox, settings, team routes and emits slug links", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `slug-routes-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Slug Routes ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspacePayload = (await workspaceResponse.json()) as {
      team: { key: string };
    };
    const teamKey = workspacePayload.team.key;

    await page.goto(`/${workspaceSlug}`);
    await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/inbox$`));

    await page.goto(`/${workspaceSlug}/inbox`);
    await expect(page.getByText("Inbox").first()).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await expect(
      page.getByRole("link", { name: "Projects" }).first(),
    ).toHaveAttribute("href", `/${workspaceSlug}/projects/all`);

    await page.goto(`/${workspaceSlug}/settings/account/notifications`);
    await expect(
      page.getByRole("heading", { name: "Notifications" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Preferences" }),
    ).toHaveAttribute("href", `/${workspaceSlug}/settings/account/preferences`);

    await page.goto(`/${workspaceSlug}/team/${teamKey}/all`);
    await expect(
      page.getByRole("heading", { name: "No issues" }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    const insightsLink = page.getByRole("link", { name: "Insights" });
    await expect(insightsLink).toHaveAttribute(
      "href",
      `/${workspaceSlug}/team/${teamKey}/analytics`,
    );
    await insightsLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/team/${teamKey}/analytics$`),
    );
    await expect(page.getByText("Linear Insights")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Analytics/ }),
    ).toBeVisible();

    await page.goto(`/${workspaceSlug}/team/${teamKey}/analytics`);
    await expect(page.getByText("Linear Insights")).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto(`/${workspaceSlug}/team/${teamKey}/insights`);
    await expect(page.getByText("Linear Insights")).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.getByRole("link", { name: "Inbox" }).click();
    await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/inbox$`));

    await page.getByLabel("Search").click();
    await page.getByPlaceholder("Type a command or search...").fill("inbox");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/inbox$`));
  });

  test("renders workspace-prefixed project list and detail routes", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `project-routes-${suffix}`;
    const projectName = `Workspace routed project ${suffix}`;
    const projectSlug = `workspace-routed-project-${suffix}`;

    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Project Routes ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    const projectResponse = await page.request.post("/api/projects", {
      data: {
        name: projectName,
        slug: projectSlug,
        description: "Project route smoke target",
      },
    });
    expect(projectResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/projects`);
    await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/projects$`));
    await expect(page.getByText(projectName)).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto(`/${workspaceSlug}/projects/all`);
    await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/projects/all$`));
    const projectLink = page.getByRole("link", {
      name: new RegExp(projectName),
    });
    await expect(projectLink).toHaveAttribute(
      "href",
      `/${workspaceSlug}/project/${projectSlug}/overview`,
    );
    await projectLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/project/${projectSlug}/overview$`),
    );
    await expect(
      page.getByRole("heading", { name: projectName }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/project/${projectSlug}/overview$`),
    );
    await expect(
      page.getByRole("heading", { name: projectName }),
    ).toBeVisible();

    await page.goto(`/project/${projectSlug}/overview`);
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/project/${projectSlug}/overview$`),
    );
    await expect(
      page.getByRole("heading", { name: projectName }),
    ).toBeVisible();
  });

  test("redirects root app routes to the active workspace slug", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `root-redirect-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Root Redirect ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto("/inbox");
    await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/inbox$`));
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
  });
});
