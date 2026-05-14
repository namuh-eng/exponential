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
});
