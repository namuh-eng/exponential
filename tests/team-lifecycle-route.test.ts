import { POST as createIssue } from "@/app/api/issues/route";
import { POST as updateTeamLifecycle } from "@/app/api/teams/[key]/settings/route";
import { db } from "@/lib/db";
import { member, team, teamMember, user, workspace } from "@/lib/db/schema";
import { TEAM_RESTORATION_WINDOW_MS } from "@/lib/team-lifecycle";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ADMIN_USER_ID = "33600000-0000-0000-0000-000000000001";
const MEMBER_USER_ID = "33600000-0000-0000-0000-000000000002";
const WORKSPACE_ID = "33600000-0000-0000-0000-000000000003";
const TEAM_ID = "33600000-0000-0000-0000-000000000004";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: vi.fn((name: string) =>
      name === "activeWorkspaceId" ? { value: WORKSPACE_ID } : undefined,
    ),
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

function mockSession(userId = ADMIN_USER_ID) {
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
      name: userId === ADMIN_USER_ID ? "Admin" : "Member",
      email: `${userId}@example.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function seedTeam() {
  await db.insert(user).values([
    {
      id: ADMIN_USER_ID,
      name: "Lifecycle Admin",
      email: "lifecycle-admin@example.com",
    },
    {
      id: MEMBER_USER_ID,
      name: "Lifecycle Member",
      email: "lifecycle-member@example.com",
    },
  ]);
  await db.insert(workspace).values({
    id: WORKSPACE_ID,
    name: "Lifecycle Workspace",
    urlSlug: "lifecycle-workspace",
  });
  await db.insert(member).values([
    { userId: ADMIN_USER_ID, workspaceId: WORKSPACE_ID, role: "admin" },
    { userId: MEMBER_USER_ID, workspaceId: WORKSPACE_ID, role: "member" },
  ]);
  await db.insert(team).values({
    id: TEAM_ID,
    workspaceId: WORKSPACE_ID,
    name: "Lifecycle Team",
    key: "LCY",
  });
  await db.insert(teamMember).values([
    { userId: ADMIN_USER_ID, teamId: TEAM_ID },
    { userId: MEMBER_USER_ID, teamId: TEAM_ID },
  ]);
}

async function cleanup() {
  await db.delete(teamMember).where(eq(teamMember.teamId, TEAM_ID));
  await db.delete(team).where(eq(team.id, TEAM_ID));
  await db.delete(member).where(eq(member.workspaceId, WORKSPACE_ID));
  await db.delete(workspace).where(eq(workspace.id, WORKSPACE_ID));
  await db.delete(user).where(eq(user.id, ADMIN_USER_ID));
  await db.delete(user).where(eq(user.id, MEMBER_USER_ID));
}

describe("team restoration lifecycle", () => {
  beforeEach(async () => {
    await cleanup();
    await seedTeam();
    mockSession();
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("schedules deletion instead of hard-deleting and restores within 30 days", async () => {
    const deleteRes = await updateTeamLifecycle(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "delete" }),
      }),
      { params: Promise.resolve({ key: "LCY" }) },
    );

    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toMatchObject({
      success: true,
      redirectTo: "/settings",
    });

    const [deletedTeam] = await db
      .select()
      .from(team)
      .where(eq(team.id, TEAM_ID));
    expect(deletedTeam).toBeTruthy();
    expect(deletedTeam.deletedAt).toBeInstanceOf(Date);
    expect(deletedTeam.deleteScheduledAt).toBeInstanceOf(Date);
    expect(deletedTeam.restorableUntil).toBeInstanceOf(Date);
    if (!deletedTeam.deletedAt || !deletedTeam.restorableUntil) {
      throw new Error("Expected deleted team restoration timestamps");
    }
    expect(
      deletedTeam.restorableUntil.getTime() - deletedTeam.deletedAt.getTime(),
    ).toBe(TEAM_RESTORATION_WINDOW_MS);

    const restoreRes = await updateTeamLifecycle(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "restore" }),
      }),
      { params: Promise.resolve({ key: "LCY" }) },
    );

    expect(restoreRes.status).toBe(200);
    const restorePayload = await restoreRes.json();
    expect(restorePayload.team.deletedAt).toBeNull();
    expect(restorePayload.team.restorableUntil).toBeNull();

    const [restoredTeam] = await db
      .select()
      .from(team)
      .where(eq(team.id, TEAM_ID));
    expect(restoredTeam.deletedAt).toBeNull();
    expect(restoredTeam.restorableUntil).toBeNull();
    expect(restoredTeam.restoredAt).toBeInstanceOf(Date);
  });

  it("rejects restores after the restoration window expires", async () => {
    const deletedAt = new Date(Date.now() - TEAM_RESTORATION_WINDOW_MS - 1_000);
    await db
      .update(team)
      .set({
        deletedAt,
        deleteScheduledAt: deletedAt,
        restorableUntil: new Date(Date.now() - 1_000),
      })
      .where(eq(team.id, TEAM_ID));

    const restoreRes = await updateTeamLifecycle(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "restore" }),
      }),
      { params: Promise.resolve({ key: "LCY" }) },
    );

    expect(restoreRes.status).toBe(410);
    expect(await restoreRes.json()).toEqual({
      error: "Team restoration window has expired",
    });
  });

  it("requires admin permission for retire/delete/restore lifecycle actions", async () => {
    mockSession(MEMBER_USER_ID);

    const res = await updateTeamLifecycle(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "delete" }),
      }),
      { params: Promise.resolve({ key: "LCY" }) },
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only workspace admins can change team lifecycle state",
    });
  });

  it("blocks new issue creation on retired teams and hides deleted teams", async () => {
    await updateTeamLifecycle(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "retire" }),
      }),
      { params: Promise.resolve({ key: "LCY" }) },
    );

    const retiredIssueRes = await createIssue(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ title: "Cannot create", teamId: TEAM_ID }),
      }),
    );
    expect(retiredIssueRes.status).toBe(409);
    expect(await retiredIssueRes.json()).toEqual({
      error: "Retired teams cannot accept new issues",
    });

    await db
      .update(team)
      .set({
        deletedAt: new Date(),
        deleteScheduledAt: new Date(),
        restorableUntil: new Date(Date.now() + TEAM_RESTORATION_WINDOW_MS),
      })
      .where(and(eq(team.id, TEAM_ID), eq(team.workspaceId, WORKSPACE_ID)));

    const deletedIssueRes = await createIssue(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ title: "Cannot create", teamId: TEAM_ID }),
      }),
    );
    expect(deletedIssueRes.status).toBe(404);
    expect(await deletedIssueRes.json()).toEqual({ error: "Team not found" });
  });
});
