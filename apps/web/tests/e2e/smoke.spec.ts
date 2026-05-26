import { expect, test } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("app loads and returns HTML", async ({ page }) => {
    const response = await page.goto("/");
    expect(response).not.toBeNull();
    expect(response?.status()).toBeLessThan(500);
  });
});
