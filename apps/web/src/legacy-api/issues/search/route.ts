import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, member, team, user, workflowState } from "@/lib/db/schema";
import {
  createHeadlessIssuesClient,
  headlessIssuesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { activeTeamFilter } from "@/lib/team-lifecycle";
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
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

  let workspaceId: string | null;
  if ("apiKey" in session) {
    workspaceId = session.apiKey.workspaceId;
  } else if (requestedWorkspaceId) {
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

  if (headlessIssuesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessIssuesClient(token);
    const { data, error, response } = await client.GET("/issues/search", {
      params: { query: { q: query ?? "", workspaceId } },
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  // Search active workspace issues by title or identifier and include every
  // field consumed by the IssueRow renderer.
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
    .innerJoin(team, eq(issue.teamId, team.id))
    .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
    .leftJoin(user, eq(issue.assigneeId, user.id))
    .where(
      and(
        eq(team.workspaceId, workspaceId),
        activeTeamFilter,
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
