import { expect, test } from "@playwright/test";
import { expandAppSidebar } from "./sidebar-helpers";

function parseRgb(value: string) {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) {
    throw new Error(`Unsupported color: ${value}`);
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function relativeLuminance([red, green, blue]: readonly number[]) {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLum = relativeLuminance(parseRgb(foreground));
  const backgroundLum = relativeLuminance(parseRgb(background));
  const light = Math.max(foregroundLum, backgroundLum);
  const dark = Math.min(foregroundLum, backgroundLum);

  return (light + 0.05) / (dark + 0.05);
}

test.describe("Sidebar resize, contrast, and logout", () => {
  test("recovers from corrupted sidebar state and supports divider resize/collapse", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("exponential:sidebar-collapsed", "false");
      window.localStorage.setItem(
        "exponential:sidebar-width",
        `Infinity<script>alert("skip verification")</script>`,
      );
    });

    await page.goto("/foreverbrowsing/my-issues/assigned");
    await expect(
      page.getByRole("button", { name: "Workspace switcher" }),
    ).toBeVisible();

    const sidebarShell = page.getByTestId("app-sidebar-shell");
    await expect(sidebarShell).toHaveCSS("width", "264px");

    const handle = page.getByTestId("sidebar-resize-handle");
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 54, box.y + box.height / 2);
    await page.mouse.up();

    await expect(sidebarShell).toHaveCSS("width", "318px");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("exponential:sidebar-width"),
        ),
      )
      .toBe("318");

    await handle.click();
    await expect(
      page.getByRole("button", { name: "Show sidebar" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Workspace switcher" }),
    ).toBeHidden();
  });

  test("keeps accent action text readable in the TTY theme", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/initiatives");

    const newInitiative = page.getByRole("button", { name: "New initiative" });
    await expect(newInitiative).toBeVisible();

    const colors = await newInitiative.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        color: style.color,
      };
    });

    expect(
      contrastRatio(colors.color, colors.background),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("exposes logout from the workspace dropdown and posts sign-out", async ({
    page,
  }) => {
    await page.goto("/foreverbrowsing/my-issues/assigned");
    await expandAppSidebar(page);

    let signOutRequested = false;
    await page.route("**/api/auth/sign-out", async (route) => {
      signOutRequested = true;
      await route.fulfill({ status: 204, body: "" });
    });

    await page.getByRole("button", { name: "Workspace switcher" }).click();
    const logout = page.getByRole("button", { name: "Log out" });
    await expect(logout).toBeVisible();

    await logout.click();

    await expect.poll(() => signOutRequested).toBe(true);
    await expect(page).toHaveURL(/\/login$/);
  });
});
