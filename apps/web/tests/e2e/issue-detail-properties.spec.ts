import { expect, test } from "@playwright/test";

const baseIssue = {
  id: "issue-props-1",
  identifier: "ENG-195",
  title: "Editable properties issue",
  description: "Properties should mutate from detail",
  priority: "none",
  state: {
    id: "state-backlog",
    name: "Backlog",
    category: "backlog",
    color: "#6b6f76",
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

type MutableIssueDetail = Omit<
  typeof baseIssue,
  "assignee" | "dueDate" | "priority" | "state"
> & {
  assignee: { id: string; name: string; image: string | null } | null;
  dueDate: string | null;
  priority: string;
  state: { id: string; name: string; category: string; color: string };
};

test.describe("Issue detail editable properties", () => {
  test("edits status, priority, assignee, due date, and relation from sidebar", async ({
    page,
  }) => {
    let issueDetail = structuredClone(baseIssue) as MutableIssueDetail;
    const patchBodies: unknown[] = [];
    const relationBodies: unknown[] = [];

    await page.route("**/api/issues/issue-props-1/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    });

    await page.route("**/api/workspaces/members", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ members: [] }),
      });
    });

    await page.route("**/create-issue-options**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          team: { id: "team-1", name: "Engineering", key: "ENG" },
          statuses: [
            issueDetail.state,
            {
              id: "state-started",
              name: "In Progress",
              category: "started",
              color: "#0ea5e9",
            },
          ],
          priorities: [
            { value: "urgent", label: "Urgent" },
            { value: "high", label: "High" },
            { value: "medium", label: "Medium" },
            { value: "low", label: "Low" },
            { value: "none", label: "No priority" },
          ],
          assignees: [{ id: "user-2", name: "Morgan", image: null }],
          labels: [],
          projects: [],
          cycles: [],
          estimates: [],
        }),
      });
    });

    await page.route("**/api/issues/search?q=ENG", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "issue-target",
            identifier: "ENG-196",
            title: "Target relation issue",
          },
        ]),
      });
    });

    await page.route("**/api/issues/issue-props-1/relations", async (route) => {
      relationBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "relation-1",
          type: "related",
          issue: {
            id: "issue-target",
            identifier: "ENG-196",
            title: "Target relation issue",
          },
        }),
      });
    });

    await page.route("**/api/issues/issue-props-1", async (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        patchBodies.push(body);
        if (body.stateId === "state-started") {
          issueDetail = {
            ...issueDetail,
            state: {
              id: "state-started",
              name: "In Progress",
              category: "started",
              color: "#0ea5e9",
            },
          };
        }
        if (body.priority) {
          issueDetail = { ...issueDetail, priority: body.priority };
        }
        if (body.assigneeId === "user-2") {
          issueDetail = {
            ...issueDetail,
            assignee: { id: "user-2", name: "Morgan", image: null },
          };
        }
        if (body.dueDate !== undefined) {
          issueDetail = {
            ...issueDetail,
            dueDate: body.dueDate ? `${body.dueDate}T00:00:00.000Z` : null,
          };
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(issueDetail),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(issueDetail),
      });
    });

    await page.goto("/team/ENG/issue/issue-props-1");
    await expect(page.getByText("Editable properties issue")).toBeVisible();

    await page.getByRole("button", { name: "Edit status" }).click();
    await page.getByRole("button", { name: "In Progress" }).click();
    await expect(
      page.getByRole("button", { name: "Edit status" }),
    ).toContainText("In Progress");

    await page.getByRole("button", { name: "Edit priority" }).click();
    await page.getByRole("button", { name: "High" }).click();
    await expect(
      page.getByRole("button", { name: "Edit priority" }),
    ).toContainText("High");

    await page.getByRole("button", { name: "Edit assignee" }).click();
    await page.getByRole("button", { name: "Morgan" }).click();
    await expect(
      page.getByRole("button", { name: "Edit assignee" }),
    ).toContainText("Morgan");

    await page.getByRole("button", { name: "Edit due date" }).click();
    await page.getByLabel("Due date value").fill("2026-05-25");
    await expect(
      page.getByRole("button", { name: "Edit due date" }),
    ).toContainText("May 25, 2026");

    await page.locator("button", { hasText: "Add relation" }).last().click();
    await page.getByLabel("Search issues to add Related relation").fill("ENG");
    await page.getByRole("button", { name: /ENG-196/ }).click();
    await expect(
      page.getByText("ENG-196 · Target relation issue"),
    ).toBeVisible();

    expect(patchBodies).toEqual([
      { stateId: "state-started" },
      { priority: "high" },
      { assigneeId: "user-2" },
      { dueDate: "2026-05-25" },
    ]);
    expect(relationBodies).toEqual([
      { type: "related", targetIssueId: "issue-target" },
    ]);
  });
});
