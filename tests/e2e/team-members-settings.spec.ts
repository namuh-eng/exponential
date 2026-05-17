import { db } from "@/lib/db";
import { member, user } from "@/lib/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

test.describe("Team member settings", () => {
  test("adds and removes existing workspace members with persistence", async ({
    page,
  }) => {
    const suffix = Date.now().toString(36);
    const workspaceSlug = `team-members-${suffix}`;
    const workspaceResponse = await page.request.post("/api/workspaces", {
      data: {
        name: `Team Members ${suffix}`,
        urlSlug: workspaceSlug,
      },
    });
    expect(workspaceResponse.status()).toBe(201);
    const workspaceData = (await workspaceResponse.json()) as {
      workspace: { id: string };
      team: { key: string };
    };

    const targetUserId = `issue-239-${suffix}`;
    const targetName = `Addable Member ${suffix}`;
    const targetEmail = `issue-239-${suffix}@example.com`;

    await db.delete(user).where(eq(user.id, targetUserId));
    await db.insert(user).values({
      id: targetUserId,
      name: targetName,
      email: targetEmail,
      emailVerified: true,
    });
    await db.insert(member).values({
      userId: targetUserId,
      workspaceId: workspaceData.workspace.id,
      role: "member",
    });

    await page.goto(
      `/${workspaceSlug}/settings/teams/${workspaceData.team.key}/members`,
    );
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByText(targetEmail)).toHaveCount(0);

    await page.getByRole("button", { name: "Add members" }).click();
    await expect(
      page.getByRole("dialog", { name: "Add members" }),
    ).toBeVisible();
    await page.getByPlaceholder("Search by name or email").fill(targetEmail);
    await page.getByText(targetEmail).click();
    await page.getByRole("button", { name: "Add or invite" }).click();
    await expect(page.getByRole("dialog", { name: "Add members" })).toHaveCount(
      0,
    );
    await expect(page.getByText(targetEmail)).toBeVisible();

    await page.reload();
    await expect(page.getByText(targetEmail)).toBeVisible();

    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: `Remove ${targetName}` }).click();
    await expect(page.getByText(targetEmail)).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(targetEmail)).toHaveCount(0);

    const membersResponse = await page.request.get(
      `/api/teams/${workspaceData.team.key}/members`,
    );
    expect(membersResponse.status()).toBe(200);
    const membersData = (await membersResponse.json()) as {
      members: Array<{ userId: string }>;
    };
    expect(membersData.members.map((entry) => entry.userId)).not.toContain(
      targetUserId,
    );
  });
});
