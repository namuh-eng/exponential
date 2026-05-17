import { expect, test } from "@playwright/test";

async function expectRenderedAppPage(page: import("@playwright/test").Page) {
  await expect(
    page.getByText("This page could not be found"),
  ).not.toBeVisible();
}

test.describe("Canonical Forever Browsing routes", () => {
  test("canonicalizes My Issues personal routes and tab navigation to Forever Browsing", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const staleWorkspaceSlug = `root-redirect-${suffix}`;

    const staleWorkspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Root Redirect ${suffix}`,
        urlSlug: staleWorkspaceSlug,
      },
    });
    expect(staleWorkspaceResponse.status()).toBe(201);

    await page.goto(`/${staleWorkspaceSlug}/inbox`);
    await expect(page.getByLabel("Workspace switcher")).toContainText(
      "Root Redirect",
    );

    const sessionResponse = await page.evaluate(async () => {
      const response = await fetch("/api/test/create-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com" }),
      });

      return {
        status: response.status,
        workspaceSlug: (
          (await response.json()) as { workspace?: { urlSlug?: string } }
        ).workspace?.urlSlug,
      };
    });
    expect(sessionResponse).toEqual({
      status: 200,
      workspaceSlug: "foreverbrowsing",
    });

    await page.goto("/my-issues/assigned");
    await expect(page).toHaveURL(/\/foreverbrowsing\/my-issues\/assigned$/);
    await expect(
      page.getByRole("heading", { name: "My Issues" }),
    ).toBeVisible();
    await expect(page.getByLabel("Workspace switcher")).toContainText(
      "Forever Browsing",
    );
    await expect(
      page.getByRole("link", { name: /My Issues/ }).first(),
    ).toHaveAttribute("href", "/foreverbrowsing/my-issues/assigned");

    for (const tab of ["created", "subscribed", "activity", "assigned"]) {
      await page.getByRole("button", { name: new RegExp(tab, "i") }).click();
      await expect(page).toHaveURL(
        new RegExp(`/foreverbrowsing/my-issues/${tab}$`),
      );
    }
  });

  test("renders canonical workspace/team deep links and redirects legacy ENG route", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/inbox");
    await expect(page).toHaveURL(/\/foreverbrowsing\/inbox$/);
    await expect(page.getByText("Inbox").first()).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/foreverbrowsing/team/ENG/all");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/all$/);
    await expect(
      page.getByText(
        "The team ENG doesn't exist or you don't have access to it.",
      ),
    ).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All issues" }),
    ).toBeVisible();
    await expect(
      page.locator('a[href="/foreverbrowsing/team/ENG/all"]').first(),
    ).toHaveAttribute("href", "/foreverbrowsing/team/ENG/all");

    await page.goto("/foreverbrowsing/team/ENG/board");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/board$/);
    await expect(
      page.getByText(
        "The team ENG doesn't exist or you don't have access to it.",
      ),
    ).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(page.getByText("Backlog").first()).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/foreverbrowsing/team/ENG/cycles");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/cycles$/);
    await expect(
      page.getByText(
        "The team ENG doesn't exist or you don't have access to it.",
      ),
    ).not.toBeVisible();
    await expect(page.getByText("Cycles").first()).toBeVisible();

    await page.goto("/team/ENG/all");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/all$/);
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All issues" }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/team/ENG/board");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/board$/);
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(page.getByText("Backlog").first()).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/foreverbrowsing/team/ENG/projects");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/projects$/);
    await expect(
      page.getByRole("heading", { name: /Engineering Projects|No projects/ }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
    await expect(
      page.locator('a[href="/foreverbrowsing/team/ENG/projects"]').first(),
    ).toHaveAttribute("href", "/foreverbrowsing/team/ENG/projects");

    await page.goto("/team/ENG/projects");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/projects$/);
    await expect(
      page.getByRole("heading", { name: /Engineering Projects|No projects/ }),
    ).toBeVisible();
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.goto("/foreverbrowsing/inbox");
    await page
      .getByRole("link", { name: /Issues icon Issues/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/all$/);
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();

    await page.getByLabel("Search").click();
    await page.getByPlaceholder("Type a command or search...").fill("board");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/board$/);
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
  });

  test("team issue list counts match visible all, active, and backlog rows", async ({
    page,
  }) => {
    const routes = ["all", "active", "backlog"] as const;

    for (const route of routes) {
      await page.goto(`/foreverbrowsing/team/ENG/${route}`);
      await expect(page).toHaveURL(
        new RegExp(`/foreverbrowsing/team/ENG/${route}$`),
      );
      await expect(
        page.getByRole("heading", { name: "Engineering" }),
      ).toBeVisible();

      const visibleIssueRows = page.locator('a[href*="/team/ENG/issue/"]');
      const visibleIssueCount = await visibleIssueRows.count();
      await expect(
        page.getByText(`${visibleIssueCount} issues`, { exact: true }),
      ).toHaveCount(2);

      if (route === "active") {
        expect(visibleIssueCount).toBe(0);
        await expect(page.getByText("5 issues", { exact: true })).toHaveCount(
          0,
        );
      }
    }
  });

  test("issue detail canonical routes render and Back to issues lands on workspace team all", async ({
    page,
  }) => {
    await page.goto("/team/ENG/issue/ENG-1");
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/issue\/ENG-1$/);
    await expect(page.getByText("ENG-1").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to issues" }),
    ).toBeVisible();
    await expectRenderedAppPage(page);

    await page.getByRole("link", { name: "Back to issues" }).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/team\/ENG\/all$/);
    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All issues" }),
    ).toBeVisible();
    await expectRenderedAppPage(page);

    await page.goto("/issue/ENG-1");
    await expect(page).toHaveURL(/\/foreverbrowsing\/issue\/ENG-1$/);
    await expect(page.getByText("ENG-1").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to issues" }),
    ).toBeVisible();
    await expectRenderedAppPage(page);
  });
});
