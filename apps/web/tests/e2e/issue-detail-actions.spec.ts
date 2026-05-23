import { expect, test } from "@playwright/test";

const issueDetail = {
  id: "ENG-179",
  identifier: "ENG-173",
  title: "Actions issue",
  description: "Actions should mutate",
  priority: "medium",
  state: {
    id: "state-1",
    name: "Todo",
    category: "unstarted",
    color: "#999999",
  },
  assignee: null,
  creator: { name: "Ashley", image: null },
  team: { id: "team-1", name: "Engineering", key: "ENG" },
  project: null,
  dueDate: null,
  estimate: null,
  cycle: null,
  parentIssue: null,
  relations: [],
  labels: [],
  reactions: [],
  comments: [],
  subIssues: [],
  createdAt: "2026-04-23T09:00:00.000Z",
  updatedAt: "2026-04-23T10:00:00.000Z",
};

test.describe("Issue detail actions", () => {
  test("archive confirms, sends a PATCH mutation, and shows feedback", async ({
    page,
  }) => {
    const patchBodies: unknown[] = [];

    await page.route("**/api/issues/ENG-179/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    });
    await page.route("**/api/issues/ENG-179", async (route) => {
      if (route.request().method() === "PATCH") {
        patchBodies.push(route.request().postDataJSON());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...issueDetail,
            archivedAt: "2026-05-14T12:00:00.000Z",
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(issueDetail),
      });
    });

    await page.goto("/team/ENG/issue/ENG-179");
    await expect(page.getByText("Actions issue")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();

    await expect(
      page.getByText("Issue archived and hidden from active lists."),
    ).toBeVisible();
    expect(patchBodies).toEqual([{ archive: true }]);
  });

  test("delete requires confirmation before DELETE and navigates after success", async ({
    page,
  }) => {
    const deleteRequests: string[] = [];

    await page.route("**/api/issues/ENG-179/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    });
    await page.route("**/api/issues/ENG-179", async (route) => {
      if (route.request().method() === "DELETE") {
        deleteRequests.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(issueDetail),
      });
    });

    await page.goto("/team/ENG/issue/ENG-179");
    await expect(page.getByText("Actions issue")).toBeVisible();

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    expect(deleteRequests).toHaveLength(0);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("menuitem", { name: "Delete" }).click();

    await page.waitForURL(/\/team\/ENG\/all$/);
    expect(deleteRequests).toHaveLength(1);
  });

  test("workspace-prefixed sub-issue links use issue identifiers", async ({
    page,
  }) => {
    const parentIssue = {
      ...issueDetail,
      id: "5efda6f1-6ac0-45f8-b383-a4f3bb872a8d",
      identifier: "ENG-173",
      title: "Parent issue with child",
      subIssues: [
        {
          id: "bcf4e6bf-4b72-480f-a301-c6ec8d4bc90d",
          identifier: "ENG-174",
          title: "Child issue keeps canonical URL",
          priority: "medium",
          state: {
            name: "Todo",
            category: "unstarted",
            color: "#999999",
          },
        },
      ],
    };
    const childIssue = {
      ...issueDetail,
      id: "bcf4e6bf-4b72-480f-a301-c6ec8d4bc90d",
      identifier: "ENG-174",
      title: "Child issue keeps canonical URL",
      subIssues: [],
    };

    await page.route("**/api/issues/*/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    });
    await page.route("**/api/issues/ENG-173", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(parentIssue),
      });
    });
    await page.route("**/api/issues/ENG-174", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(childIssue),
      });
    });

    await page.goto("/foreverbrowsing/team/ENG/issue/ENG-173");
    await expect(page.getByText("Parent issue with child")).toBeVisible();

    const childLink = page
      .locator('a[href="/foreverbrowsing/team/ENG/issue/ENG-174"]')
      .filter({ hasText: "Child issue keeps canonical URL" });
    await expect(childLink).toHaveAttribute(
      "href",
      "/foreverbrowsing/team/ENG/issue/ENG-174",
    );

    await childLink.click();
    await expect(page).toHaveURL(
      /\/foreverbrowsing\/team\/ENG\/issue\/ENG-174$/,
    );
    await expect(
      page.getByText("Child issue keeps canonical URL"),
    ).toBeVisible();
  });
});

test.describe("Issue detail relation management", () => {
  test("adds and removes a relation from the properties panel", async ({
    page,
  }) => {
    const createdRelation = {
      id: "rel-duplicate",
      type: "duplicate",
      issue: {
        id: "issue-duplicate",
        identifier: "ENG-180",
        title: "Duplicate candidate",
      },
    };
    const postBodies: unknown[] = [];
    const deleteUrls: string[] = [];

    await page.route("**/api/issues/ENG-179/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    });
    await page.route("**/api/issues/search**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "issue-duplicate",
            identifier: "ENG-180",
            title: "Duplicate candidate",
          },
        ]),
      });
    });
    await page.route("**/api/issues/ENG-179/relations", async (route) => {
      postBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(createdRelation),
      });
    });
    await page.route(
      "**/api/issues/ENG-179/relations/rel-duplicate",
      async (route) => {
        deleteUrls.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      },
    );
    await page.route("**/api/issues/ENG-179", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(issueDetail),
      });
    });

    await page.goto("/team/ENG/issue/ENG-179");
    await expect(page.getByText("Actions issue")).toBeVisible();

    await page.getByRole("button", { name: "Add relation" }).nth(2).click();
    await page
      .getByLabel("Search issue to add Duplicate relation")
      .fill("ENG-180");
    await page.getByRole("button", { name: /ENG-180/ }).click();

    await expect(
      page.getByRole("button", { name: "ENG-180 · Duplicate candidate" }),
    ).toBeVisible();
    expect(postBodies).toEqual([
      { type: "duplicate", targetIssueId: "issue-duplicate" },
    ]);

    await page
      .getByRole("button", { name: "Remove Duplicate relation to ENG-180" })
      .click();
    await expect(
      page.getByRole("button", { name: "ENG-180 · Duplicate candidate" }),
    ).toHaveCount(0);
    expect(deleteUrls).toHaveLength(1);
  });
});
