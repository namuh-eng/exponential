import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { issue, member, team, workflowState } from "@/lib/db/schema";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [membership] = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, session.user.id))
    .orderBy(desc(member.createdAt))
    .limit(1);

  if (!membership) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const workspaceId = membership.workspaceId;

  // 1. Issues completed across all teams in the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const completedStats = await db
    .select({
      teamId: team.id,
      teamName: team.name,
      completedCount: count(issue.id),
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
    .where(
      and(
        eq(team.workspaceId, workspaceId),
        eq(workflowState.category, "completed"),
        gte(issue.completedAt, thirtyDaysAgo),
      ),
    )
    .groupBy(team.id, team.name);

  // 2. Active issues (unstarted + started) per team
  const activeStats = await db
    .select({
      teamId: team.id,
      teamName: team.name,
      activeCount: count(issue.id),
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
    .where(
      and(
        eq(team.workspaceId, workspaceId),
        sql`${workflowState.category} IN ('unstarted', 'started')`,
      ),
    )
    .groupBy(team.id, team.name);

  return NextResponse.json({
    workspaceId,
    completedLast30Days: completedStats,
    activeIssues: activeStats,
    period: "Last 30 days",
  });
}
