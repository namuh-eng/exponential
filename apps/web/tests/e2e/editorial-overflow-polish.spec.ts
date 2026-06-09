import { expect, test } from "@playwright/test";

async function expectNoViewportHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const metrics = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    overflowingElements: Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          testId: element.getAttribute("data-testid"),
          className: element.getAttribute("class"),
          right: Math.ceil(rect.right),
          left: Math.floor(rect.left),
        };
      })
      .filter((entry) => entry.right > window.innerWidth + 1 || entry.left < -1)
      .slice(0, 8),
  }));

  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(
    metrics.viewportWidth + 1,
  );
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(
    metrics.viewportWidth + 1,
  );
  expect(metrics.overflowingElements).toEqual([]);
}

test.describe("Editorial app-surface overflow polish", () => {
  test.use({ viewport: { width: 1280, height: 820 } });

  test("inbox keeps the preview readable without horizontal overflow", async ({
    page,
  }, testInfo) => {
    await page.goto("/foreverbrowsing/inbox");

    await expect(page.getByText("Inbox").first()).toBeVisible();
    await expect(
      page.getByText("Issue added to FOREVER-AGENT").first(),
    ).toBeVisible();

    const previewTitle = page.getByRole("heading", {
      name: "Issue added to FOREVER-AGENT",
    });
    await expect(previewTitle).toBeVisible();

    const titleBox = await previewTitle.boundingBox();
    expect(titleBox?.width ?? 0).toBeGreaterThan(280);

    await expectNoViewportHorizontalOverflow(page);

    const scrollbarColor = await page
      .locator(".editorial-page-surface")
      .evaluate((element) => getComputedStyle(element).scrollbarColor);
    expect(scrollbarColor).not.toBe("auto");

    await page.screenshot({
      path: testInfo.outputPath("editorial-overflow-inbox.png"),
      fullPage: true,
    });
  });

  test("team issues list has toned active state hooks and no horizontal overflow", async ({
    page,
  }, testInfo) => {
    await page.goto("/foreverbrowsing/team/ENG/all");

    await expect(
      page.getByRole("heading", { name: "Engineering" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All issues", exact: true }),
    ).toBeVisible();
    await expectNoViewportHorizontalOverflow(page);

    const activeTabBackground = await page
      .getByRole("button", { name: "All issues", exact: true })
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(activeTabBackground).not.toBe("rgba(0, 0, 0, 0)");

    await page.screenshot({
      path: testInfo.outputPath("editorial-overflow-team-issues.png"),
      fullPage: true,
    });
  });
});
