import { expect, test } from "@playwright/test";

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

type StatusItem = {
  id: string;
  name: string;
  issueCount: number;
  description: string | null;
  color?: string;
  isDefault?: boolean;
  behavior?: {
    terminalBehavior?: "open" | "resolved" | "canceled";
    autoArchiveDays?: number | null;
    autoCloseTriage?: boolean;
    automationUrl?: string | null;
  };
};

const categories: StatusCategory[] = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
];

test.describe("Team issue status workflow settings", () => {
  test("creates, edits category/default/behavior, reorders, and deletes statuses", async ({
    page,
  }) => {
    const patchBodies: unknown[] = [];
    const deleteBodies: unknown[] = [];
    const statuses: Record<StatusCategory, StatusItem[]> = {
      triage: [
        {
          id: "triage",
          name: "Triage",
          issueCount: 0,
          description: null,
          isDefault: true,
        },
      ],
      backlog: [
        {
          id: "backlog",
          name: "Backlog",
          issueCount: 0,
          description: null,
          isDefault: true,
        },
      ],
      unstarted: [
        {
          id: "todo",
          name: "Todo",
          issueCount: 0,
          description: null,
          isDefault: true,
        },
      ],
      started: [
        {
          id: "progress",
          name: "In Progress",
          issueCount: 0,
          description: null,
          isDefault: true,
        },
        { id: "review", name: "Review", issueCount: 0, description: null },
      ],
      completed: [
        {
          id: "done",
          name: "Done",
          issueCount: 0,
          description: null,
          isDefault: true,
        },
      ],
      canceled: [
        {
          id: "canceled",
          name: "Canceled",
          issueCount: 1,
          description: null,
          isDefault: true,
        },
      ],
    };

    await page.route("**/api/teams/ENG/statuses", async (route) => {
      const method = route.request().method();
      if (method === "POST") {
        const body = route.request().postDataJSON() as StatusItem & {
          category: StatusCategory;
        };
        statuses[body.category].push({
          id: "qa-review",
          name: body.name,
          issueCount: 0,
          description: body.description,
          color: body.color,
          behavior: body.behavior,
        });
      }
      if (method === "PATCH") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        patchBodies.push(body);
        if (typeof body.id === "string") {
          for (const category of categories) {
            const index = statuses[category].findIndex(
              (status) => status.id === body.id,
            );
            if (index === -1) continue;
            const current = statuses[category][index];
            const nextCategory =
              (body.category as StatusCategory | undefined) ?? category;
            statuses[category].splice(index, 1);
            if (body.isDefault === true) {
              statuses[nextCategory] = statuses[nextCategory].map((status) => ({
                ...status,
                isDefault: false,
              }));
            }
            statuses[nextCategory].push({
              ...current,
              ...(typeof body.name === "string" ? { name: body.name } : {}),
              ...(typeof body.description === "string"
                ? { description: body.description }
                : {}),
              ...(typeof body.color === "string" ? { color: body.color } : {}),
              ...(body.behavior && typeof body.behavior === "object"
                ? { behavior: body.behavior }
                : {}),
              isDefault: body.isDefault === true ? true : current.isDefault,
            });
            break;
          }
        }
        const reorder = body.reorder as
          | { category: StatusCategory; orderedIds: string[] }
          | undefined;
        if (reorder) {
          statuses[reorder.category].sort(
            (a, b) =>
              reorder.orderedIds.indexOf(a.id) -
              reorder.orderedIds.indexOf(b.id),
          );
        }
      }
      if (method === "DELETE") {
        const body = route.request().postDataJSON() as {
          id: string;
          replacementStatusId?: string;
        };
        deleteBodies.push(body);
        for (const category of categories) {
          statuses[category] = statuses[category].filter(
            (status) => status.id !== body.id,
          );
        }
      }

      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          statuses,
          duplicateStatusId: "canceled",
          canManage: true,
        }),
      });
    });

    await page.goto("/foreverbrowsing/settings/teams/ENG/statuses");
    await expect(
      page.getByRole("heading", { name: "Issue statuses" }),
    ).toBeVisible();
    await expect(page.getByLabel("Started default status")).toBeVisible();

    await page.getByLabel("Add status").nth(3).click();
    await page.getByLabel("Name").fill("QA Review");
    await page.getByLabel("Description").fill("Ready for verification");
    await page.getByLabel("Workflow type").selectOption("completed");
    await page.getByLabel("Auto-archive issues after days").fill("14");
    await page
      .getByLabel("Workflow automation link")
      .fill("https://example.com/status-workflow");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Status created.")).toBeVisible();
    await expect(page.getByText("QA Review")).toBeVisible();

    await page.getByLabel("Completed default status").selectOption("qa-review");
    await expect(page.getByText("Default status saved.")).toBeVisible();
    expect(patchBodies).toContainEqual({ id: "qa-review", isDefault: true });
    await page.getByLabel("Completed default status").selectOption("done");
    await expect(page.getByText("Default status saved.")).toBeVisible();

    await page
      .locator('[data-testid="status-item"]')
      .filter({ hasText: "QA Review" })
      .getByRole("button", { name: "Edit" })
      .click();
    await page.getByLabel("Name").fill("Verified");
    await page.getByLabel("Workflow type").selectOption("started");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Status updated.")).toBeVisible();
    expect(patchBodies).toContainEqual(
      expect.objectContaining({
        id: "qa-review",
        name: "Verified",
        category: "started",
      }),
    );

    await page.getByLabel("Move Review up").click();
    await expect(page.getByText("Status order saved.")).toBeVisible();
    expect(patchBodies).toContainEqual({
      reorder: {
        category: "started",
        orderedIds: ["review", "progress", "qa-review"],
      },
    });

    await page
      .locator('[data-testid="status-item"]')
      .filter({ hasText: "Review" })
      .getByRole("button", { name: "Edit" })
      .click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Status deleted.")).toBeVisible();
    expect(deleteBodies).toContainEqual({ id: "review" });
  });
});
