import { db } from "@/lib/db";
import { member, team, teamMember, workspace } from "@/lib/db/schema";
import { activeTeamFilter } from "@/lib/team-lifecycle";
import { and, asc, eq, sql } from "drizzle-orm";

function extractEmailDomain(email: string | null | undefined) {
  if (!email) {
    return null;
  }

  const [, domain] = email.trim().toLowerCase().split("@");
  return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain : null;
}

export async function autoJoinWorkspaceForApprovedDomain(input: {
  userId: string;
  email: string | null | undefined;
}) {
  const domain = extractEmailDomain(input.email);
  if (!domain) {
    return null;
  }

  const [matchedWorkspace] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      sql`${workspace.approvedEmailDomains} @> ${JSON.stringify([domain])}::jsonb`,
    )
    .orderBy(asc(workspace.createdAt))
    .limit(1);

  if (!matchedWorkspace) {
    return null;
  }

  const [existingMembership] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.userId, input.userId),
        eq(member.workspaceId, matchedWorkspace.id),
      ),
    )
    .limit(1);

  if (!existingMembership) {
    await db.insert(member).values({
      userId: input.userId,
      workspaceId: matchedWorkspace.id,
      role: "member",
    });
  }

  const [defaultTeam] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.workspaceId, matchedWorkspace.id), activeTeamFilter))
    .orderBy(asc(team.createdAt))
    .limit(1);

  if (defaultTeam) {
    await db
      .insert(teamMember)
      .values({
        teamId: defaultTeam.id,
        userId: input.userId,
      })
      .onConflictDoNothing();
  }

  return matchedWorkspace.id;
}
