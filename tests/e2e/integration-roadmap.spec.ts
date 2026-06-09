import { expect, test } from "@playwright/test";
import { createIsolatedTestSession } from "./test-session";

test.describe("Integration parity roadmap", () => {
  test("shows Linear provider backlog and build order on integrations settings", async ({
    page,
  }) => {
    await createIsolatedTestSession(page, "integration-roadmap");
    const suffix = Date.now().toString(36);
    const workspaceSlug = `integration-roadmap-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: { name: `Integration Roadmap ${suffix}`, urlSlug: workspaceSlug },
    });
    expect(workspaceResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/settings/integrations`);

    await expect(
      page.getByRole("heading", { name: "Integration build order" }),
    ).toBeVisible();
    await expect(page.getByText("P0 - build first")).toBeVisible();
    await expect(page.getByText("Shared integration platform")).toBeVisible();
    await expect(page.getByRole("link", { name: "#568" })).toHaveAttribute(
      "href",
      "https://github.com/namuh-eng/exponential/issues/568",
    );
    await expect(page.getByText("P1 - core product parity")).toBeVisible();
    await expect(page.getByText("Jira sync and guided import")).toBeVisible();
    await expect(
      page.getByText("P2 - high-value ecosystem parity"),
    ).toBeVisible();
    await expect(page.getByText("Remote MCP server")).toBeVisible();
    await expect(page.getByText("P3 - analytics/expansion")).toBeVisible();
    await expect(page.getByText("Gong customer call context")).toBeVisible();

    await page.getByRole("button", { name: "Explore integrations" }).click();
    const dialog = page.getByRole("dialog", { name: "Explore integrations" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "GitLab" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "MCP" })).toBeVisible();
    await expect(
      dialog.getByText("MCP setup follows roadmap issue #590"),
    ).toBeVisible();
  });
});
