import { type Page, expect } from "@playwright/test";

export async function expandAppSidebar(page: Page) {
  const showSidebarButton = page.getByRole("button", { name: "Show sidebar" });
  const workspaceSwitcher = page.getByRole("button", {
    name: "Workspace switcher",
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await workspaceSwitcher.isVisible()) {
      await expect(page.getByTestId("app-sidebar-shell")).toBeVisible();
      return;
    }

    await expect(showSidebarButton).toBeVisible();
    await showSidebarButton.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await page.waitForTimeout(250);
  }

  await expect(workspaceSwitcher).toBeVisible();
  await expect(page.getByTestId("app-sidebar-shell")).toBeVisible();
}
