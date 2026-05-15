import { expect, test } from "@playwright/test";

const triageIssue = {
  id: "triage-179",
  identifier: "ENG-179",
  title: "Review incoming customer escalation",
  description: "<p>Customer escalation needs product triage.</p>",
  priority: "high",
  stateId: "state-triage",
  stateName: "Triage",
  stateColor: "#f2994a",
  creatorId: "user-1",
  creatorName: "Ashley",
  creatorImage: null,
  assigneeId: null,
  projectId: null,
  projectName: null,
  dueDate: null,
  estimate: null,
  createdAt: "2026-05-14T10:00:00.000Z",
  updatedAt: "2026-05-14T12:00:00.000Z",
  labelIds: [],
  labels: [],
};

const issueDetail = {
  id: "triage-179",
  identifier: "ENG-179",
  title: "Review incoming customer escalation",
  description: "<p>Customer escalation needs product triage.</p>",
  priority: "high",
  state: {
    id: "state-triage",
    name: "Triage",
    category: "triage",
    color: "#f2994a",
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
  discussionSummary: {
    enabled: true,
    text: "1 comment from 1 participant. Latest: Needs review before backlog.",
  },
  comments: [
    {
      id: "comment-1",
      body: "Needs review before backlog.",
      user: { name: "Morgan", image: null },
      createdAt: "2026-05-14T11:00:00.000Z",
      reactions: [],
      attachments: [],
    },
  ],
  subIssues: [],
  createdAt: "2026-05-14T10:00:00.000Z",
  updatedAt: "2026-05-14T12:00:00.000Z",
};

test.describe("Team triage detail review", () => {
  test("opens ENG-179 from click and Enter, then accepts from detail", async ({
    page,
  }) => {
    let accepted = false;

    await page.route("**/api/teams/ENG/triage", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          team: { id: "team-1", name: "Engineering", key: "ENG" },
          issues: accepted ? [] : [triageIssue],
          count: accepted ? 0 : 1,
          createStateId: "state-triage",
          createStateName: "Triage",
          triageEnabled: true,
          acceptDestinationStates: [
            {
              id: "state-backlog",
              name: "Backlog",
              category: "backlog",
              color: "#6b6f76",
              isDefault: true,
            },
            {
              id: "state-ready",
              name: "Ready",
              category: "unstarted",
              color: "#5e6ad2",
            },
          ],
          declineDestinationStates: [
            {
              id: "state-canceled",
              name: "Canceled",
              category: "canceled",
              color: "#95a2b3",
            },
          ],
        }),
      });
    });

    await page.route("**/api/teams/ENG/triage/triage-179", async (route) => {
      expect(route.request().method()).toBe("PATCH");
      expect(await route.request().postDataJSON()).toEqual({
        action: "accept",
        destinationStateId: "state-ready",
        confirmed: true,
      });
      accepted = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: "triage-179" }),
      });
    });

    await page.route("**/api/issues/triage-179/history", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          history: [
            {
              id: "history-1",
              type: "created",
              metadata: {},
              actor: { id: "user-1", name: "Ashley", email: null },
              createdAt: "2026-05-14T10:00:00.000Z",
            },
          ],
        }),
      });
    });

    await page.route("**/api/issues/triage-179", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(issueDetail),
      });
    });

    await page.goto("/foreverbrowsing/team/ENG/triage");

    const row = page.getByTestId("triage-row").filter({ hasText: "ENG-179" });
    await expect(row).toBeVisible();
    await row.click();

    await expect(row).toHaveAttribute("aria-current", "true");
    await expect(
      page.getByRole("region", { name: "ENG-179 triage review" }),
    ).toBeVisible();
    await expect(
      page.getByText("Review incoming customer escalation").last(),
    ).toBeVisible();
    await expect(page.getByText("Triage").last()).toBeVisible();
    await expect(
      page.getByText("Needs review before backlog.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Ashley created this issue")).toBeVisible();

    await row.focus();
    await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-current", "true");

    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Accept triage issue")).toBeVisible();
    await page
      .getByRole("combobox", { name: "Triage destination status" })
      .selectOption("state-ready");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Accept issue" })
      .click();
    await expect(page.getByText("No issues to triage")).toBeVisible();
    await expect(
      page.getByText("Review incoming customer escalation"),
    ).toHaveCount(0);
  });
});
