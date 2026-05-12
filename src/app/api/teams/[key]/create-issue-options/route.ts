import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  label,
  member,
  project,
  team,
  teamMember,
  user,
  workflowState,
} from "@/lib/db/schema";
import { and, asc, eq, isNull, or } from "drizzle-orm";
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

  const [teamContext] = await db
    .select({
      id: team.id,
      name: team.name,
      key: team.key,
      workspaceId: team.workspaceId,
    })
    .from(team)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, team.workspaceId),
        eq(member.userId, session.user.id),
      ),
    )
    .where(eq(team.key, key))
    .limit(1);

  if (!teamContext) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const [statuses, assigneeRows, labels, projects] = await Promise.all([
    db
      .select({
        id: workflowState.id,
        name: workflowState.name,
        category: workflowState.category,
        color: workflowState.color,
      })
      .from(workflowState)
      .where(eq(workflowState.teamId, teamContext.id))
      .orderBy(asc(workflowState.position), asc(workflowState.name)),
    db
      .select({
        id: user.id,
        name: user.name,
        image: user.image,
      })
      .from(teamMember)
      .innerJoin(user, eq(teamMember.userId, user.id))
      .where(eq(teamMember.teamId, teamContext.id))
      .orderBy(asc(user.name)),
    db
      .select({
        id: label.id,
        name: label.name,
        color: label.color,
      })
      .from(label)
      .where(
        and(
          eq(label.workspaceId, teamContext.workspaceId),
          or(isNull(label.teamId), eq(label.teamId, teamContext.id)),
        ),
      )
      .orderBy(asc(label.name)),
    db
      .select({
        id: project.id,
        name: project.name,
        icon: project.icon,
      })
      .from(project)
      .where(eq(project.workspaceId, teamContext.workspaceId))
      .orderBy(asc(project.name)),
  ]);

  const fallbackAssignees =
    assigneeRows.length > 0
      ? assigneeRows
      : [
          {
            id: session.user.id,
            name: session.user.name ?? session.user.email,
            image: session.user.image ?? null,
          },
        ];

  return NextResponse.json({
    team: {
      id: teamContext.id,
      name: teamContext.name,
      key: teamContext.key,
    },
    statuses,
    priorities: [
      { value: "urgent", label: "Urgent" },
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
      { value: "none", label: "No priority" },
    ],
    assignees: fallbackAssignees,
    labels,
    projects,
  });
}
