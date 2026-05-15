import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  cycle,
  issue,
  issueLabel,
  label,
  member,
  project,
  team,
  workflowState,
} from "@/lib/db/schema";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import { normalizeBulkIssueLabelIds } from "@/lib/label-application";
import { canAccessTeam, getWorkspaceMember } from "@/lib/teams";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";

const PRIORITIES = new Set(["none", "urgent", "high", "medium", "low"]);

type BulkIssueUpdates = {
  stateId?: string | null;
  assigneeId?: string | null;
  priority?: string | null;
  labelIds?: string[];
  projectId?: string | null;
  cycleId?: string | null;
  dueDate?: string | null;
  archive?: boolean;
  delete?: boolean;
};

function uniqueStrings(values: unknown): string[] {
  return Array.isArray(values)
    ? [
        ...new Set(
          values.filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          ),
        ),
      ]
    : [];
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const body = (await request.json()) as {
    issueIds?: unknown;
    updates?: BulkIssueUpdates;
  };
  const issueIds = uniqueStrings(body.issueIds);
  const updates = body.updates ?? {};

  if (issueIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one issue" },
      { status: 400 },
    );
  }
  if (issueIds.length > 200) {
    return NextResponse.json(
      { error: "Bulk updates are limited to 200 issues" },
      { status: 400 },
    );
  }

  const workspaceMember = await getWorkspaceMember(
    workspaceId,
    session.user.id,
  );
  if (!workspaceMember) {
    return NextResponse.json(
      { error: "Workspace access required" },
      { status: 403 },
    );
  }

  const selectedIssues = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      teamId: issue.teamId,
      teamSettings: team.settings,
      isPrivate: team.isPrivate,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(inArray(issue.id, issueIds), eq(team.workspaceId, workspaceId)));

  if (selectedIssues.length !== issueIds.length) {
    return NextResponse.json(
      { error: "One or more issues were not found" },
      { status: 404 },
    );
  }

  for (const selectedIssue of selectedIssues) {
    if (
      selectedIssue.isPrivate &&
      !(await canAccessTeam(
        session.user.id,
        selectedIssue.teamId,
        workspaceMember.role,
      ))
    ) {
      return NextResponse.json(
        { error: "Team access required" },
        { status: 403 },
      );
    }
  }

  const teamIds = [
    ...new Set(selectedIssues.map((selectedIssue) => selectedIssue.teamId)),
  ];
  const updateData: Partial<typeof issue.$inferInsert> = {
    updatedAt: new Date(),
  };
  const changedFields: string[] = [];

  if (updates.stateId !== undefined) {
    if (!updates.stateId) {
      return NextResponse.json(
        { error: "Status is required" },
        { status: 400 },
      );
    }
    const [stateRecord] = await db
      .select({
        id: workflowState.id,
        teamId: workflowState.teamId,
        category: workflowState.category,
      })
      .from(workflowState)
      .where(eq(workflowState.id, updates.stateId))
      .limit(1);

    if (
      !stateRecord ||
      teamIds.some((teamId) => teamId !== stateRecord.teamId)
    ) {
      return NextResponse.json(
        { error: "Workflow state not found for selected issues" },
        { status: 400 },
      );
    }

    updateData.stateId = stateRecord.id;
    updateData.completedAt =
      stateRecord.category === "completed" ? new Date() : null;
    updateData.canceledAt =
      stateRecord.category === "canceled" ? new Date() : null;
    changedFields.push("stateId");
  }

  if (updates.assigneeId !== undefined) {
    if (updates.assigneeId) {
      const [assigneeMember] = await db
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.workspaceId, workspaceId),
            eq(member.userId, updates.assigneeId),
          ),
        )
        .limit(1);
      if (!assigneeMember) {
        return NextResponse.json(
          { error: "Assignee is not a workspace member" },
          { status: 400 },
        );
      }
    }
    updateData.assigneeId = updates.assigneeId;
    changedFields.push("assigneeId");
  }

  if (updates.priority !== undefined) {
    const nextPriority = updates.priority ?? "none";
    if (!PRIORITIES.has(nextPriority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }
    updateData.priority = nextPriority as typeof issue.$inferInsert.priority;
    changedFields.push("priority");
  }

  if (updates.projectId !== undefined) {
    if (updates.projectId) {
      const [projectRecord] = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(
            eq(project.id, updates.projectId),
            eq(project.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!projectRecord) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 400 },
        );
      }
    }
    updateData.projectId = updates.projectId;
    changedFields.push("projectId");
  }

  if (updates.cycleId !== undefined) {
    if (updates.cycleId) {
      const [cycleRecord] = await db
        .select({ id: cycle.id, teamId: cycle.teamId })
        .from(cycle)
        .where(eq(cycle.id, updates.cycleId))
        .limit(1);
      if (!cycleRecord || !teamIds.includes(cycleRecord.teamId)) {
        return NextResponse.json(
          { error: "Cycle not found for selected issues" },
          { status: 400 },
        );
      }
    }
    updateData.cycleId = updates.cycleId;
    changedFields.push("cycleId");
  }

  if (updates.dueDate !== undefined) {
    const nextDueDate = updates.dueDate
      ? new Date(`${updates.dueDate}T00:00:00`)
      : null;
    if (nextDueDate && Number.isNaN(nextDueDate.getTime())) {
      return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
    }
    updateData.dueDate = nextDueDate;
    changedFields.push("dueDate");
  }

  if (updates.archive !== undefined) {
    updateData.archivedAt = updates.archive ? new Date() : null;
    changedFields.push("archivedAt");
  }

  let labelIds: string[] | undefined;
  if (updates.labelIds !== undefined) {
    const normalizedLabels = await normalizeBulkIssueLabelIds({
      db,
      labelIds: updates.labelIds,
      workspaceId,
      teamIds,
    });
    if (!normalizedLabels.ok) {
      return NextResponse.json(
        { error: normalizedLabels.error },
        { status: 400 },
      );
    }
    labelIds = normalizedLabels.labelIds;
    changedFields.push("labelIds");
  }

  const updated = await db.transaction(async (tx) => {
    if (updates.delete) {
      await tx.delete(issue).where(inArray(issue.id, issueIds));
    } else if (
      Object.keys(updateData).length > 1 ||
      updates.archive !== undefined
    ) {
      await tx.update(issue).set(updateData).where(inArray(issue.id, issueIds));
    }

    if (labelIds !== undefined) {
      await tx.delete(issueLabel).where(inArray(issueLabel.issueId, issueIds));
      if (labelIds.length > 0) {
        await tx
          .insert(issueLabel)
          .values(
            issueIds.flatMap((issueId) =>
              labelIds.map((labelId) => ({ issueId, labelId })),
            ),
          );
      }
    }

    if (changedFields.length > 0) {
      await Promise.all(
        selectedIssues.map((selectedIssue) =>
          insertIssueHistoryEvent(
            tx,
            { settings: selectedIssue.teamSettings },
            {
              issueId: selectedIssue.id,
              actorId: session.user.id,
              actorName: session.user.name ?? null,
              actorEmail: session.user.email ?? null,
              eventType: "updated",
              metadata: {
                changedFields,
                identifier: selectedIssue.identifier,
                bulk: true,
              },
            },
          ),
        ),
      );
    }

    return { updatedCount: selectedIssues.length };
  });

  return NextResponse.json(updated);
}
