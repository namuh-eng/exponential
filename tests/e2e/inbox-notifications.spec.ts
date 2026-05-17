import { expect, test } from "@playwright/test";

test.describe("Canonical inbox notifications", () => {
  test("API returns seeded read notification history for the test session", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/inbox");

    const payload = await page.evaluate(async () => {
      const response = await fetch("/api/notifications", {
        credentials: "include",
      });
      return response.json() as Promise<{
        notifications: Array<{
          actorName: string;
          issueIdentifier: string;
          issueTitle: string;
          readAt: string | null;
          type: string;
        }>;
        unreadCount: number;
      }>;
    });

    expect(payload.unreadCount).toBe(0);
    expect(payload.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorName: "Ashley Ha",
          issueIdentifier: "ENG-179",
          issueTitle: "Issue added to FOREVER-AGENT",
          readAt: expect.any(String),
          type: "status_change",
        }),
        expect.objectContaining({
          actorName: "Ashley Ha",
          issueIdentifier: "ENG-136",
          readAt: expect.any(String),
          type: "assigned",
        }),
      ]),
    );
  });

  test("renders Linear-style all-read notification history instead of empty state", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/inbox");

    await expect(page.getByText("You're all caught up")).not.toBeVisible();
    await expect(page.getByText("ENG-179").first()).toBeVisible();
    await expect(
      page.getByText("Issue added to FOREVER-AGENT").first(),
    ).toBeVisible();
    await expect(page.getByText("ENG-136").first()).toBeVisible();
    await expect(
      page.getByText("assigned the issue to you").first(),
    ).toBeVisible();
    await expect(page.getByText("No unread notifications")).toBeVisible();
  });

  test("notification row click opens the referenced issue directly", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/inbox");

    const row = page
      .getByTestId("notification-row")
      .filter({ hasText: "ENG-179" })
      .first();
    await expect(row).toBeVisible();

    await row.click();

    await expect(page).toHaveURL(/\/foreverbrowsing\/issue\/ENG-179$/);
    await expect(page.getByText("ENG-179").first()).toBeVisible();
    await expect(
      page.getByText("Issue added to FOREVER-AGENT").first(),
    ).toBeVisible();
  });

  test("notification row keyboard activation opens the referenced issue", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/inbox");

    const row = page
      .getByTestId("notification-row")
      .filter({ hasText: "ENG-179" })
      .first();
    await expect(row).toBeVisible();

    await row.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/foreverbrowsing\/issue\/ENG-179$/);

    await page.goto("/foreverbrowsing/inbox");
    const spaceRow = page
      .getByTestId("notification-row")
      .filter({ hasText: "ENG-179" })
      .first();
    await expect(spaceRow).toBeVisible();

    await spaceRow.focus();
    await page.keyboard.press("Space");

    await expect(page).toHaveURL(/\/foreverbrowsing\/issue\/ENG-179$/);
  });

  test("Open issue CTA navigates from workspace inbox to selected issue detail", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/inbox");

    await expect(page.getByText("ENG-179").first()).toBeVisible();
    await expect(
      page.getByText("Issue added to FOREVER-AGENT").first(),
    ).toBeVisible();

    const openIssueLink = page.getByRole("link", { name: "Open issue" });
    await expect(openIssueLink).toHaveAttribute(
      "href",
      "/foreverbrowsing/issue/ENG-179",
    );

    await openIssueLink.click();

    await expect(page).toHaveURL(/\/foreverbrowsing\/issue\/ENG-179$/);
    await expect(page.getByText("ENG-179").first()).toBeVisible();
    await expect(
      page.getByText("Issue added to FOREVER-AGENT").first(),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Inbox" })).toHaveCount(0);
    await expect(
      page.getByText("This page could not be found"),
    ).not.toBeVisible();
  });
});
