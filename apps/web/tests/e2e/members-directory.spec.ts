import { expect, test } from "@playwright/test";

test.describe("Members directory", () => {
  test("searches members, shows no-results, and opens profile details", async ({
    page,
  }) => {
    const sessionResponse = await page.request.get("/api/auth/get-session");
    expect(sessionResponse.ok()).toBeTruthy();
    const session = (await sessionResponse.json()) as {
      user?: { email?: string | null; name?: string | null };
    } | null;
    const email = session?.user?.email ?? "test@example.com";
    const displayName = session?.user?.name ?? email;

    await page.goto("/members");

    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByText(/\d+ members?/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Inbox/ }).first(),
    ).toBeVisible();

    const search = page.getByLabel("Search members");
    await expect(search).toBeVisible();
    await search.fill(email);
    await expect(page.getByText(email).first()).toBeVisible();
    await expect(page).toHaveURL(/\/members$/);

    await search.fill("definitely-not-a-member@example.invalid");
    await expect(
      page.getByText("No members match your search or filters."),
    ).toBeVisible();

    await search.fill(email);
    await page
      .getByRole("button", {
        name: new RegExp(
          `Open profile for .*${displayName === email ? email : displayName}`,
        ),
      })
      .first()
      .click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText(email)).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Role")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Teams")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Manage members" }),
    ).toBeVisible();
  });
});
