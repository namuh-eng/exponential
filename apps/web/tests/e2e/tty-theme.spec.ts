import { expect, test } from "@playwright/test";

const ttyTokens = [
  "--editorial-bg",
  "--editorial-accent",
  "--editorial-display",
  "--editorial-mono",
  "--color-content-bg",
];

test.describe("TTY terminal redesign", () => {
  test("app shell renders the phosphor-on-graphite, monospace TTY chrome", async ({
    page,
  }, testInfo) => {
    await page.goto("/foreverbrowsing/inbox");

    const shell = page.locator('[data-editorial-theme="product"]');
    await expect(shell).toBeVisible();

    const tokens = await page.evaluate((names) => {
      const styles = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        names.map((name) => [name, styles.getPropertyValue(name).trim()]),
      );
    }, ttyTokens);

    // Graphite background + paper-terminal light variant.
    expect(["#0c0d0c", "#f0eee9"]).toContain(tokens["--editorial-bg"]);
    expect(["#0c0d0c", "#f0eee9"]).toContain(tokens["--color-content-bg"]);
    // Phosphor-green accent (dark) or darkened phosphor (light paper).
    expect(["#7ee787", "#1f7a37"]).toContain(tokens["--editorial-accent"]);
    // Monospace everywhere — display, body and mono all resolve to mono.
    expect(tokens["--editorial-display"]).toContain("monospace");
    expect(tokens["--editorial-mono"]).toContain("monospace");

    // The sidebar carries terminal build provenance without runtime status claims.
    const strip = page.getByTestId("sidebar-status-strip");
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute("aria-label", "Build provenance");
    await expect(strip).toContainText("frontend shell");
    await expect(strip).toContainText("provenance");
    await expect(strip).toContainText(/version:unknown|v\d+\.\d+\.\d+/);
    await expect(strip).not.toContainText("main@a3f10c2");
    await expect(strip).not.toContainText("v0.4.2");
    await expect(strip).not.toContainText("self-hosted");
    await expect(strip).not.toContainText("ELv2");

    await expect(page.getByTestId("tty-route-status-bar")).toBeVisible();
    await expect(page.getByTestId("tty-shortcut-status-bar")).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("tty-theme-inbox.png"),
      fullPage: true,
    });
  });
});
