import { expect, test } from "@playwright/test";

test.describe("Workspace Views canonical route", () => {
  test("renders /views canonically and creates issue and project views", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("404")) {
        consoleErrors.push(message.text());
      }
    });

    const suffix = Date.now().toString(36);
    const issueViewName = `Canonical issue view ${suffix}`;
    const projectViewName = `Canonical project view ${suffix}`;

    await page.goto("/views");
    await expect(page).toHaveURL(/\/foreverbrowsing\/views$/);
    await expect(page.getByRole("heading", { name: "Views" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Issues" })).toHaveAttribute(
      "data-active",
      "true",
    );

    await page.goto("/foreverbrowsing/inbox");
    await page.locator('a[href="/foreverbrowsing/views"]').first().click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/views$/);
    await expect(page.getByRole("heading", { name: "Views" })).toBeVisible();

    await page.getByLabel("Create view").first().click();
    await page.getByPlaceholder("View name").fill(issueViewName);
    await page.getByRole("button", { name: /^Create$/ }).click();
    await expect(page.getByText(issueViewName)).toBeVisible();
    await expect(page).toHaveURL(/\/foreverbrowsing\/views$/);

    await page.getByRole("button", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/foreverbrowsing\/views$/);
    await expect(
      page.getByRole("button", { name: "Projects" }),
    ).toHaveAttribute("data-active", "true");

    await page.getByLabel("Create view").first().click();
    await page.getByPlaceholder("View name").fill(projectViewName);
    await page.getByRole("button", { name: /^Create$/ }).click();
    await expect(page.getByText(projectViewName)).toBeVisible();
    await expect(page).toHaveURL(/\/foreverbrowsing\/views$/);

    await page.goto("/views/issues");
    await expect(page).toHaveURL(/\/foreverbrowsing\/views\/issues$/);
    await expect(page.getByRole("heading", { name: "Views" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Issues" })).toHaveAttribute(
      "data-active",
      "true",
    );

    await page.goto("/views/projects");
    await expect(page).toHaveURL(/\/foreverbrowsing\/views\/projects$/);
    await expect(page.getByRole("heading", { name: "Views" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Projects" }),
    ).toHaveAttribute("data-active", "true");

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
