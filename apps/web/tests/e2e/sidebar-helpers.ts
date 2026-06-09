import { type Page, expect } from "@playwright/test";

export async function expandAppSidebar(page: Page) {
  const hideSidebarButton = page.getByRole("button", { name: "Hide sidebar" });
  const showSidebarButton = page.getByRole("button", { name: "Show sidebar" });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await hideSidebarButton.isVisible()) {
      await expect(page.getByTestId("app-sidebar-shell")).toBeVisible();
      return;
    }

    await expect(showSidebarButton).toBeVisible();
    await showSidebarButton.click();
    await page.waitForTimeout(250);
  }

  await expect(hideSidebarButton).toBeVisible();
  await expect(page.getByTestId("app-sidebar-shell")).toBeVisible();
}
