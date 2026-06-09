import { expect, test } from "@playwright/test";

const issueDetail = {
  id: "i-1",
  identifier: "ENG-1",
  title: "Persisted history issue",
  description: "History should render",
  priority: "low",
  state: { id: "s-1", name: "Backlog", category: "backlog", color: "#ccc" },
  assignee: null,
  creator: { name: "Ashley", image: null },
  team: { id: "t-1", name: "Engineering", key: "ENG" },
  project: null,
  labels: [],
  reactions: [],
  comments: [
    {
      id: "c-1",
      body: "Existing comment stays visible",
      user: { name: "System", image: null },
      createdAt: "2026-04-23T11:00:00.000Z",
      reactions: [],
      attachments: [],
    },
  ],
  subIssues: [],
  createdAt: "2026-04-23T09:00:00.000Z",
  updatedAt: "2026-04-23T10:00:00.000Z",
};

test.describe("Issue detail activity history", () => {
  test("loads persisted history while preserving comments", async ({
    page,
  }) => {
    const issueRequests: string[] = [];
    const historyRequests: string[] = [];

    await page.route("**/api/issues/i-1/history", async (route) => {
      historyRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          history: [
            {
              id: "h1",
              type: "created",
              metadata: {
                identifier: "ENG-1",
                title: "Persisted history issue",
              },
              actor: { id: "u-1", name: "Ashley", email: "ashley@example.com" },
              createdAt: "2026-04-23T09:00:00.000Z",
            },
            {
              id: "h2",
              type: "updated",
              metadata: { changedFields: ["title", "stateId"] },
              actor: { id: "u-2", name: "Morgan", email: "morgan@example.com" },
              createdAt: "2026-04-23T10:00:00.000Z",
            },
            {
              id: "h3",
              type: "comment_created",
              metadata: { commentId: "c-1" },
              actor: { id: "u-3", name: "System", email: "system@example.com" },
              createdAt: "2026-04-23T11:00:00.000Z",
            },
          ],
        }),
      });
    });

    await page.route("**/api/issues/i-1", async (route) => {
      issueRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(issueDetail),
      });
    });

    await page.goto("/team/ENG/issue/i-1");

    await expect(page.getByText("Persisted history issue")).toBeVisible();
    await expect(page.getByText("Ashley created this issue")).toBeVisible();
    await expect(
      page.getByText("Morgan updated title and status"),
    ).toBeVisible();
    await expect(page.getByText("System added a comment")).toBeVisible();
    await expect(
      page.getByText("Existing comment stays visible"),
    ).toBeVisible();
    expect(issueRequests.length).toBeGreaterThan(0);
    expect(historyRequests.length).toBeGreaterThan(0);
  });

  test("shows a history error without hiding comments", async ({ page }) => {
    await page.route("**/api/issues/i-1/history", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: "{}",
      });
    });

    await page.route("**/api/issues/i-1", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(issueDetail),
      });
    });

    await page.goto("/team/ENG/issue/i-1");

    await expect(page.getByText("Persisted history issue")).toBeVisible();
    await expect(
      page.getByText(
        "Couldn’t load activity history. Comments are still available.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Existing comment stays visible"),
    ).toBeVisible();
  });
});
