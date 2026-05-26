import { expect, test } from "@playwright/test";

type EditorialFlow = {
  name: string;
  path: string;
  assertVisible: (page: import("@playwright/test").Page) => Promise<void>;
};

const flows: EditorialFlow[] = [
  {
    name: "app shell inbox",
    path: "/foreverbrowsing/inbox",
    assertVisible: async (page) => {
      await expect(page.getByText("Inbox").first()).toBeVisible();
      await expect(page.getByLabel("Search")).toBeVisible();
    },
  },
  {
    name: "issue list",
    path: "/foreverbrowsing/my-issues/assigned",
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", { name: "My Issues" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Assigned/i }),
      ).toBeVisible();
    },
  },
  {
    name: "team board",
    path: "/foreverbrowsing/team/ENG/board",
    assertVisible: async (page) => {
      await expect(page.getByText("Backlog").first()).toBeVisible();
    },
  },
  {
    name: "project list",
    path: "/foreverbrowsing/projects/all",
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", { name: /Projects|No projects/ }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /New project|Create project/ }),
      ).toBeVisible();
    },
  },
  {
    name: "settings form",
    path: "/foreverbrowsing/settings/account/profile",
    assertVisible: async (page) => {
      await expect(
        page.getByRole("heading", { name: "Profile" }),
      ).toBeVisible();
      await expect(page.getByRole("textbox").first()).toBeVisible();
    },
  },
];

const tokenNames = [
  "--editorial-bg",
  "--editorial-surface",
  "--editorial-line",
  "--editorial-accent",
  "--editorial-display",
  "--color-content-bg",
  "--color-border",
  "--color-accent",
];

async function expectEditorialTokens(page: import("@playwright/test").Page) {
  const shell = page.locator('[data-editorial-theme="product"]');
  await expect(shell).toBeVisible();

  const tokenState = await page.evaluate((names) => {
    const styles = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      names.map((name) => [name, styles.getPropertyValue(name).trim()]),
    );
  }, tokenNames);

  expect(["#faf7f2", "#15130f"]).toContain(tokenState["--color-content-bg"]);
  expect(["#e2dccd", "#2e2a22"]).toContain(tokenState["--color-border"]);
  expect(tokenState["--editorial-accent"].length).toBeGreaterThan(0);
  expect(tokenState["--color-accent"].length).toBeGreaterThan(0);
  expect(tokenState["--editorial-display"]).toContain("Georgia");
}

async function expectNoHardcodedRegression(
  page: import("@playwright/test").Page,
) {
  const rogueInlineStyles = await page
    .locator(
      '[style*="#fff"], [style*="#000"], [style*="rgb(255, 255, 255)"], [style*="rgb(0, 0, 0)"]',
    )
    .count();
  expect(rogueInlineStyles).toBe(0);

  const sampledColors = await page.evaluate(() => {
    const selectors = [
      "main",
      "aside",
      "button",
      "a",
      "input",
      "[role='dialog']",
    ];
    return selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector))
        .slice(0, 8)
        .map((element) => {
          const styles = getComputedStyle(element);
          return {
            selector,
            background: styles.backgroundColor,
            color: styles.color,
            border: styles.borderColor,
          };
        }),
    );
  });

  expect(
    sampledColors.some(({ background, border }) =>
      [background, border].some((value) => value !== "rgba(0, 0, 0, 0)"),
    ),
  ).toBeTruthy();
}

test.describe("Editorial theme visual QA smoke", () => {
  for (const flow of flows) {
    test(`${flow.name} uses editorial tokens and captures evidence`, async ({
      page,
    }, testInfo) => {
      await page.goto(flow.path);
      await flow.assertVisible(page);
      await expectEditorialTokens(page);
      await expectNoHardcodedRegression(page);

      await page.screenshot({
        path: testInfo.outputPath(
          `editorial-theme-${flow.name.replaceAll(" ", "-")}.png`,
        ),
        fullPage: true,
      });
    });
  }

  test("command palette and creation dialog inherit editorial surfaces", async ({
    page,
  }, testInfo) => {
    await page.goto("/foreverbrowsing/team/ENG/all");
    await expectEditorialTokens(page);

    await page.getByLabel("Search").click();
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await expect(
      page.getByPlaceholder("Type a command or search..."),
    ).toBeFocused();
    await expectNoHardcodedRegression(page);
    await page.screenshot({
      path: testInfo.outputPath("editorial-theme-command-palette.png"),
      fullPage: true,
    });

    await page.keyboard.press("Escape");
    await expect(palette).not.toBeVisible();
    await page
      .getByRole("button", { name: /Create issue|New issue/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByLabel("Issue title")).toBeVisible();
    await expectNoHardcodedRegression(page);
    await page.screenshot({
      path: testInfo.outputPath("editorial-theme-create-issue-dialog.png"),
      fullPage: true,
    });
  });
});
