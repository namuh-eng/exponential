import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  cycle,
  label,
  project,
  teamMember,
  user,
  workflowState,
} from "@/lib/db/schema";
import { isTeamRetired } from "@/lib/team-lifecycle";
import { findAccessibleTeam } from "@/lib/teams";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;

  const teamContext = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamContext) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (isTeamRetired(teamContext)) {
    return NextResponse.json(
      { error: "Retired teams cannot accept new issues" },
      { status: 409 },
    );
  }

  const [statuses, assigneeRows, labels, projects, cycles] = await Promise.all([
    db
      .select({
        id: workflowState.id,
        name: workflowState.name,
        category: workflowState.category,
        color: workflowState.color,
        isDefault: workflowState.isDefault,
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
          isNull(label.archivedAt),
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
    db
      .select({ id: cycle.id, name: cycle.name, number: cycle.number })
      .from(cycle)
      .where(eq(cycle.teamId, teamContext.id))
      .orderBy(asc(cycle.number)),
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

  const teamSettings =
    teamContext.settings && typeof teamContext.settings === "object"
      ? (teamContext.settings as { statusBehaviors?: Record<string, unknown> })
      : {};
  const statusesWithBehavior = statuses.map((status) => ({
    ...status,
    behavior: teamSettings.statusBehaviors?.[status.id] ?? {},
  }));

  return NextResponse.json({
    team: {
      id: teamContext.id,
      name: teamContext.name,
      key: teamContext.key,
    },
    statuses: statusesWithBehavior,
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
    cycles,
    estimates: [1, 2, 3, 5, 8].map((value) => ({
      value,
      label: `${value} points`,
    })),
  });
}
