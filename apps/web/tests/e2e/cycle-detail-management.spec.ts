import { expect, test } from "@playwright/test";

test.describe("cycle detail management", () => {
  test("edits metadata, creates a cycle-scoped issue, exposes scope tools, and deletes", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `cycle-detail-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Cycle Detail ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspacePayload = (await workspaceResponse.json()) as {
      team: { id: string; key: string; name: string };
    };
    const teamKey = workspacePayload.team.key;

    const cycleResponse = await page.request.post(
      `/api/teams/${teamKey}/cycles`,
      {
        data: {
          name: `Planning Cycle ${suffix}`,
          startDate: "2026-07-01",
          endDate: "2026-07-14",
        },
      },
    );
    expect(cycleResponse.status()).toBe(201);
    const cyclePayload = (await cycleResponse.json()) as { id: string };

    await page.goto(
      `/${workspaceSlug}/team/${teamKey}/cycles/${cyclePayload.id}`,
    );

    await expect(
      page.getByRole("heading", { name: `Planning Cycle ${suffix}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add issue" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cycle actions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Search cycle issues" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add filter" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Display options" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Cycle actions" }).click();
    await page.getByRole("button", { name: "Edit cycle" }).click();
    await page.getByLabel("Cycle name").fill(`Managed Cycle ${suffix}`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("heading", { name: `Managed Cycle ${suffix}` }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add issue" }).first().click();
    await expect(
      page.getByLabel(`Cycle Managed Cycle ${suffix}`),
    ).toBeVisible();
    const composer = page.getByTestId("create-issue-composer");
    await composer.getByRole("textbox", { name: "Issue title" }).click();
    await page.keyboard.type("Cycle scoped Playwright issue");
    await expect(
      composer.getByRole("button", { name: "Create Issue" }),
    ).toBeEnabled();
    await composer.getByRole("button", { name: "Create Issue" }).click();
    await expect(
      page.getByRole("link", { name: /Cycle scoped Playwright issue/ }),
    ).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cycle actions" }).click();
    await page.getByRole("button", { name: "Delete cycle" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/${workspaceSlug}/team/${teamKey}/cycles$`),
    );
  });
});
