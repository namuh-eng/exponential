import { autoJoinWorkspaceForApprovedDomain } from "@/lib/approved-domain-auto-join";
import { db } from "@/lib/db";
import { member, team, teamMember, user, workspace } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_USER_ID = "10000000-0000-0000-0000-000000000001";
const TEST_WS_ID = "10000000-0000-0000-0000-000000000002";
const TEST_TEAM_ID = "10000000-0000-0000-0000-000000000003";

describe("Approved domain auto-join logic", () => {
  beforeAll(async () => {
    // Cleanup
    await db.delete(teamMember).where(eq(teamMember.userId, TEST_USER_ID));
    await db.delete(member).where(eq(member.userId, TEST_USER_ID));
    await db.delete(team).where(eq(team.id, TEST_TEAM_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));

    // Seed
    await db.insert(user).values({
      id: TEST_USER_ID,
      name: "Auto-Join User",
      email: "user@acme.com",
    });

    await db.insert(workspace).values({
      id: TEST_WS_ID,
      name: "Acme Corp",
      urlSlug: "acme",
      approvedEmailDomains: ["acme.com"],
    });

    await db.insert(team).values({
      id: TEST_TEAM_ID,
      workspaceId: TEST_WS_ID,
      name: "Default Team",
      key: "DFT",
    });
  });

  afterAll(async () => {
    await db.delete(teamMember).where(eq(teamMember.userId, TEST_USER_ID));
    await db.delete(member).where(eq(member.userId, TEST_USER_ID));
    await db.delete(team).where(eq(team.id, TEST_TEAM_ID));
    await db.delete(workspace).where(eq(workspace.id, TEST_WS_ID));
    await db.delete(user).where(eq(user.id, TEST_USER_ID));
  });

  it("automatically joins workspace when domain matches", async () => {
    const joinedWorkspaceId = await autoJoinWorkspaceForApprovedDomain({
      userId: TEST_USER_ID,
      email: "user@acme.com",
    });

    expect(joinedWorkspaceId).toBe(TEST_WS_ID);

    // Verify workspace membership
    const [membership] = await db
      .select()
      .from(member)
      .where(
        and(
          eq(member.userId, TEST_USER_ID),
          eq(member.workspaceId, TEST_WS_ID),
        ),
      );
    expect(membership).toBeDefined();
    expect(membership.role).toBe("member");

    // Verify team membership
    const [teamMembership] = await db
      .select()
      .from(teamMember)
      .where(
        and(
          eq(teamMember.userId, TEST_USER_ID),
          eq(teamMember.teamId, TEST_TEAM_ID),
        ),
      );
    expect(teamMembership).toBeDefined();
  });

  it("does not join when domain does not match", async () => {
    const joinedWorkspaceId = await autoJoinWorkspaceForApprovedDomain({
      userId: TEST_USER_ID,
      email: "user@other.com",
    });

    expect(joinedWorkspaceId).toBeNull();
  });
});
