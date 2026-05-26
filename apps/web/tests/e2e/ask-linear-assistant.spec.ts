import { expect, test } from "@playwright/test";

async function expectAskLinearWorks(page: import("@playwright/test").Page) {
  const launcher = page.getByRole("button", { name: "Ask Linear" });
  await expect(launcher).toBeVisible();

  await launcher.click();
  await expect(
    page.getByRole("complementary", { name: "Ask Linear assistant" }),
  ).toBeVisible();
  await expect(page.getByLabel("Ask Linear prompt")).toBeFocused();

  await page.getByLabel("Ask Linear prompt").fill("Summarize this workspace");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Summarize this workspace")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Ask Linear is thinking",
  );
  await expect(page.getByText(/I can help with foreverbrowsing/)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("complementary", { name: "Ask Linear assistant" }),
  ).not.toBeVisible();
}

test("global Ask Linear launcher works on an app route", async ({ page }) => {
  await page.goto("/foreverbrowsing/inbox");
  await expectAskLinearWorks(page);
});

test("global Ask Linear launcher works on a settings route", async ({
  page,
}) => {
  await page.goto("/foreverbrowsing/settings/ai");
  await expectAskLinearWorks(page);
});

test("command palette Ask Linear action opens the assistant", async ({
  page,
}) => {
  await page.goto("/foreverbrowsing/inbox");
  await page.getByLabel("Search").click();
  await page.getByPlaceholder("Type a command or search...").fill("Ask Linear");
  await page
    .getByRole("dialog", { name: "Command palette" })
    .getByRole("button", { name: /Ask Linear/i })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Ask Linear assistant" }),
  ).toBeVisible();
});
