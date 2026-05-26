import { expect, test } from "@playwright/test";

const dialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Command palette" });
const searchInput = (page: import("@playwright/test").Page) =>
  page.getByPlaceholder("Type a command or search...");

async function expectPaletteOpen(page: import("@playwright/test").Page) {
  await expect(dialog(page)).toBeVisible();
  await expect(searchInput(page)).toBeVisible();
  await expect(searchInput(page)).toBeFocused();
  await expect(
    dialog(page).getByText("Navigation", { exact: true }),
  ).toBeVisible();
}

async function openPaletteFromSidebar(page: import("@playwright/test").Page) {
  await expect(page.getByLabel("Search")).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.getByLabel("Search").click();
  await expectPaletteOpen(page);
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

test("New project update command opens a project picker and composer", async ({
  page,
}) => {
  const projectName = `Palette Update ${Date.now()}`;
  const projectResponse = await page.request.post("/api/projects", {
    data: {
      name: projectName,
      description: "Created for command palette update composer coverage",
      teamKey: "ENG",
    },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const projectPayload = await projectResponse.json();
  const projectSlug = projectPayload.slug;

  await page.goto("/foreverbrowsing/team/ENG/all");
  await page.getByLabel("Search").click();
  await page.getByRole("button", { name: /New project update/i }).click();

  const picker = page.getByRole("dialog", {
    name: "Choose a project for update",
  });
  await expect(picker).toBeVisible();
  await expect(page.getByLabel("Search projects for update")).toBeFocused();

  await page.getByLabel("Search projects for update").fill(projectName);
  await page.getByRole("button", { name: new RegExp(projectName) }).click();

  await expect(page).toHaveURL(
    new RegExp(
      `/foreverbrowsing/project/${projectSlug}/overview\\?newUpdate=1`,
    ),
  );
  await expect(page.getByLabel("Project update")).toBeVisible();
  await expect(page.getByLabel("Project update")).toBeFocused();
});

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

  test("routes issue search results to canonical team issue paths", async ({
    page,
  }) => {
    await page.route("**/api/issues/search**", async (route) => {
      await route.fulfill({
        json: [
          {
            id: "dead-route-uuid",
            identifier: "ENG-179",
            title: "Palette routing regression",
            priority: "high",
            teamKey: "ENG",
            path: "/team/ENG/issue/ENG-179",
          },
        ],
      });
    });

    await page.goto("/foreverbrowsing/team/ENG/all");
    await openPaletteFromSidebar(page);

    await searchInput(page).fill("ENG-179");
    await expect(
      dialog(page).getByRole("button", {
        name: /ENG-179 Palette routing regression/i,
      }),
    ).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      /\/foreverbrowsing\/team\/ENG\/issue\/ENG-179$/,
    );

    await page.goto("/foreverbrowsing/team/ENG/all");
    await openPaletteFromSidebar(page);
    await searchInput(page).fill("ENG-179");

    await dialog(page)
      .getByRole("button", {
        name: /ENG-179 Palette routing regression/i,
      })
      .click();
    await expect(page).toHaveURL(
      /\/foreverbrowsing\/team\/ENG\/issue\/ENG-179$/,
    );
  });
});
