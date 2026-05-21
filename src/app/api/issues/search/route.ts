import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, member, team, user, workflowState } from "@/lib/db/schema";
import { activeTeamFilter } from "@/lib/team-lifecycle";
import { and, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  const requestedWorkspaceId = searchParams.get("workspaceId")?.trim();

  if (!query || query.length === 0) {
    return NextResponse.json([]);
  }

  let workspaceId: string | null = null;

  if (requestedWorkspaceId) {
    const memberships = await db
      .select({ workspaceId: member.workspaceId })
      .from(member)
      .where(
        and(
          eq(member.userId, session.user.id),
          eq(member.workspaceId, requestedWorkspaceId),
        ),
      )
      .limit(1);

    workspaceId = memberships[0]?.workspaceId ?? null;
  } else {
    workspaceId =
      (await resolveRequestWorkspaceId(session.user.id, request)) ?? null;
  }

  if (!workspaceId) {
    return NextResponse.json([]);
  }

  // Get workspace teams
  const workspaceTeams = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.workspaceId, workspaceId), activeTeamFilter));

  const teamIds = workspaceTeams.map((t) => t.id);

  if (teamIds.length === 0) {
    return NextResponse.json([]);
  }

  // Search issues by title or identifier and include the row metadata needed
  // by the results page. Without state, date, and canonical team details,
  // results render broken icons/dates and link to unusable rows.
  const results = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      priority: issue.priority,
      createdAt: issue.createdAt,
      teamKey: team.key,
      stateName: workflowState.name,
      stateCategory: workflowState.category,
      stateColor: workflowState.color,
      assigneeName: user.name,
      assigneeImage: user.image,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
    .leftJoin(user, eq(issue.assigneeId, user.id))
    .where(
      and(
        inArray(issue.teamId, teamIds),
        isNull(issue.archivedAt),
        or(
          ilike(issue.title, `%${query}%`),
          ilike(issue.identifier, `%${query}%`),
        ),
      ),
    )
    .orderBy(desc(issue.createdAt))
    .limit(10);

  return NextResponse.json(results);
}
