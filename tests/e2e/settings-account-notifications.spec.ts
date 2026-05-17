import { expect, test } from "@playwright/test";

test.describe("account notification settings", () => {
  test("shows Linear-specific domains and persists email digest preference", async ({
    page,
  }) => {
    const resetResponse = await page.request.patch(
      "/api/account/notifications",
      {
        data: {
          accountNotifications: {
            email: { dailyDigest: true, productUpdates: false },
            desktop: { enabled: true, sound: false },
          },
        },
      },
    );
    expect(resetResponse.status()).toBe(200);

    await page.goto("/settings/account/notifications");
    await expect(page.getByText("Notification preferences")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Inbox notification settings/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Email notification settings/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Desktop notification settings/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Slack notification settings/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Mobile notification settings/ }),
    ).toHaveCount(0);

    await page.goto("/settings/account/notifications/email");
    await expect(
      page.getByRole("heading", { name: "Email", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Email notifications" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Digests and product updates" }),
    ).toBeVisible();
    await expect(
      page.getByText("Turning off an event prevents this channel"),
    ).toHaveCount(0);

    const dailyDigest = page.getByRole("switch", { name: "Daily digest" });
    await expect(dailyDigest).toHaveAttribute("aria-checked", "true");
    await dailyDigest.click();
    await expect(dailyDigest).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("switch", { name: "Daily digest" }),
    ).toHaveAttribute("aria-checked", "false");
  });
});
