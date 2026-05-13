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
});
