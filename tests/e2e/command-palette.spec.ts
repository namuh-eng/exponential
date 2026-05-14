import { expect, test } from "@playwright/test";

const dialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const searchInput = (page: import("@playwright/test").Page) =>
  page.getByPlaceholder("Type a command or search...");

async function expectPaletteOpen(page: import("@playwright/test").Page) {
  await expect(dialog(page)).toBeVisible();
  await expect(searchInput(page)).toBeVisible();
  await expect(searchInput(page)).toBeFocused();
  await expect(page.getByText("Navigation")).toBeVisible();
}

async function gotoProjectsWithShortcutReady(
  page: import("@playwright/test").Page,
) {
  await page.goto("/foreverbrowsing/projects");
  await expect(page.getByLabel("Search")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    document.body.focus();
  });
}

test.describe("Command Palette", () => {
  test("opens with Ctrl+K on workspace projects and closes with Escape", async ({
    page,
  }) => {
    await gotoProjectsWithShortcutReady(page);

    await page.keyboard.press("Control+K");
    await expectPaletteOpen(page);

    await page.keyboard.press("Escape");
    await expect(dialog(page)).not.toBeVisible();
  });

  test("opens with Meta+K on workspace projects", async ({ page }) => {
    await gotoProjectsWithShortcutReady(page);

    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "K",
          code: "KeyK",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expectPaletteOpen(page);
  });

  test("does not open with Cmd/Ctrl+K from editable targets", async ({
    page,
  }) => {
    await gotoProjectsWithShortcutReady(page);

    await page.evaluate(() => {
      const input = document.createElement("input");
      input.setAttribute("aria-label", "Shortcut suppression input");
      document.body.appendChild(input);
      input.focus();
    });
    await page.keyboard.press("Control+k");
    await expect(dialog(page)).not.toBeVisible();

    await page.evaluate(() => {
      const input = document.querySelector(
        'input[aria-label="Shortcut suppression input"]',
      );
      input?.remove();
      const editor = document.createElement("div");
      editor.contentEditable = "true";
      editor.setAttribute("aria-label", "Shortcut suppression editor");
      editor.textContent = "Editable content";
      document.body.appendChild(editor);
      editor.focus();
    });
    await page.keyboard.press("Meta+k");
    await expect(dialog(page)).not.toBeVisible();
  });

  test("opens from the sidebar Search button", async ({ page }) => {
    await gotoProjectsWithShortcutReady(page);

    await page.getByLabel("Search").click();

    await expectPaletteOpen(page);
  });

  test("shows commands and allows keyboard navigation", async ({ page }) => {
    await page.goto("/inbox");

    await page.getByLabel("Search").click();

    const input = searchInput(page);
    await expect(input).toBeVisible();

    await expect(
      page.getByRole("button", { name: /Create new issue/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Open last issue/i }),
    ).toBeVisible();
    await expect(page.getByText("More actions")).toBeVisible();

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(dialog(page)).toBeVisible();
  });

  test("filters commands by search query", async ({ page }) => {
    await page.goto("/inbox");

    await page.getByLabel("Search").click();

    const input = searchInput(page);
    await expect(input).toBeVisible();
    await input.fill("inbox");

    // Should filter to only matching commands
    await expect(dialog(page).getByText("Go to Inbox")).toBeVisible();

    // Non-matching commands should be hidden
    await expect(dialog(page).getByText("Create new issue")).not.toBeVisible();
  });

  test("navigates to page when command selected", async ({ page }) => {
    await page.goto("/inbox");

    await page.getByLabel("Search").click();
    const input = searchInput(page);
    await expect(input).toBeVisible();
    await input.fill("inbox");
    await page.keyboard.press("Enter");

    // Should navigate to inbox
    await page.waitForURL("**/inbox");
  });
});
