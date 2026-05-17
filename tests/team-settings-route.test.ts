import { GET, PATCH, POST } from "@/app/api/teams/[key]/settings/route";
import { db } from "@/lib/db";
import {
  member,
  team,
  teamMember,
  user,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "15000000-0000-0000-0000-000000000001";
const TEST_OTHER_USER_ID = "15000000-0000-0000-0000-000000000006";
const TEST_WS_ID = "15000000-0000-0000-0000-000000000002";
const TEST_TEAM_ID = "15000000-0000-0000-0000-000000000003";
const TEST_PARENT_TEAM_ID = "15000000-0000-0000-0000-000000000004";
const TEST_CHILD_TEAM_ID = "15000000-0000-0000-0000-000000000005";
const TEST_BACKLOG_STATE_ID = "15000000-0000-0000-0000-000000000007";
const TEST_READY_STATE_ID = "15000000-0000-0000-0000-000000000008";
const TEST_CANCELED_STATE_ID = "15000000-0000-0000-0000-000000000009";

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: vi.fn(),
  })),
}));

// Mock auth
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

describe("Team Settings API Route", () => {
  beforeAll(async () => {
    // Cleanup
    await db.delete(teamMember).where(eq(teamMember.teamId, TEST_TEAM_ID));
    await db
      .delete(workflowState)
      .where(eq(workflowState.teamId, TEST_TEAM_ID));
    await db.delete(team).where(eq(team.id, TEST_CHILD_TEAM_ID));
    await db.delete(team).where(eq(team.id, TEST_PARENT_TEAM_ID));
    await db.delete(team).where(eq(team.id, TEST_CHILD_TEAM_ID));
    await db.delete(team).where(eq(team.id, TEST_PARENT_TEAM_ID));
    await db.delete(team).where(eq(team.id, TEST_TEAM_ID));
    await db.delete(member).where(eq(member.workspaceId, TEST_WS_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));
    await db.delete(user).where(eq(user.id, TEST_OTHER_USER_ID));

    // Seed
    await db.insert(user).values([
      {
        id: TEST_USER_ID,
        name: "Team Test User",
        email: "team-test@example.com",
      },
      {
        id: TEST_OTHER_USER_ID,
        name: "Other Workspace User",
        email: "team-other-test@example.com",
      },
    ]);

    await db.insert(workspace).values({
      id: TEST_WS_ID,
      name: "Team Test Workspace",
      urlSlug: "team-test",
    });

    await db.insert(member).values([
      {
        userId: TEST_USER_ID,
        workspaceId: TEST_WS_ID,
        role: "admin",
      },
      {
        userId: TEST_OTHER_USER_ID,
        workspaceId: TEST_WS_ID,
        role: "member",
      },
    ]);

    await db.insert(team).values([
      {
        id: TEST_TEAM_ID,
        workspaceId: TEST_WS_ID,
        name: "Initial Team",
        key: "INIT",
        icon: "⚙️",
        timezone: "America/Los_Angeles",
      },
      {
        id: TEST_PARENT_TEAM_ID,
        workspaceId: TEST_WS_ID,
        name: "Parent Team",
        key: "PAR",
      },
      {
        id: TEST_CHILD_TEAM_ID,
        workspaceId: TEST_WS_ID,
        name: "Child Team",
        key: "CHD",
      },
    ]);

    await db.insert(teamMember).values({
      userId: TEST_USER_ID,
      teamId: TEST_TEAM_ID,
    });

    await db.insert(workflowState).values([
      {
        id: TEST_BACKLOG_STATE_ID,
        teamId: TEST_TEAM_ID,
        name: "Backlog",
        category: "backlog",
        color: "#6b7280",
        position: 1,
      },
      {
        id: TEST_READY_STATE_ID,
        teamId: TEST_TEAM_ID,
        name: "Ready",
        category: "unstarted",
        color: "#2563eb",
        position: 2,
      },
      {
        id: TEST_CANCELED_STATE_ID,
        teamId: TEST_TEAM_ID,
        name: "Canceled",
        category: "canceled",
        color: "#ef4444",
        position: 3,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(teamMember).where(eq(teamMember.teamId, TEST_TEAM_ID));
    await db
      .delete(workflowState)
      .where(eq(workflowState.teamId, TEST_TEAM_ID));
    await db.delete(team).where(eq(team.id, TEST_CHILD_TEAM_ID));
    await db.delete(team).where(eq(team.id, TEST_PARENT_TEAM_ID));
    await db.delete(team).where(eq(team.id, TEST_TEAM_ID));
    await db.delete(member).where(eq(member.workspaceId, TEST_WS_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));
    await db.delete(user).where(eq(user.id, TEST_OTHER_USER_ID));
  });

  it("GET returns team settings", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-id",
        userId: TEST_USER_ID,
        token: "token",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "INIT" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.team.name).toBe("Initial Team");
  });

  it("PATCH updates team settings", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-id",
        userId: TEST_USER_ID,
        token: "token",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const req = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Updated Team",
        key: "UPDT",
      }),
    });

    const res = await PATCH(req, {
      params: Promise.resolve({ key: "INIT" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.team.name).toBe("Updated Team");
    expect(data.team.key).toBe("UPDT");

    // Verify in DB
    const [dbTeam] = await db
      .select()
      .from(team)
      .where(eq(team.id, TEST_TEAM_ID));
    expect(dbTeam.name).toBe("Updated Team");
    expect(dbTeam.key).toBe("UPDT");
  });

  it("PATCH persists triageEnabled without requiring name or key", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-id",
        userId: TEST_USER_ID,
        token: "token",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const disableReq = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ triageEnabled: false }),
    });

    const disableRes = await PATCH(disableReq, {
      params: Promise.resolve({ key: "UPDT" }),
    });

    expect(disableRes.status).toBe(200);
    const disabledPayload = await disableRes.json();
    expect(disabledPayload.team.name).toBe("Updated Team");
    expect(disabledPayload.team.key).toBe("UPDT");
    expect(disabledPayload.team.timezone).toBe("America/Los_Angeles");
    expect(disabledPayload.team.triageEnabled).toBe(false);

    const disabledGetRes = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "UPDT" }),
    });
    expect(disabledGetRes.status).toBe(200);
    expect((await disabledGetRes.json()).team.triageEnabled).toBe(false);

    const enableReq = new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ triageEnabled: true }),
    });

    const enableRes = await PATCH(enableReq, {
      params: Promise.resolve({ key: "UPDT" }),
    });

    expect(enableRes.status).toBe(200);
    expect((await enableRes.json()).team.triageEnabled).toBe(true);
  });

  it("PATCH persists triage accept and decline destination statuses", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-id",
        userId: TEST_USER_ID,
        token: "token",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          triageAcceptDestinationStateId: TEST_READY_STATE_ID,
          triageDeclineDestinationStateId: TEST_CANCELED_STATE_ID,
        }),
      }),
      { params: Promise.resolve({ key: "UPDT" }) },
    );

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.team.triageAcceptDestinationStateId).toBe(
      TEST_READY_STATE_ID,
    );
    expect(payload.team.triageDeclineDestinationStateId).toBe(
      TEST_CANCELED_STATE_ID,
    );
    expect(
      payload.team.acceptDestinationStates.map(
        (state: { id: string }) => state.id,
      ),
    ).toContain(TEST_READY_STATE_ID);
    expect(
      payload.team.declineDestinationStates.map(
        (state: { id: string }) => state.id,
      ),
    ).toContain(TEST_CANCELED_STATE_ID);

    const getRes = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "UPDT" }),
    });
    const getPayload = await getRes.json();
    expect(getPayload.team.triageAcceptDestinationStateId).toBe(
      TEST_READY_STATE_ID,
    );
    expect(getPayload.team.triageDeclineDestinationStateId).toBe(
      TEST_CANCELED_STATE_ID,
    );
  });

  it("PATCH rejects invalid triage destination categories", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-id",
        userId: TEST_USER_ID,
        token: "token",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          triageAcceptDestinationStateId: TEST_CANCELED_STATE_ID,
        }),
      }),
      { params: Promise.resolve({ key: "UPDT" }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Accept destination/i);
  });

  it("PATCH persists discussion summaries and parent team settings", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-id",
        userId: TEST_USER_ID,
        token: "token",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          discussionSummariesEnabled: true,
          parentTeamId: TEST_PARENT_TEAM_ID,
        }),
      }),
      { params: Promise.resolve({ key: "UPDT" }) },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.team.discussionSummariesEnabled).toBe(true);
    expect(data.team.parentTeamId).toBe(TEST_PARENT_TEAM_ID);
    expect(data.team.parentTeam.name).toBe("Parent Team");

    const getRes = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "UPDT" }),
    });
    const getData = await getRes.json();
    expect(getData.team.discussionSummariesEnabled).toBe(true);
    expect(getData.team.parentTeamId).toBe(TEST_PARENT_TEAM_ID);
  });

  it("PATCH rejects cyclic parent team hierarchy", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-id",
        userId: TEST_USER_ID,
        token: "token",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await db
      .update(team)
      .set({ parentTeamId: TEST_TEAM_ID })
      .where(eq(team.id, TEST_CHILD_TEAM_ID));

    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ parentTeamId: TEST_CHILD_TEAM_ID }),
      }),
      { params: Promise.resolve({ key: "UPDT" }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cycle/i);
  });

  it("persists agent guidance and reports modify permission", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-id",
        userId: TEST_USER_ID,
        token: "token",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await db
      .update(workspace)
      .set({
        settings: {
          security: { permissions: { agentGuidanceRole: "admins" } },
        },
      })
      .where(eq(workspace.id, TEST_WS_ID));

    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          agentGuidance: "Use ENG-specific QA evidence.",
        }),
      }),
      { params: Promise.resolve({ key: "UPDT" }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).team.agentGuidance).toBe(
      "Use ENG-specific QA evidence.",
    );

    const getRes = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "UPDT" }),
    });
    const payload = await getRes.json();
    expect(payload.team.agentGuidance).toBe("Use ENG-specific QA evidence.");
    expect(payload.team.canModifyAgentGuidance).toBe(true);
  });

  it("forbids agent guidance changes when workspace permissions disallow them", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-other-id",
        userId: TEST_OTHER_USER_ID,
        token: "token-other",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_OTHER_USER_ID,
        name: "Other User",
        email: "other@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await db
      .update(workspace)
      .set({
        settings: {
          security: { permissions: { agentGuidanceRole: "admins" } },
        },
      })
      .where(eq(workspace.id, TEST_WS_ID));

    const getRes = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "UPDT" }),
    });
    expect((await getRes.json()).team.canModifyAgentGuidance).toBe(false);

    const res = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({ agentGuidance: "Member should not save this." }),
      }),
      { params: Promise.resolve({ key: "UPDT" }) },
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "You do not have permission to modify agent guidance",
    });
  });

  it("GET hides private team settings from workspace non-members", async () => {
    await db
      .update(team)
      .set({ isPrivate: true })
      .where(eq(team.id, TEST_TEAM_ID));
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-other-id",
        userId: TEST_OTHER_USER_ID,
        token: "token-other",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_OTHER_USER_ID,
        name: "Other User",
        email: "other@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    try {
      const res = await GET(new Request("http://localhost"), {
        params: Promise.resolve({ key: "UPDT" }),
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Team not found" });
    } finally {
      await db
        .update(team)
        .set({ isPrivate: false })
        .where(eq(team.id, TEST_TEAM_ID));
    }
  });

  it("POST leave team action removes membership", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        id: "session-id",
        userId: TEST_USER_ID,
        token: "token",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: TEST_USER_ID,
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ action: "leave" }),
    });

    const res = await POST(req, {
      params: Promise.resolve({ key: "UPDT" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Verify membership is gone
    const memberships = await db
      .select()
      .from(teamMember)
      .where(
        and(
          eq(teamMember.teamId, TEST_TEAM_ID),
          eq(teamMember.userId, TEST_USER_ID),
        ),
      );
    expect(memberships).toHaveLength(0);
  });
});
