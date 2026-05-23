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
          snoozedUntilAt: string | null;
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
          snoozedUntilAt: null,
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

  test("notification row click opens the notification deep link and the CTA opens the issue", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/inbox");

    const row = page
      .getByTestId("notification-row")
      .filter({ hasText: "ENG-179" })
      .first();
    await expect(row).toBeVisible();

    await row.click();

    await expect(page).toHaveURL(
      /\/foreverbrowsing\/inbox\/notification\/[0-9a-f-]+$/,
    );
    await expect(page.getByText("ENG-179").first()).toBeVisible();

    const openIssueLink = page.getByRole("link", { name: "Open issue" });
    await expect(openIssueLink).toHaveAttribute(
      "href",
      "/foreverbrowsing/issue/ENG-179",
    );
    await openIssueLink.click();

    await expect(page).toHaveURL(/\/foreverbrowsing\/issue\/ENG-179$/);
    await expect(page.getByText("ENG-179").first()).toBeVisible();
  });

  test("deep link, unread toggle, and reload keep inbox state", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/inbox");

    const payload = await page.evaluate(async () => {
      const listResponse = await fetch("/api/notifications", {
        credentials: "include",
      });
      const list = (await listResponse.json()) as {
        notifications: Array<{
          id: string;
          type: string;
          issueIdentifier: string;
        }>;
      };
      const target =
        list.notifications.find((item) => item.issueIdentifier === "ENG-179") ??
        list.notifications[0];
      await fetch(`/api/notifications/${target.id}/read`, {
        method: "PATCH",
        credentials: "include",
      });
      return target;
    });

    await page.goto(`/foreverbrowsing/inbox/notification/${payload.id}`);
    await expect(page.getByText(payload.issueIdentifier).first()).toBeVisible();

    await page.getByTestId("mark-unread-action").click();
    await expect(page.getByText(/1 unread/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/1 unread/)).toBeVisible();
    await expect(page.getByTestId("mark-unread-action")).toContainText(
      "Mark read",
    );

    await page.getByTestId("mark-unread-action").click();
    await expect(page.getByText("No unread notifications")).toBeVisible();
  });

  test("snoozed display preference hides and reveals inbox rows", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/inbox");

    const target = await page.evaluate(async () => {
      const listResponse = await fetch("/api/notifications", {
        credentials: "include",
      });
      const list = (await listResponse.json()) as {
        notifications: Array<{ id: string; issueIdentifier: string }>;
      };
      const item =
        list.notifications.find(
          (entry) => entry.issueIdentifier === "ENG-136",
        ) ?? list.notifications[0];
      await fetch(`/api/notifications/${item.id}/snooze`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snoozedUntilAt: "2999-01-01T00:00:00.000Z" }),
      });
      await fetch("/api/account/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountPreferences: {
            inboxDisplay: {
              showReadItems: true,
              showUnreadItemsFirst: true,
              showSnoozedItems: false,
            },
          },
        }),
      });
      return item;
    });

    await page.goto("/foreverbrowsing/inbox");
    await expect(
      page
        .getByTestId("notification-row")
        .filter({ hasText: target.issueIdentifier }),
    ).toHaveCount(0);

    await page
      .getByRole("button", { name: /toggle snoozed notifications visibility/i })
      .click();
    await expect(
      page
        .getByTestId("notification-row")
        .filter({ hasText: target.issueIdentifier }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page
        .getByTestId("notification-row")
        .filter({ hasText: target.issueIdentifier }),
    ).toBeVisible();

    await page.evaluate(async (id) => {
      await fetch(`/api/notifications/${id}/snooze`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snoozedUntilAt: null }),
      });
    }, target.id);
  });
});
