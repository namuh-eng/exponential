import { expect, test } from "@playwright/test";

async function expectAskAssistantWorks(page: import("@playwright/test").Page) {
  const launcher = page.getByRole("button", { name: "Ask exponential" });
  await expect(launcher).toBeVisible();

  await launcher.click();
  await expect(
    page.getByRole("complementary", { name: "Ask exponential assistant" }),
  ).toBeVisible();
  await expect(page.getByLabel("Ask exponential prompt")).toBeFocused();

  await page
    .getByLabel("Ask exponential prompt")
    .fill("Summarize this workspace");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByText("Summarize this workspace")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Ask exponential is thinking",
  );
  await expect(page.getByText(/I can help with foreverbrowsing/)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("complementary", { name: "Ask exponential assistant" }),
  ).not.toBeVisible();
}

test("global Ask exponential launcher works on an app route", async ({
  page,
}) => {
  await page.goto("/foreverbrowsing/inbox");
  await expectAskAssistantWorks(page);
});

test("global Ask exponential launcher works on a settings route", async ({
  page,
}) => {
  await page.goto("/foreverbrowsing/settings/ai");
  await expectAskAssistantWorks(page);
});

test("command palette Ask exponential action opens the assistant", async ({
  page,
}) => {
  await page.goto("/foreverbrowsing/inbox");
  await page.getByLabel("Search").click();
  await page
    .getByPlaceholder("Type a command or search...")
    .fill("Ask exponential");
  await page
    .getByRole("dialog", { name: "Command palette" })
    .getByRole("button", { name: /Ask exponential/i })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Ask exponential assistant" }),
  ).toBeVisible();
});
