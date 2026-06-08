import { expect, test } from "@playwright/test";

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

    const securityResponse = await page.request.get(
      "/api/workspaces/current/security",
      {
        headers: { "x-workspace-id": workspaceData.workspace.id },
      },
    );
    expect(securityResponse.status()).toBe(200);
    const securityData = (await securityResponse.json()) as {
      security: { inviteUrl: string };
    };
    const inviteToken = new URL(
      securityData.security.inviteUrl,
      "http://localhost:7015",
    ).searchParams.get("token");
    expect(inviteToken).toBeTruthy();

    const memberEmail = `ai-member-${suffix}@example.com`;
    const memberSessionResponse = await page.request.post(
      "/api/test/create-session",
      {
        headers: { "X-Set-Test-Session-Cookies": "true" },
        data: { email: memberEmail },
      },
    );
    expect(memberSessionResponse.status()).toBe(200);
    const acceptResponse = await page.request.post(
      "/api/workspaces/accept-invite",
      {
        data: { token: inviteToken },
      },
    );
    expect(acceptResponse.status()).toBe(200);

    const membersResponse = await page.request.get("/api/workspaces/members", {
      headers: { "x-workspace-id": workspaceData.workspace.id },
    });
    expect(membersResponse.status()).toBe(200);
    const membersData = (await membersResponse.json()) as {
      currentUserId: string;
      members: Array<{
        id: string;
        userId: string | null;
        kind: string;
        role: string;
      }>;
    };
    const currentMember = membersData.members.find(
      (entry) =>
        entry.kind === "member" && entry.userId === membersData.currentUserId,
    );
    expect(currentMember).toBeDefined();
    expect(currentMember?.role).toBe("member");

    const blockedResponse = await page.request.patch(
      "/api/workspaces/current/ai-settings",
      {
        headers: { "x-workspace-id": workspaceData.workspace.id },
        data: {
          aiSettings: {
            workspaceAgentGuidance: "Member edit should be rejected",
          },
        },
      },
    );
    expect(blockedResponse.status()).toBe(403);

    const blockedRun = await page.request.post("/api/agent/runs", {
      headers: { "x-workspace-id": workspaceData.workspace.id },
      data: {
        title: "Blocked by workspace policy",
        prompt: "This prompt is long enough but should not be accepted.",
      },
    });
    expect(blockedRun.status()).toBe(403);
  });
});
