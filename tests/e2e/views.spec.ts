import { expect, test } from "@playwright/test";

test.describe("Workspace Views canonical route", () => {
  test("renders /views canonically and creates issue and project views", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("404")) {
        consoleErrors.push(message.text());
      }
    });

    const suffix = Date.now().toString(36);
    const issueViewName = `Canonical issue view ${suffix}`;
    const projectViewName = `Canonical project view ${suffix}`;

    await page.goto("/views");
    await expect(page).toHaveURL(/\/foreverbrowsing\/views$/);
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Issues" })).toHaveAttribute(
      "data-active",
      "true",
    );

    await page.goto("/foreverbrowsing/inbox");
    await page.locator('a[href="/foreverbrowsing/views"]').first().click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/views$/);
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Create view").first().click();
    await expect(page.getByText("Filters")).toBeVisible();
    await expect(page.getByText("Display options")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "timeline", exact: true }),
    ).toBeVisible();
    await page.getByPlaceholder("View name").fill(issueViewName);
    await page.getByRole("button", { name: "timeline", exact: true }).click();
    await page.getByLabel("Select issue group by").selectOption("assignee");
    await page.getByLabel("Select issue order by").selectOption("updated");
    await page.getByRole("button", { name: /^Create$/ }).click();
    await expect(page.getByText(issueViewName)).toBeVisible();
    await expect(page).toHaveURL(/\/foreverbrowsing\/views$/);
    await page.getByText(issueViewName).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/.+\/timeline$/);
    await page.goto("/views");

    await page.getByRole("button", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/views$/);
    await expect(
      page.getByRole("button", { name: "Projects" }),
    ).toHaveAttribute("data-active", "true");

    await page.getByLabel("Create view").first().click();
    await page.getByPlaceholder("View name").fill(projectViewName);
    await page.getByRole("button", { name: /^Create$/ }).click();
    await expect(page.getByText(projectViewName)).toBeVisible();
    await expect(page).toHaveURL(/\/foreverbrowsing\/views$/);

    await page.goto("/views/all");
    await expect(page).toHaveURL(/\/views\/all$/);
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Issues" })).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.getByRole("button", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/views\/all$/);
    await expect(
      page.getByRole("button", { name: "Projects" }),
    ).toHaveAttribute("data-active", "true");

    await page.goto("/foreverbrowsing/views/all");
    await expect(page).toHaveURL(/\/foreverbrowsing\/views\/all$/);
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();

    await page.goto("/views/issues");
    await expect(page).toHaveURL(/\/foreverbrowsing\/views\/issues$/);
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Issues" })).toHaveAttribute(
      "data-active",
      "true",
    );

    await page.goto("/views/projects");
    await expect(page).toHaveURL(/\/foreverbrowsing\/views\/projects$/);
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Projects" }),
    ).toHaveAttribute("data-active", "true");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Team Views tab routes", () => {
  test("direct slug-prefixed and legacy team views tab routes render the team Views shell", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/team/ENG/views");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/views$/);
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Issues" })).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    for (const tab of ["issues", "projects"] as const) {
      await page.goto(`/foreverbrowsing/team/ENG/views/${tab}`);
      await expect(page).toHaveURL(
        new RegExp(`/foreverbrowsing/team/ENG/views/${tab}$`),
      );
      await expect(
        page.getByRole("heading", { name: "Views", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Engineering", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: tab === "issues" ? "Issues" : "Projects",
        }),
      ).toHaveAttribute("data-active", "true");
      await expect(
        page.getByText("This page could not be found"),
      ).not.toBeVisible();
    }

    await page.goto("/team/ENG/views/projects");
    await expect(page).toHaveURL(
      /\/foreverbrowsing\/team\/ENG\/views\/projects$/,
    );
    await expect(
      page.getByRole("heading", { name: "Views", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Projects" }),
    ).toHaveAttribute("data-active", "true");
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.getByRole("button", { name: "Issues" }).click();
    await expect(page).toHaveURL(
      /\/foreverbrowsing\/team\/ENG\/views\/issues$/,
    );
    await expect(page.getByRole("button", { name: "Issues" })).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    const suffix = Date.now().toString(36);
    const workspaceSlug = `team-views-routes-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Team Views Routes ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/team/ENG/views`);
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/team/ENG/views$`),
    );
    await expect(page.getByText("Team not found")).toBeVisible();
    await expect(
      page.getByText(
        "The team ENG doesn't exist or you don't have access to it.",
      ),
    ).toBeVisible();
    await expect(page.getByText("High priority onboarding")).not.toBeVisible();
  });
});
