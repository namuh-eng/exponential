import { expect, test } from "@playwright/test";

async function openKeyboardShortcuts(page: import("@playwright/test").Page) {
  await page.goto("/foreverbrowsing/inbox");
  await page.getByRole("button", { name: "Help" }).evaluate((button) => {
    if (button instanceof HTMLElement) {
      button.click();
    }
  });
  await page
    .getByRole("button", { name: "Keyboard shortcuts" })
    .evaluate((button) => {
      if (button instanceof HTMLElement) {
        button.click();
      }
    });
}

test("keyboard shortcuts help is an accessible modal with focus containment", async ({
  page,
}) => {
  await openKeyboardShortcuts(page);

  const helpDialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(helpDialog).toBeVisible();
  await expect(helpDialog).toHaveAttribute("aria-modal", "true");
  await expect(
    page.getByRole("button", { name: "Close shortcuts" }),
  ).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Close shortcuts" }),
  ).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(helpDialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Help" })).toBeFocused();
});

test("slash opens command search instead of keyboard shortcuts help", async ({
  page,
}) => {
  await page.goto("/foreverbrowsing/inbox");
  await page.getByRole("button", { name: "Search" }).waitFor();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    document.body.focus();
  });
  await page.waitForTimeout(500);
  await page.keyboard.press("/");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Type a command or search..."),
  ).toBeFocused();
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).not.toBeVisible();
});
