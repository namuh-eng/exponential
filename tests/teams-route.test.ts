import { GET, POST } from "@/app/api/teams/route";
import { db } from "@/lib/db";
import {
  member,
  team,
  teamMember,
  user,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const ADMIN_USER_ID = "25200000-0000-0000-0000-000000000001";
const MEMBER_USER_ID = "25200000-0000-0000-0000-000000000002";
const TEST_WS_ID = "25200000-0000-0000-0000-000000000010";
const EXISTING_TEAM_ID = "25200000-0000-0000-0000-000000000020";
const PRIVATE_TEAM_ID = "25200000-0000-0000-0000-000000000021";

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

vi.mock("@/lib/active-workspace", () => ({
  resolveActiveWorkspaceId: vi.fn(),
}));

import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { auth } from "@/lib/auth";

const getSessionMock = auth.api.getSession as unknown as ReturnType<
  typeof vi.fn
>;
const resolveActiveWorkspaceIdMock =
  resolveActiveWorkspaceId as unknown as ReturnType<typeof vi.fn>;

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
      name: "Teams Route Test User",
      email: `${userId}@example.com`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function cleanup() {
  const allTeams = await db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.workspaceId, TEST_WS_ID));
  for (const row of allTeams) {
    await db.delete(workflowState).where(eq(workflowState.teamId, row.id));
    await db.delete(teamMember).where(eq(teamMember.teamId, row.id));
  }
  await db.delete(team).where(eq(team.workspaceId, TEST_WS_ID));
  await db.delete(member).where(eq(member.workspaceId, TEST_WS_ID));
  await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
  await db.delete(user).where(eq(user.id, ADMIN_USER_ID));
  await db.delete(user).where(eq(user.id, MEMBER_USER_ID));
}

async function seed() {
  await db.insert(user).values([
    {
      id: ADMIN_USER_ID,
      name: "Admin User",
      email: "issue-252-admin@example.com",
    },
    {
      id: MEMBER_USER_ID,
      name: "Member User",
      email: "issue-252-member@example.com",
    },
  ]);

  await db.insert(workspace).values({
    id: TEST_WS_ID,
    name: "Teams Directory Workspace",
    urlSlug: "teams-252",
    settings: {
      security: {
        permissions: {
          teamCreationRole: "admins",
        },
      },
    },
  });

  await db.insert(member).values([
    { userId: ADMIN_USER_ID, workspaceId: TEST_WS_ID, role: "admin" },
    { userId: MEMBER_USER_ID, workspaceId: TEST_WS_ID, role: "member" },
  ]);

  await db.insert(team).values({
    id: EXISTING_TEAM_ID,
    workspaceId: TEST_WS_ID,
    name: "Engineering",
    key: "ENG",
    isPrivate: false,
  });

  await db.insert(teamMember).values({
    userId: ADMIN_USER_ID,
    teamId: EXISTING_TEAM_ID,
  });
}

describe("workspace teams API route", () => {
  beforeAll(async () => {
    await cleanup();
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
    vi.clearAllMocks();
    resolveActiveWorkspaceIdMock.mockResolvedValue(TEST_WS_ID);
    mockSession();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("lists team metadata and viewer permissions for the active workspace", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.canManageTeams).toBe(true);
    expect(data.viewerRole).toBe("admin");
    expect(data.teams).toEqual([
      expect.objectContaining({
        name: "Engineering",
        key: "ENG",
        isPrivate: false,
        memberCount: 1,
        currentUserIsMember: true,
      }),
    ]);
  });

  it("hides private teams from workspace members who are not team members", async () => {
    await db.insert(team).values({
      id: PRIVATE_TEAM_ID,
      workspaceId: TEST_WS_ID,
      name: "Secret Platform",
      key: "SEC",
      isPrivate: true,
    });

    mockSession(MEMBER_USER_ID);

    const res = await GET();

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.canManageTeams).toBe(false);
    expect(data.teams.map((entry: { key: string }) => entry.key)).toEqual([
      "ENG",
    ]);
    expect(JSON.stringify(data)).not.toContain("Secret Platform");
    expect(JSON.stringify(data)).not.toContain("SEC");
  });

  it("shows private teams to team members and workspace admins", async () => {
    await db.insert(team).values({
      id: PRIVATE_TEAM_ID,
      workspaceId: TEST_WS_ID,
      name: "Secret Platform",
      key: "SEC",
      isPrivate: true,
    });
    await db.insert(teamMember).values({
      userId: MEMBER_USER_ID,
      teamId: PRIVATE_TEAM_ID,
    });

    mockSession(MEMBER_USER_ID);
    const memberRes = await GET();
    expect(memberRes.status).toBe(200);
    const memberData = await memberRes.json();
    expect(memberData.teams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "SEC",
          name: "Secret Platform",
          isPrivate: true,
          currentUserIsMember: true,
        }),
      ]),
    );

    await db.delete(teamMember).where(eq(teamMember.teamId, PRIVATE_TEAM_ID));

    mockSession(ADMIN_USER_ID);
    const adminRes = await GET();
    expect(adminRes.status).toBe(200);
    const adminData = await adminRes.json();
    expect(adminData.teams).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "SEC",
          name: "Secret Platform",
          isPrivate: true,
          currentUserIsMember: false,
        }),
      ]),
    );
  });

  it("creates a team with workflow defaults and creator membership", async () => {
    const res = await POST(
      new Request("http://localhost/api/teams", {
        method: "POST",
        body: JSON.stringify({
          name: "Customer Success",
          key: "CS",
          isPrivate: true,
        }),
      }),
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.team).toMatchObject({
      name: "Customer Success",
      key: "CS",
      isPrivate: true,
      memberCount: 1,
      currentUserIsMember: true,
    });

    const persistedMemberships = await db
      .select()
      .from(teamMember)
      .where(eq(teamMember.teamId, data.team.id));
    expect(persistedMemberships.map((row) => row.userId)).toEqual([
      ADMIN_USER_ID,
    ]);

    const states = await db
      .select()
      .from(workflowState)
      .where(eq(workflowState.teamId, data.team.id));
    expect(states.length).toBeGreaterThan(0);
  });

  it("allows regular members to create teams when the workspace policy allows members", async () => {
    await db
      .update(workspace)
      .set({
        settings: {
          security: {
            permissions: {
              teamCreationRole: "members",
            },
          },
        },
      })
      .where(eq(workspace.id, TEST_WS_ID));
    mockSession(MEMBER_USER_ID);

    const res = await POST(
      new Request("http://localhost/api/teams", {
        method: "POST",
        body: JSON.stringify({ name: "Support", key: "SUP" }),
      }),
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.team).toMatchObject({
      name: "Support",
      key: "SUP",
      memberCount: 1,
      currentUserIsMember: true,
    });

    const persistedMemberships = await db
      .select()
      .from(teamMember)
      .where(eq(teamMember.teamId, data.team.id));
    expect(persistedMemberships.map((row) => row.userId)).toEqual([
      MEMBER_USER_ID,
    ]);
  });

  it("validates team creation and blocks members when the workspace policy is admins only", async () => {
    const invalidRes = await POST(
      new Request("http://localhost/api/teams", {
        method: "POST",
        body: JSON.stringify({ name: " ", key: "BAD KEY" }),
      }),
    );
    expect(invalidRes.status).toBe(400);
    await expect(invalidRes.json()).resolves.toMatchObject({
      error: "Team name is required",
    });

    const duplicateRes = await POST(
      new Request("http://localhost/api/teams", {
        method: "POST",
        body: JSON.stringify({ name: "Other Engineering", key: "ENG" }),
      }),
    );
    expect(duplicateRes.status).toBe(409);
    await expect(duplicateRes.json()).resolves.toMatchObject({
      error: "A team with this key already exists",
    });

    mockSession(MEMBER_USER_ID);
    const forbiddenRes = await POST(
      new Request("http://localhost/api/teams", {
        method: "POST",
        body: JSON.stringify({ name: "Support", key: "SUP" }),
      }),
    );
    expect(forbiddenRes.status).toBe(403);
  });
});
