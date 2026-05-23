import { db } from "@/lib/db";
import { member } from "@/lib/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

test.describe("Workspace AI settings", () => {
  test("edits workspace AI settings, persists reloads, and enforces permissions", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `ai-settings-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `AI Settings ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspaceData = (await workspaceResponse.json()) as {
      workspace: { id: string };
    };

    await page.goto(`/${workspaceSlug}/settings/ai`);
    await expect(
      page.getByRole("heading", { name: "AI & Agents" }),
    ).toBeVisible();
    await expect(page.getByText("Workspace AI controls")).toBeVisible();

    await page
      .getByLabel("Workspace agent guidance")
      .fill(
        `Require evidence links before changing production data ${suffix}.`,
      );
    await page.getByLabel("Who can use agents").selectOption("admins");
    await page.getByLabel("Auto-triage suggestions").check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Workspace AI settings saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Workspace agent guidance")).toHaveValue(
      `Require evidence links before changing production data ${suffix}.`,
    );
    await expect(page.getByLabel("Who can use agents")).toHaveValue("admins");
    await expect(page.getByLabel("Auto-triage suggestions")).toBeChecked();

    await db
      .update(member)
      .set({ role: "member", updatedAt: new Date() })
      .where(eq(member.workspaceId, workspaceData.workspace.id));

    const blockedResponse = await page.request.patch(
      "/api/workspaces/current/ai-settings",
      {
        data: {
          aiSettings: {
            workspaceAgentGuidance: "Member edit should be rejected",
          },
        },
      },
    );
    expect(blockedResponse.status()).toBe(403);

    const blockedRun = await page.request.post("/api/agent/runs", {
      data: {
        title: "Blocked by workspace policy",
        prompt: "This prompt is long enough but should not be accepted.",
      },
    });
    expect(blockedRun.status()).toBe(403);
  });
});
