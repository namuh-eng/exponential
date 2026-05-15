import { expect, test } from "@playwright/test";

test.describe("Sidebar More menu", () => {
  test("exposes Agent, directory links, and persisted sidebar customization", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/my-issues/assigned");

    await page.getByRole("button", { name: "More" }).click();

    await expect(page.getByRole("link", { name: "Agent" })).toHaveAttribute(
      "href",
      "/foreverbrowsing/agent",
    );
    await expect(page.getByRole("link", { name: "Members" })).toHaveAttribute(
      "href",
      "/foreverbrowsing/members",
    );
    await expect(page.getByRole("link", { name: "Teams" })).toHaveAttribute(
      "href",
      "/foreverbrowsing/teams",
    );
    await expect(
      page.getByRole("button", { name: "Customize sidebar" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

    await page.getByRole("button", { name: "Customize sidebar" }).click();
    await expect(
      page.getByRole("dialog", { name: "Customize sidebar" }),
    ).toBeVisible();

    const inboxSwitch = page.getByRole("switch", {
      name: "Inbox visibility",
    });
    const wasInboxVisible =
      (await inboxSwitch.getAttribute("aria-checked")) === "true";

    if (wasInboxVisible) {
      await inboxSwitch.click();
      await expect(page.getByText("Saved")).toBeVisible();
      await page.getByLabel("Close customize sidebar").click();
      await expect(page.getByRole("link", { name: /Inbox/ })).toHaveCount(0);

      await page.reload();
      await expect(page.getByRole("link", { name: /Inbox/ })).toHaveCount(0);

      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("button", { name: "Customize sidebar" }).click();
      await page.getByRole("switch", { name: "Inbox visibility" }).click();
      await expect(page.getByText("Saved")).toBeVisible();
    }

    await page.getByLabel("Close customize sidebar").click();
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("link", { name: "Agent" }).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/agent$/);
    await expect(
      page.getByRole("heading", { name: "Agent", exact: true }),
    ).toBeVisible();
  });
});
