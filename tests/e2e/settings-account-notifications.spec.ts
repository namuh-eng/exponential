import { expect, test } from "@playwright/test";

test.describe("account notification settings", () => {
  test("shows granular channel events and persists a newly added category", async ({
    page,
  }) => {
    const resetResponse = await page.request.patch(
      "/api/account/notifications",
      {
        data: {
          accountNotifications: {
            channels: {
              desktop: {
                events: {
                  dueDates: true,
                },
              },
            },
          },
        },
      },
    );
    expect(resetResponse.status()).toBe(200);

    await page.goto("/settings/account/notifications");
    await expect(
      page.getByText(
        "Choose which channels can deliver workspace activity. Notification delivery follows the event preferences configured for each channel.",
      ),
    ).toBeVisible();
    await expect(page.getByText(/\b(clone|demo)\b/i)).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /Desktop notification settings/ }),
    ).toContainText("10 others");
    await expect(
      page.getByRole("link", { name: /Mobile notification settings/ }),
    ).toContainText("Enabled for all notifications");

    await page.goto("/settings/account/notifications/desktop");
    await expect(page.getByRole("heading", { name: "Desktop" })).toBeVisible();
    await expect(
      page.getByText(
        "Turning off an event prevents this channel from sending notifications for that activity. If all channels are disabled for an event, you won't receive notifications for it.",
      ),
    ).toBeVisible();
    await expect(page.getByText(/\b(clone|demo)\b/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Issues" })).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Projects, cycles, and initiatives",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Documents and workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Project updates" }),
    ).toBeVisible();

    const dueDatesSwitch = page.getByRole("switch", {
      name: "Due dates and reminders",
    });
    await expect(dueDatesSwitch).toHaveAttribute("aria-checked", "true");
    await dueDatesSwitch.click();
    await expect(dueDatesSwitch).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("switch", { name: "Due dates and reminders" }),
    ).toHaveAttribute("aria-checked", "false");
  });
});
