import { expect, test } from "@playwright/test";

async function ensureThumbsUpRemoved(page: import("@playwright/test").Page) {
  const issueResponse = await page.request.get("/api/issues/ENG-179");
  expect(issueResponse.ok()).toBeTruthy();
  const issue = (await issueResponse.json()) as {
    reactions?: { emoji: string; reactedByMe?: boolean }[];
  };

  if (
    issue.reactions?.some(
      (reaction) => reaction.emoji === "👍" && reaction.reactedByMe,
    )
  ) {
    const removeResponse = await page.request.post(
      "/api/issues/ENG-179/reactions",
      {
        data: { emoji: "👍" },
      },
    );
    expect(removeResponse.ok()).toBeTruthy();
  }
}

test.describe("Issue detail reactions", () => {
  test("persists issue-level reaction add and remove across refresh", async ({
    page,
  }) => {
    await ensureThumbsUpRemoved(page);

    await page.goto("/foreverbrowsing/team/ENG/issue/ENG-179");
    await expect(page.getByText("Issue reactions")).toBeVisible();

    const thumbsUp = page.getByLabel("Issue reaction 👍");
    await thumbsUp.click();
    await expect(page.getByLabel("Issue reaction 👍 selected")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("👍 reaction saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Issue reaction 👍 selected")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByLabel("Issue reaction 👍 selected").click();
    await expect(page.getByLabel("Issue reaction 👍")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByText("👍 reaction removed.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Issue reaction 👍")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
