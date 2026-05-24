import { GET, POST } from "@/app/api/agent/runs/route";
import { db } from "@/lib/db";
import { member, team, teamMember, user, workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { describeDb } from "./_helpers/db-integration";

const USER_ID = "33200000-0000-0000-0000-000000000001";
const WS_ID = "33200000-0000-0000-0000-000000000002";
const ENG_TEAM_ID = "33200000-0000-0000-0000-000000000003";
const OPS_TEAM_ID = "33200000-0000-0000-0000-000000000004";

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

function mockSession() {
  getSessionMock.mockResolvedValue({
    session: {
      id: "session-id",
      userId: USER_ID,
      token: "token",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      id: USER_ID,
      name: "Agent Runner",
      email: "agent-runner@example.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

describeDb("agent runs route", () => {
  beforeAll(async () => {
    await db.delete(teamMember).where(eq(teamMember.userId, USER_ID));
    await db.delete(team).where(eq(team.id, ENG_TEAM_ID));
    await db.delete(team).where(eq(team.id, OPS_TEAM_ID));
    await db.delete(member).where(eq(member.workspaceId, WS_ID));
    await db.delete(workspace).where(eq(workspace.id, WS_ID));
    await db.delete(user).where(eq(user.id, USER_ID));

    await db.insert(user).values({
      id: USER_ID,
      name: "Agent Runner",
      email: "agent-runner@example.com",
      settings: {
        accountPreferences: {
          agentPersonalization: {
            instructions: "Account: prefer small safe diffs.",
            autoFix: true,
          },
        },
      },
    });
    await db.insert(workspace).values({
      id: WS_ID,
      name: "Agent Runs Workspace",
      urlSlug: "agent-runs-workspace",
      settings: { ai: { agentGuidance: "Workspace: cite evidence." } },
    });
    await db.insert(member).values({
      workspaceId: WS_ID,
      userId: USER_ID,
      role: "admin",
    });
    await db.insert(team).values([
      {
        id: ENG_TEAM_ID,
        workspaceId: WS_ID,
        name: "Engineering",
        key: "ENG",
        settings: { agentGuidance: "ENG: include frontend test plan." },
      },
      {
        id: OPS_TEAM_ID,
        workspaceId: WS_ID,
        name: "Operations",
        key: "OPS",
        settings: { agentGuidance: "OPS: prioritize runbook updates." },
      },
    ]);
    await db
      .insert(teamMember)
      .values({ teamId: ENG_TEAM_ID, userId: USER_ID });
  });

  afterAll(async () => {
    await db.delete(teamMember).where(eq(teamMember.userId, USER_ID));
    await db.delete(team).where(eq(team.id, ENG_TEAM_ID));
    await db.delete(team).where(eq(team.id, OPS_TEAM_ID));
    await db.delete(member).where(eq(member.workspaceId, WS_ID));
    await db.delete(workspace).where(eq(workspace.id, WS_ID));
    await db.delete(user).where(eq(user.id, USER_ID));
  });

  it("includes selected team guidance in the agent prompt config", async () => {
    mockSession();
    const response = await POST(
      new Request("http://localhost/api/agent/runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Investigate ENG issue",
          prompt: "Inspect this issue and propose the safest fix.",
          teamKey: "ENG",
          context: "ENG-332",
        }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.run.promptConfig.guidance.effectiveInstructions).toContain(
      "Workspace: cite evidence.",
    );
    expect(payload.run.promptConfig.guidance.effectiveInstructions).toContain(
      "Account: prefer small safe diffs.",
    );
    expect(payload.run.promptConfig.guidance.effectiveInstructions).toContain(
      "ENG: include frontend test plan.",
    );
    expect(payload.run.promptConfig.guidance.autoFixEnabled).toBe(true);
    expect(payload.run.logs).toContain(
      "Applied workspace/account/team agent guidance to the prompt configuration.",
    );
    expect(payload.run.logs).toContain(
      "Account personalization requested proactive lint/type fix suggestions for this run.",
    );
  });

  it("does not leak one team's guidance into another team's run", async () => {
    mockSession();
    const response = await POST(
      new Request("http://localhost/api/agent/runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Investigate OPS issue",
          prompt: "Inspect this issue and propose the safest fix.",
          teamKey: "OPS",
          context: "OPS-1",
        }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    const instructions =
      payload.run.promptConfig.guidance.effectiveInstructions;
    expect(instructions).toContain("OPS: prioritize runbook updates.");
    expect(instructions).not.toContain("ENG: include frontend test plan.");
  });
  it("blocks run creation when workspace AI features are disabled", async () => {
    mockSession();
    await db
      .update(workspace)
      .set({ settings: { ai: { aiFeaturesEnabled: false } } })
      .where(eq(workspace.id, WS_ID));

    const response = await POST(
      new Request("http://localhost/api/agent/runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Investigate disabled workspace",
          prompt: "Inspect this issue and propose the safest fix.",
          teamKey: "ENG",
          context: "ENG-333",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Workspace AI and agent features are disabled",
    });

    await db
      .update(workspace)
      .set({ settings: { ai: { agentGuidance: "Workspace: cite evidence." } } })
      .where(eq(workspace.id, WS_ID));
  });

  it("reports and enforces workspace agent usage permissions", async () => {
    mockSession();
    await db
      .update(member)
      .set({ role: "member" })
      .where(eq(member.userId, USER_ID));
    await db
      .update(workspace)
      .set({
        settings: {
          ai: {
            aiFeaturesEnabled: true,
            agentGuidance: "Workspace: cite evidence.",
            agentUsagePermission: "admins",
          },
        },
      })
      .where(eq(workspace.id, WS_ID));

    const listResponse = await GET();
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      canCreateRuns: false,
    });

    const createResponse = await POST(
      new Request("http://localhost/api/agent/runs", {
        method: "POST",
        body: JSON.stringify({
          title: "Investigate restricted workspace",
          prompt: "Inspect this issue and propose the safest fix.",
          teamKey: "ENG",
          context: "ENG-334",
        }),
      }),
    );

    expect(createResponse.status).toBe(403);
    await expect(createResponse.json()).resolves.toEqual({
      error:
        "You do not have permission to create agent runs in this workspace",
    });

    await db
      .update(member)
      .set({ role: "admin" })
      .where(eq(member.userId, USER_ID));
    await db
      .update(workspace)
      .set({ settings: { ai: { agentGuidance: "Workspace: cite evidence." } } })
      .where(eq(workspace.id, WS_ID));
  });
});
