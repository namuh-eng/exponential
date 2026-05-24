import { DELETE, GET, PATCH, POST } from "@/app/api/teams/[key]/members/route";
import { db } from "@/lib/db";
import {
  member,
  team,
  teamMember,
  user,
  workspace,
  workspaceInvitation,
} from "@/lib/db/schema";
import { verifyInviteToken } from "@/lib/invite-tokens";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { describeDb } from "./_helpers/db-integration";

const ADMIN_USER_ID = "23900000-0000-0000-0000-000000000001";
const MEMBER_USER_ID = "23900000-0000-0000-0000-000000000002";
const OUTSIDER_USER_ID = "23900000-0000-0000-0000-000000000003";
const TEST_WS_ID = "23900000-0000-0000-0000-000000000010";
const OTHER_WS_ID = "23900000-0000-0000-0000-000000000011";
const TEST_TEAM_ID = "23900000-0000-0000-0000-000000000020";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    get: vi.fn(),
  })),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock("@/lib/email", () => ({
  sendInvitationEmail: vi.fn(async () => undefined),
}));

import { auth } from "@/lib/auth";
import { sendInvitationEmail } from "@/lib/email";

const getSessionMock = auth.api.getSession as unknown as ReturnType<
  typeof vi.fn
>;
const sendInvitationEmailMock = sendInvitationEmail as unknown as ReturnType<
  typeof vi.fn
>;

function mockSession(userId = ADMIN_USER_ID) {
  getSessionMock.mockResolvedValue({
    session: {
      id: `session-${userId}`,
      userId,
      token: `token-${userId}`,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      id: userId,
      name: "Team Members Test User",
      email: `${userId}@example.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function cleanup() {
  await db
    .delete(workspaceInvitation)
    .where(eq(workspaceInvitation.workspaceId, TEST_WS_ID));
  await db.delete(teamMember).where(eq(teamMember.teamId, TEST_TEAM_ID));
  await db.delete(team).where(eq(team.id, TEST_TEAM_ID));
  await db.delete(member).where(eq(member.workspaceId, TEST_WS_ID));
  await db.delete(member).where(eq(member.workspaceId, OTHER_WS_ID));
  await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
  await db.delete(workspace).where(eq(workspace.id, OTHER_WS_ID));
  await db.delete(user).where(eq(user.id, ADMIN_USER_ID));
  await db.delete(user).where(eq(user.id, MEMBER_USER_ID));
  await db.delete(user).where(eq(user.id, OUTSIDER_USER_ID));
}

async function seed() {
  await db.insert(user).values([
    {
      id: ADMIN_USER_ID,
      name: "Admin User",
      email: "issue-239-admin@example.com",
    },
    {
      id: MEMBER_USER_ID,
      name: "Member User",
      email: "issue-239-member@example.com",
    },
    {
      id: OUTSIDER_USER_ID,
      name: "Outsider User",
      email: "issue-239-outsider@example.com",
    },
  ]);

  await db.insert(workspace).values([
    { id: TEST_WS_ID, name: "Team Members Workspace", urlSlug: "tm-239" },
    { id: OTHER_WS_ID, name: "Other Workspace", urlSlug: "tm-239-other" },
  ]);

  await db.insert(member).values([
    { userId: ADMIN_USER_ID, workspaceId: TEST_WS_ID, role: "admin" },
    { userId: MEMBER_USER_ID, workspaceId: TEST_WS_ID, role: "member" },
    { userId: OUTSIDER_USER_ID, workspaceId: OTHER_WS_ID, role: "member" },
  ]);

  await db.insert(team).values({
    id: TEST_TEAM_ID,
    workspaceId: TEST_WS_ID,
    name: "Engineering",
    key: "T239",
  });

  await db.insert(teamMember).values({
    userId: ADMIN_USER_ID,
    teamId: TEST_TEAM_ID,
  });
}

describeDb("Team members API route", () => {
  beforeAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
    mockSession();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("adds an existing workspace member and returns persisted team members", async () => {
    const res = await POST(
      new Request("http://localhost/api/teams/T239/members", {
        method: "POST",
        body: JSON.stringify({ userIds: [MEMBER_USER_ID] }),
      }),
      { params: Promise.resolve({ key: "T239" }) },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.addedUserIds).toEqual([MEMBER_USER_ID]);
    expect(
      data.members.map((entry: { userId: string }) => entry.userId),
    ).toContain(MEMBER_USER_ID);

    const getRes = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ key: "T239" }),
    });
    const getData = await getRes.json();
    expect(
      getData.members.map((entry: { userId: string }) => entry.userId),
    ).toContain(MEMBER_USER_ID);
    expect(getData.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: ADMIN_USER_ID,
          role: "admin",
          status: "active",
          kind: "member",
        }),
      ]),
    );
  });

  it("invites a new email to the team and exposes pending invite actions", async () => {
    sendInvitationEmailMock.mockClear();

    const res = await POST(
      new Request("http://localhost/api/teams/T239/members", {
        method: "POST",
        body: JSON.stringify({ inviteEmails: ["new-person@example.com"] }),
      }),
      { params: Promise.resolve({ key: "T239" }) },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.invitedEmails).toEqual(["new-person@example.com"]);
    expect(data.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "invitation",
          email: "new-person@example.com",
          role: "member",
          status: "pending",
          actions: ["resend", "cancel"],
        }),
      ]),
    );
    expect(sendInvitationEmailMock).toHaveBeenCalledWith(
      "new-person@example.com",
      "Team Members Workspace",
      "Team Members Test User",
      expect.stringContaining("/accept-invite?token="),
    );

    const [storedInvite] = await db
      .select({ token: workspaceInvitation.token })
      .from(workspaceInvitation)
      .where(eq(workspaceInvitation.email, "new-person@example.com"))
      .limit(1);
    expect(verifyInviteToken(storedInvite.token)?.teamKey).toBe("T239");
  });

  it("resends and cancels pending team invitations", async () => {
    const createRes = await POST(
      new Request("http://localhost/api/teams/T239/members", {
        method: "POST",
        body: JSON.stringify({ inviteEmails: ["cancel-me@example.com"] }),
      }),
      { params: Promise.resolve({ key: "T239" }) },
    );
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    const invitation = created.members.find(
      (entry: { email: string }) => entry.email === "cancel-me@example.com",
    );
    expect(invitation).toBeTruthy();

    sendInvitationEmailMock.mockClear();
    const resendRes = await PATCH(
      new Request("http://localhost/api/teams/T239/members", {
        method: "PATCH",
        body: JSON.stringify({ invitationId: invitation.id, action: "resend" }),
      }),
      { params: Promise.resolve({ key: "T239" }) },
    );
    expect(resendRes.status).toBe(200);
    expect(sendInvitationEmailMock).toHaveBeenCalledTimes(1);

    const cancelRes = await DELETE(
      new Request("http://localhost/api/teams/T239/members", {
        method: "DELETE",
        body: JSON.stringify({ invitationId: invitation.id }),
      }),
      { params: Promise.resolve({ key: "T239" }) },
    );
    expect(cancelRes.status).toBe(200);
    const canceled = await cancelRes.json();
    expect(canceled.members).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: "cancel-me@example.com" }),
      ]),
    );

    const [storedInvite] = await db
      .select({ status: workspaceInvitation.status })
      .from(workspaceInvitation)
      .where(eq(workspaceInvitation.id, invitation.id))
      .limit(1);
    expect(storedInvite.status).toBe("revoked");
  });

  it("removes a team member and keeps them removed from GET", async () => {
    await db.insert(teamMember).values({
      teamId: TEST_TEAM_ID,
      userId: MEMBER_USER_ID,
    });

    const res = await DELETE(
      new Request("http://localhost/api/teams/T239/members", {
        method: "DELETE",
        body: JSON.stringify({ userId: MEMBER_USER_ID }),
      }),
      { params: Promise.resolve({ key: "T239" }) },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.removedUserId).toBe(MEMBER_USER_ID);
    expect(
      data.members.map((entry: { userId: string }) => entry.userId),
    ).not.toContain(MEMBER_USER_ID);

    const persisted = await db
      .select()
      .from(teamMember)
      .where(
        and(
          eq(teamMember.teamId, TEST_TEAM_ID),
          eq(teamMember.userId, MEMBER_USER_ID),
        ),
      );
    expect(persisted).toHaveLength(0);
  });

  it("rejects duplicate additions and users outside the workspace with clear errors", async () => {
    const duplicateRes = await POST(
      new Request("http://localhost/api/teams/T239/members", {
        method: "POST",
        body: JSON.stringify({ userIds: [ADMIN_USER_ID] }),
      }),
      { params: Promise.resolve({ key: "T239" }) },
    );
    expect(duplicateRes.status).toBe(409);
    await expect(duplicateRes.json()).resolves.toMatchObject({
      error: "Selected users are already team members",
    });

    const invalidRes = await POST(
      new Request("http://localhost/api/teams/T239/members", {
        method: "POST",
        body: JSON.stringify({ userIds: [OUTSIDER_USER_ID] }),
      }),
      { params: Promise.resolve({ key: "T239" }) },
    );
    expect(invalidRes.status).toBe(400);
    await expect(invalidRes.json()).resolves.toMatchObject({
      error: "Some users are not workspace members",
    });
  });

  it("forbids workspace members without management permissions from mutating team members", async () => {
    mockSession(MEMBER_USER_ID);

    const addRes = await POST(
      new Request("http://localhost/api/teams/T239/members", {
        method: "POST",
        body: JSON.stringify({ userIds: [MEMBER_USER_ID] }),
      }),
      { params: Promise.resolve({ key: "T239" }) },
    );
    expect(addRes.status).toBe(403);

    const removeRes = await DELETE(
      new Request("http://localhost/api/teams/T239/members", {
        method: "DELETE",
        body: JSON.stringify({ userId: ADMIN_USER_ID }),
      }),
      { params: Promise.resolve({ key: "T239" }) },
    );
    expect(removeRes.status).toBe(403);
  });

  it("does not allow removing the final team member", async () => {
    const res = await DELETE(
      new Request("http://localhost/api/teams/T239/members", {
        method: "DELETE",
        body: JSON.stringify({ userId: ADMIN_USER_ID }),
      }),
      { params: Promise.resolve({ key: "T239" }) },
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "Teams must keep at least one member",
    });
  });
});
