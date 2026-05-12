import { GET, PATCH, POST } from "@/app/api/teams/[key]/settings/route";
import { db } from "@/lib/db";
import { member, team, teamMember, user, workspace } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "15000000-0000-0000-0000-000000000001";
const TEST_WS_ID = "15000000-0000-0000-0000-000000000002";
const TEST_TEAM_ID = "15000000-0000-0000-0000-000000000003";

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
    await db.delete(team).where(eq(team.id, TEST_TEAM_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));

    // Seed
    await db.insert(user).values({
      id: TEST_USER_ID,
      name: "Team Test User",
      email: "team-test@example.com",
    });

    await db.insert(workspace).values({
      id: TEST_WS_ID,
      name: "Team Test Workspace",
      urlSlug: "team-test",
    });

    await db.insert(member).values({
      userId: TEST_USER_ID,
      workspaceId: TEST_WS_ID,
      role: "admin",
    });

    await db.insert(team).values({
      id: TEST_TEAM_ID,
      workspaceId: TEST_WS_ID,
      name: "Initial Team",
      key: "INIT",
      icon: "⚙️",
    });

    await db.insert(teamMember).values({
      userId: TEST_USER_ID,
      teamId: TEST_TEAM_ID,
    });
  });

  afterAll(async () => {
    await db.delete(teamMember).where(eq(teamMember.teamId, TEST_TEAM_ID));
    await db.delete(team).where(eq(team.id, TEST_TEAM_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));
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
