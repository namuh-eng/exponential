import { readAccountPreferencesFromUserSettings } from "@/lib/account-preferences";
import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  cycle,
  issue,
  issueLabel,
  project,
  projectMilestone,
  team,
  teamMember,
  user,
  workflowState,
} from "@/lib/db/schema";
import { normalizeIssueDescriptionHtml } from "@/lib/issue-description";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import { normalizeApplicableIssueLabelIds } from "@/lib/label-application";
import {
  buildNotificationValues,
  insertNotifications,
} from "@/lib/notifications";
import { activeTeamFilter, isTeamRetired } from "@/lib/team-lifecycle";
import { readTeamSettings } from "@/lib/team-settings";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const body = await request.json();
  const {
    title,
    description,
    teamId,
    stateId,
    priority,
    assigneeId,
    projectId,
    cycleId,
    labelIds,
    parentIssueId,
    projectMilestoneId,
  } = body;

  const trimmedTitle = typeof title === "string" ? title.trim() : "";

  if (!trimmedTitle || !teamId) {
    return NextResponse.json(
      { error: "Title and teamId are required" },
      { status: 400 },
    );
  }

  // Get team to generate identifier
  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const teams = await db
    .select({
      id: team.id,
      key: team.key,
      workspaceId: team.workspaceId,
      settings: team.settings,
      retiredAt: team.retiredAt,
      deletedAt: team.deletedAt,
    })
    .from(team)
    .where(and(eq(team.id, teamId), activeTeamFilter))
    .limit(1);

  if (teams.length === 0) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const teamRecord = teams[0];
  if (teamRecord.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  if (isTeamRetired(teamRecord)) {
    return NextResponse.json(
      { error: "Retired teams cannot accept new issues" },
      { status: 409 },
    );
  }

  // Get next issue number for this team
  const maxResult = await db
    .select({ maxNum: sql<number>`COALESCE(MAX(${issue.number}), 0)` })
    .from(issue)
    .where(eq(issue.teamId, teamId));

  const nextNumber = (maxResult[0]?.maxNum ?? 0) + 1;
  const identifier = `${teamRecord.key}-${nextNumber}`;

  // Use provided stateId or find default backlog state
  let finalStateId = stateId;
  if (!finalStateId) {
    const backlogStates = await db
      .select({
        id: workflowState.id,
        isDefault: workflowState.isDefault,
        position: workflowState.position,
      })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.teamId, teamId),
          eq(workflowState.category, "backlog"),
        ),
      )
      .limit(1000);

    finalStateId = backlogStates.sort(
      (a, b) =>
        Number(b.isDefault === true) - Number(a.isDefault === true) ||
        Number(a.position) - Number(b.position),
    )[0]?.id;
  }

  if (!finalStateId) {
    return NextResponse.json(
      { error: "No default workflow state found" },
      { status: 400 },
    );
  }

  let finalAssigneeId = assigneeId || null;
  if (!finalAssigneeId) {
    const [currentUser] = await db
      .select({ settings: user.settings })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);
    const accountPreferences = readAccountPreferencesFromUserSettings(
      currentUser?.settings,
    );
    if (accountPreferences.automations.autoAssignment === "assign-to-me") {
      finalAssigneeId = session.user.id;
    }
  }

  const teamFlags = readTeamSettings(teamRecord.settings);
  if (!finalAssigneeId && teamFlags.autoAssignment) {
    const candidateMembers = await db
      .select({ userId: teamMember.userId })
      .from(teamMember)
      .where(eq(teamMember.teamId, teamId));

    const candidateUserIds = candidateMembers.map(
      (candidate) => candidate.userId,
    );
    if (candidateUserIds.length > 0) {
      const loadRows = await db
        .select({ assigneeId: issue.assigneeId, value: sql<number>`COUNT(*)` })
        .from(issue)
        .where(
          and(
            eq(issue.teamId, teamId),
            inArray(issue.assigneeId, candidateUserIds),
          ),
        )
        .groupBy(issue.assigneeId);
      const loadByUserId = new Map(
        loadRows.flatMap((row) =>
          row.assigneeId ? [[row.assigneeId, Number(row.value)]] : [],
        ),
      );

      finalAssigneeId =
        [...candidateUserIds].sort((left, right) => {
          const loadDelta =
            (loadByUserId.get(left) ?? 0) - (loadByUserId.get(right) ?? 0);
          return loadDelta === 0 ? left.localeCompare(right) : loadDelta;
        })[0] ?? null;
    }
  }

  const finalCycleId = cycleId || null;
  if (finalCycleId) {
    const [cycleRecord] = await db
      .select({ id: cycle.id })
      .from(cycle)
      .where(and(eq(cycle.id, finalCycleId), eq(cycle.teamId, teamId)))
      .limit(1);

    if (!cycleRecord) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 400 });
    }
  }

  const normalizedDescription = normalizeIssueDescriptionHtml(description);
  const normalizedLabels = await normalizeApplicableIssueLabelIds({
    db,
    labelIds,
    workspaceId,
    teamId,
  });
  if (!normalizedLabels.ok) {
    return NextResponse.json(
      { error: normalizedLabels.error },
      { status: 400 },
    );
  }

  const finalProjectMilestoneId = projectMilestoneId || null;
  if (finalProjectMilestoneId) {
    if (!projectId) {
      return NextResponse.json(
        { error: "Project is required for milestone assignment" },
        { status: 400 },
      );
    }
    const milestoneRows = await db
      .select({
        id: projectMilestone.id,
        projectId: projectMilestone.projectId,
      })
      .from(projectMilestone)
      .innerJoin(project, eq(projectMilestone.projectId, project.id))
      .where(
        and(
          eq(projectMilestone.id, finalProjectMilestoneId),
          eq(projectMilestone.projectId, projectId),
          eq(project.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!milestoneRows[0]) {
      return NextResponse.json(
        { error: "Project milestone not found" },
        { status: 400 },
      );
    }
  }

  const newIssue = await db.transaction(async (tx) => {
    const [createdIssue] = await tx
      .insert(issue)
      .values({
        number: nextNumber,
        identifier,
        title: trimmedTitle,
        description: normalizedDescription,
        teamId,
        stateId: finalStateId,
        creatorId: session.user.id,
        priority: priority || "none",
        assigneeId: finalAssigneeId,
        projectId: projectId || null,
        ...(finalProjectMilestoneId
          ? { projectMilestoneId: finalProjectMilestoneId }
          : {}),
        cycleId: finalCycleId,
        parentIssueId: parentIssueId || null,
      })
      .returning();

    if (normalizedLabels.labelIds.length > 0) {
      await tx.insert(issueLabel).values(
        normalizedLabels.labelIds.map((labelId) => ({
          issueId: createdIssue.id,
          labelId,
        })),
      );
    }

    await insertIssueHistoryEvent(tx, teamRecord, {
      issueId: createdIssue.id,
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      actorEmail: session.user.email ?? null,
      eventType: "created",
      metadata: {
        identifier: createdIssue.identifier,
        title: createdIssue.title,
        teamId,
      },
    });

    return createdIssue;
  });

  if (newIssue.assigneeId) {
    await insertNotifications(
      buildNotificationValues({
        type: "assigned",
        actorId: session.user.id,
        issueId: newIssue.id,
        userIds: [newIssue.assigneeId],
      }),
    );
  }

  return NextResponse.json(newIssue, { status: 201 });
}
