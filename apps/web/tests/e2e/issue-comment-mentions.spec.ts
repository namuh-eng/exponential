import { expect, test } from "@playwright/test";

const issueDetail = {
  id: "ENG-319",
  identifier: "ENG-319",
  title: "Mention picker issue",
  description: "Comments should mention workspace members",
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
  createdAt: "2026-05-15T09:00:00.000Z",
  updatedAt: "2026-05-15T10:00:00.000Z",
};

const membersResponse = {
  workspaceId: "workspace-1",
  currentUserId: "actor-1",
  viewerRole: "member",
  canInviteMembers: false,
  members: [
    {
      id: "member-sam-1",
      kind: "member",
      userId: "sam-1",
      name: "Sam Lee",
      email: "sam.one@example.com",
      image: null,
      role: "member",
      status: "active",
      teams: ["Engineering"],
      joinedAt: "2026-05-01T00:00:00.000Z",
      lastSeenAt: null,
    },
    {
      id: "member-sam-2",
      kind: "member",
      userId: "sam-2",
      name: "Sam Lee",
      email: "sam.two@example.com",
      image: null,
      role: "member",
      status: "active",
      teams: ["Engineering"],
      joinedAt: "2026-05-01T00:00:00.000Z",
      lastSeenAt: null,
    },
    {
      id: "member-ashley-1",
      kind: "member",
      userId: "ashley-1",
      name: "Ashley Ha",
      email: "ashley@example.com",
      image: null,
      role: "member",
      status: "active",
      teams: ["Engineering"],
      joinedAt: "2026-05-01T00:00:00.000Z",
      lastSeenAt: null,
    },
  ],
};

test.describe("Issue comment mentions", () => {
  test("opens searchable picker from @, selects duplicate-name member, submits canonical mention, and renders chip", async ({
    page,
  }) => {
    let commentPostBody = "";

    await page.route("**/api/workspaces/members", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(membersResponse),
      });
    });
    await page.route("**/api/issues/ENG-319/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    });
    await page.route("**/api/issues/ENG-319/comments", async (route) => {
      commentPostBody = route.request().postData() ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "comment-mention-1",
          body: "Please review @[Sam Lee](user:sam-2)",
          user: { name: "Ashley", image: null },
          createdAt: "2026-05-15T11:00:00.000Z",
          reactions: [],
          attachments: [],
        }),
      });
    });
    await page.route("**/api/issues/ENG-319", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(issueDetail),
      });
    });

    await page.goto("/team/ENG/issue/ENG-319");
    await expect(page.getByText("Mention picker issue")).toBeVisible();

    const composer = page.getByPlaceholder("Leave a comment...");
    await composer.fill("Please review @sam");
    await expect(
      page.getByRole("menu", { name: "Mention members" }),
    ).toBeVisible();
    await expect(page.getByText("sam.two@example.com")).toBeVisible();

    await page.getByText("sam.two@example.com").click();
    await expect(page.getByLabel("Selected mentions")).toContainText(
      "@Sam Lee",
    );
    await expect(composer).toHaveValue("Please review @[Sam Lee](user:sam-2) ");

    await page.getByRole("button", { name: "Comment" }).click();

    await expect(page.locator("#comment-comment-mention-1")).toContainText(
      "@Sam Lee",
    );
    expect(commentPostBody).toContain("mentionedUserIds");
    expect(commentPostBody).toContain("sam-2");
    expect(commentPostBody).toContain("Please review @[Sam Lee](user:sam-2)");
  });

  test("Mention toolbar opens picker and Escape dismisses it", async ({
    page,
  }) => {
    await page.route("**/api/workspaces/members", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(membersResponse),
      });
    });
    await page.route("**/api/issues/ENG-319/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    });
    await page.route("**/api/issues/ENG-319", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(issueDetail),
      });
    });

    await page.goto("/team/ENG/issue/ENG-319");
    await expect(page.getByText("Mention picker issue")).toBeVisible();

    await page.getByRole("button", { name: "Mention" }).click();
    await expect(
      page.getByRole("menu", { name: "Mention members" }),
    ).toBeVisible();

    await page.getByPlaceholder("Leave a comment...").press("Escape");
    await expect(
      page.getByRole("menu", { name: "Mention members" }),
    ).toHaveCount(0);
  });
});
