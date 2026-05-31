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

    // The sidebar carries the terminal self-host status strip.
    const strip = page.getByTestId("sidebar-status-strip");
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("self-hosted");
    await expect(strip).toContainText("v0.4.2");

    await page.screenshot({
      path: testInfo.outputPath("tty-theme-inbox.png"),
      fullPage: true,
    });
  });
});
