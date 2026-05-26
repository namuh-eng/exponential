import { db } from "@/lib/db";
import { member, user, workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { GET, PATCH } from "legacy-api/workspaces/current/ai-settings/route";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { describeDb } from "./_helpers/db-integration";

const OWNER_ID = "22900000-0000-0000-0000-000000000001";
const MEMBER_ID = "22900000-0000-0000-0000-000000000002";
const WS_ID = "22900000-0000-0000-0000-000000000003";
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) => {
      if (name === "activeWorkspaceId") return { value: WS_ID };
      return undefined;
    }),
  })),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";

const getSessionMock = auth.api.getSession as unknown as ReturnType<
  typeof vi.fn
>;

function mockSession(userId = OWNER_ID) {
  getSessionMock.mockResolvedValue({
    session: {
      id: `session-${userId}`,
      userId,
      token: "token",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      id: userId,
      name: userId === OWNER_ID ? "Owner" : "Member",
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

describeDb("current workspace AI settings route", () => {
  beforeAll(async () => {
    await db.delete(member).where(eq(member.workspaceId, WS_ID));
    await db.delete(workspace).where(eq(workspace.id, WS_ID));
    await db.delete(user).where(eq(user.id, OWNER_ID));
    await db.delete(user).where(eq(user.id, MEMBER_ID));

    await db.insert(user).values([
      {
        id: OWNER_ID,
        name: "AI Settings Owner",
        email: "ai-settings-owner@example.com",
      },
      {
        id: MEMBER_ID,
        name: "AI Settings Member",
        email: "ai-settings-member@example.com",
      },
    ]);
    await db.insert(workspace).values({
      id: WS_ID,
      name: "AI Settings Workspace",
      urlSlug: "ai-settings-workspace",
      settings: { ai: { workspaceAgentGuidance: "Existing policy" } },
    });
    await db.insert(member).values([
      { workspaceId: WS_ID, userId: OWNER_ID, role: "owner" },
      { workspaceId: WS_ID, userId: MEMBER_ID, role: "member" },
    ]);
  });

  afterAll(async () => {
    await db.delete(member).where(eq(member.workspaceId, WS_ID));
    await db.delete(workspace).where(eq(workspace.id, WS_ID));
    await db.delete(user).where(eq(user.id, OWNER_ID));
    await db.delete(user).where(eq(user.id, MEMBER_ID));
  });

  it("returns editable workspace AI settings for admins", async () => {
    mockSession(OWNER_ID);

    const response = await GET();

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.aiSettings.workspaceAgentGuidance).toBe("Existing policy");
    expect(payload.aiSettings.aiFeaturesEnabled).toBe(true);
    expect(payload.capabilities.canManageAiSettings).toBe(true);
  });

  it("persists workspace-scoped AI settings", async () => {
    mockSession(OWNER_ID);

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current/ai-settings", {
        method: "PATCH",
        body: JSON.stringify({
          aiSettings: {
            aiFeaturesEnabled: false,
            askLinearEnabled: false,
            workspaceAgentGuidance: "Escalate risky data access.",
            agentUsagePermission: "admins",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.aiSettings).toMatchObject({
      aiFeaturesEnabled: false,
      askLinearEnabled: false,
      workspaceAgentGuidance: "Escalate risky data access.",
      agentUsagePermission: "admins",
    });

    const [saved] = await db
      .select({ settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, WS_ID))
      .limit(1);
    expect(
      (saved.settings as { ai: { workspaceAgentGuidance: string } }).ai
        .workspaceAgentGuidance,
    ).toBe("Escalate risky data access.");
  });

  it("blocks non-admin mutations", async () => {
    mockSession(MEMBER_ID);

    const response = await PATCH(
      new Request("http://localhost/api/workspaces/current/ai-settings", {
        method: "PATCH",
        body: JSON.stringify({
          aiSettings: { aiFeaturesEnabled: true },
        }),
      }),
    );

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toContain("permission");
  });
});
