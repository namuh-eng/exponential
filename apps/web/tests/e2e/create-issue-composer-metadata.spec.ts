import { expect, test } from "@playwright/test";

async function fillEditable(
  page: import("@playwright/test").Page,
  label: string,
  value: string,
) {
  const locator = page.getByLabel(label);
  await locator.evaluate((node, text) => {
    node.textContent = text;
    node.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
  }, value);
}

test.describe("Create issue composer metadata", () => {
  test("selects cycle estimate due date and template metadata and persists it", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `composer-meta-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: { name: `Composer Metadata ${suffix}`, urlSlug: workspaceSlug },
    });
    expect(workspaceResponse.status()).toBe(201);

    const teamKey = `CM${suffix.slice(-4).toUpperCase()}`;
    const teamResponse = await page.request.post("/api/teams", {
      data: { name: `Composer Meta ${suffix}`, key: teamKey },
    });
    expect(teamResponse.status()).toBe(201);
    const teamPayload = await teamResponse.json();
    const teamId = teamPayload.team.id as string;

    const settingsResponse = await page.request.patch(
      `/api/teams/${teamKey}/settings`,
      { data: { estimateType: "linear", cyclesEnabled: true } },
    );
    expect(settingsResponse.status()).toBe(200);

    const cycleResponse = await page.request.post(
      `/api/teams/${teamKey}/cycles`,
      {
        data: {
          name: "Cycle 1",
          startDate: "2026-06-01",
          endDate: "2026-06-14",
        },
      },
    );
    expect(cycleResponse.status()).toBe(201);

    const templateResponse = await page.request.post("/api/issue-templates", {
      data: {
        name: `Composer template ${suffix}`,
        description: "Template fallback",
        settings: {
          body: "Template body from composer",
          defaultPriority: "high",
        },
      },
    });
    expect(templateResponse.status()).toBe(201);

    const parentResponse = await page.request.post("/api/issues", {
      data: { title: `Parent ${suffix}`, teamId },
    });
    expect(parentResponse.status()).toBe(201);

    await page.goto(`/${workspaceSlug}/team/${teamKey}/all`);
    await page.getByRole("button", { name: "Create issue" }).click();
    await expect(page.getByTestId("create-issue-composer")).toBeVisible();

    const title = `Issue metadata ${suffix}`;
    await fillEditable(page, "Issue title", title);

    await page.getByRole("button", { name: "Cycle" }).click();
    await page.getByRole("button", { name: "Cycle 1" }).click();

    await page.getByRole("button", { name: "Estimate" }).click();
    await page.getByRole("button", { name: "3 points" }).click();

    await page.getByRole("button", { name: "Template" }).click();
    await page
      .getByRole("button", { name: `Composer template ${suffix}` })
      .click();

    await page.getByRole("button", { name: "Due date" }).click();
    await page.getByLabel("Custom due date").fill("2026-06-03");

    await page.getByLabel("More actions").click();
    await page.getByRole("button", { name: "Set parent issue" }).click();
    await page
      .getByRole("button", { name: new RegExp(`Parent ${suffix}`) })
      .click();

    await page
      .getByTestId("create-issue-composer")
      .getByRole("button", { name: "Create Issue" })
      .click();
    await expect(page.getByTestId("create-issue-composer")).toHaveCount(0);
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText("Cycle 1")).toBeVisible();
    await expect(page.getByText("3 pt")).toBeVisible();

    const issuesResponse = await page.request.get(
      `/api/teams/${teamKey}/issues`,
    );
    expect(issuesResponse.status()).toBe(200);
    const issuesPayload = await issuesResponse.json();
    const created = issuesPayload.groups
      .flatMap(
        (group: { issues: Array<Record<string, unknown>> }) => group.issues,
      )
      .find((issue: { title?: string }) => issue.title === title) as
      | {
          id: string;
          cycleName: string | null;
          estimate: number | null;
          dueDate: string | null;
        }
      | undefined;
    expect(created).toMatchObject({ cycleName: "Cycle 1", estimate: 3 });
    expect(created?.dueDate).toContain("2026-06-03");

    const detailResponse = await page.request.get(`/api/issues/${created?.id}`);
    expect(detailResponse.status()).toBe(200);
    const detailPayload = await detailResponse.json();
    expect(detailPayload.description).toContain("Template body from composer");
    expect(detailPayload.parentIssue).toBeTruthy();
  });
});
