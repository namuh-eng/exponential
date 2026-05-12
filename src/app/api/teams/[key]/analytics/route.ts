import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { cycle, issue, team, workflowState } from "@/lib/db/schema";
import { findAccessibleTeam } from "@/lib/teams";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id);

  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  // 1. Completion rate for recent cycles
  const recentCycles = await db
    .select({
      id: cycle.id,
      name: cycle.name,
      number: cycle.number,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
    })
    .from(cycle)
    .where(eq(cycle.teamId, teamRecord.id))
    .orderBy(desc(cycle.endDate))
    .limit(5);

  const completedStates = await db
    .select({ id: workflowState.id })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, teamRecord.id),
        eq(workflowState.category, "completed"),
      ),
    );
  const completedIds = completedStates.map((s) => s.id);

  const cycleMetrics = await Promise.all(
    recentCycles.map(async (c) => {
      const totalResult = await db
        .select({ val: count() })
        .from(issue)
        .where(eq(issue.cycleId, c.id));
      const total = totalResult[0].val;

      let completed = 0;
      if (completedIds.length > 0 && total > 0) {
        const compResult = await db
          .select({ val: count() })
          .from(issue)
          .where(
            and(
              eq(issue.cycleId, c.id),
              sql`${issue.stateId} IN (${sql.join(
                completedIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            ),
          );
        completed = compResult[0].val;
      }

      return {
        id: c.id,
        name: c.name || `Cycle ${c.number}`,
        total,
        completed,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    }),
  );

  // 2. Velocity (issues completed per week over last 4 weeks)
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const recentlyCompleted = await db
    .select({ val: count() })
    .from(issue)
    .where(
      and(
        eq(issue.teamId, teamRecord.id),
        gte(issue.completedAt, fourWeeksAgo),
        sql`${issue.stateId} IN (${sql.join(
          completedIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );

  const velocity = Math.round((recentlyCompleted[0].val || 0) / 4);

  return NextResponse.json({
    team: { id: teamRecord.id, name: teamRecord.name },
    cycleMetrics,
    velocity,
    period: "Last 4 weeks",
  });
}
