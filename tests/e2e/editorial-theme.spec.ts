import { expect, test } from "@playwright/test";

const flows = [
  { name: "issue list", path: "/foreverbrowsing/my-issues" },
  { name: "project list", path: "/foreverbrowsing/projects" },
  { name: "settings", path: "/foreverbrowsing/settings/account/profile" },
];

test.describe("Editorial theme smoke", () => {
  for (const flow of flows) {
    test(`${flow.name} uses editorial tokens`, async ({ page }) => {
      await page.goto(flow.path);
      const shell = page.locator('[data-editorial-theme="product"]');
      await expect(shell).toBeVisible();

      const tokenState = await page.evaluate(() => {
        const styles = getComputedStyle(document.documentElement);
        return {
          content: styles.getPropertyValue("--color-content-bg").trim(),
          border: styles.getPropertyValue("--color-border").trim(),
          accent: styles.getPropertyValue("--color-accent").trim(),
          display: styles.getPropertyValue("--editorial-display").trim(),
        };
      });

      expect(["#faf7f2", "#15130f"]).toContain(tokenState.content);
      expect(["#e2dccd", "#2e2a22"]).toContain(tokenState.border);
      expect(tokenState.accent.length).toBeGreaterThan(0);
      expect(tokenState.display).toContain("Georgia");

      await page.screenshot({
        path: `test-results/editorial-theme-${flow.name.replaceAll(" ", "-")}.png`,
        fullPage: true,
      });
    });
  }
});
