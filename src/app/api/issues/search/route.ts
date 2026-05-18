import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  issue,
  member,
  team,
  user,
  workflowState,
  workspace,
} from "@/lib/db/schema";
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
  const requestedWorkspaceSlug = searchParams.get("workspaceSlug")?.trim();

  if (!query || query.length === 0) {
    return NextResponse.json([]);
  }

  // Get the user's active/requested workspace. Workspace-prefixed pages pass
  // workspaceSlug so search does not accidentally query another membership.
  const membershipFilters = [eq(member.userId, session.user.id)];
  if (requestedWorkspaceId) {
    membershipFilters.push(eq(member.workspaceId, requestedWorkspaceId));
  }

  const memberships = requestedWorkspaceSlug
    ? await db
        .select({ workspaceId: member.workspaceId })
        .from(member)
        .innerJoin(workspace, eq(member.workspaceId, workspace.id))
        .where(
          and(
            ...membershipFilters,
            eq(workspace.urlSlug, requestedWorkspaceSlug),
          ),
        )
        .limit(1)
    : await db
        .select({ workspaceId: member.workspaceId })
        .from(member)
        .where(and(...membershipFilters))
        .limit(1);

  if (memberships.length === 0) {
    return NextResponse.json([]);
  }

  const workspaceId = memberships[0].workspaceId;

  // Get workspace teams
  const workspaceTeams = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.workspaceId, workspaceId), activeTeamFilter));

  const teamIds = workspaceTeams.map((t) => t.id);

  if (teamIds.length === 0) {
    return NextResponse.json([]);
  }

  // Search issues by title or identifier and return the complete row contract
  // consumed by the global search destination.
  const results = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      priority: issue.priority,
      stateName: workflowState.name,
      stateCategory: workflowState.category,
      stateColor: workflowState.color,
      assigneeName: user.name,
      assigneeImage: user.image,
      createdAt: issue.createdAt,
    })
    .from(issue)
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
