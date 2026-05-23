import { requireApiSession } from "@/lib/api-auth";
import { cycleRangesOverlap, parseCycleDateInput } from "@/lib/cycle-utils";
import { db } from "@/lib/db";
import { cycle, issue, project, user, workflowState } from "@/lib/db/schema";
import {
  createHeadlessTeamsClient,
  headlessTeamsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { getLabelsForIssues } from "@/lib/issue-labels";
import { findAccessibleTeam } from "@/lib/teams";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string; cycleId: string }> },
) {
  const { response, session } = await requireApiSession();
  if (response) {
    return response;
  }

  const { key, cycleId } = await params;

  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const cycles = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.teamId, teamRecord.id)))
    .limit(1);

  if (cycles.length === 0) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  const cycleRecord = cycles[0];

  // Get workflow states for this team
  const states = await db
    .select()
    .from(workflowState)
    .where(eq(workflowState.teamId, teamRecord.id))
    .orderBy(asc(workflowState.position));

  // Get issues in this cycle
  const issues = await db
    .select({
      id: issue.id,
      number: issue.number,
      identifier: issue.identifier,
      title: issue.title,
      priority: issue.priority,
      stateId: issue.stateId,
      assigneeId: issue.assigneeId,
      assigneeName: user.name,
      assigneeImage: user.image,
      creatorId: issue.creatorId,
      projectId: issue.projectId,
      projectName: project.name,
      cycleId: issue.cycleId,
      estimate: issue.estimate,
      dueDate: issue.dueDate,
      createdAt: issue.createdAt,
      sortOrder: issue.sortOrder,
    })
    .from(issue)
    .leftJoin(user, eq(issue.assigneeId, user.id))
    .leftJoin(project, eq(issue.projectId, project.id))
    .where(
      and(
        eq(issue.cycleId, cycleId),
        eq(issue.teamId, teamRecord.id),
        isNull(issue.archivedAt),
      ),
    )
    .orderBy(asc(issue.sortOrder), desc(issue.createdAt));

  // Get labels for issues
  const issueIds = issues.map((i) => i.id);
  const labelsMap = await getLabelsForIssues(issueIds);

  // Group issues by workflow state
  const completedStates = states.filter((s) => s.category === "completed");
  const completedStateIds = new Set(completedStates.map((s) => s.id));

  const groups = states.map((state) => ({
    state: {
      id: state.id,
      name: state.name,
      category: state.category,
      color: state.color,
      position: state.position,
    },
    issues: issues
      .filter((i) => i.stateId === state.id)
      .map((i) => ({
        id: i.id,
        number: i.number,
        identifier: i.identifier,
        title: i.title,
        priority: i.priority,
        stateId: i.stateId,
        assigneeId: i.assigneeId,
        assignee: i.assigneeName
          ? { name: i.assigneeName, image: i.assigneeImage }
          : null,
        creatorId: i.creatorId,
        labels: labelsMap[i.id] ?? [],
        labelIds: (labelsMap[i.id] ?? []).map((l) => l.id),
        projectId: i.projectId,
        projectName: i.projectName,
        cycleId: i.cycleId,
        cycleName: cycleRecord.name ?? `Cycle ${cycleRecord.number}`,
        estimate: i.estimate,
        dueDate: i.dueDate,
        createdAt: i.createdAt,
      })),
  }));

  const uniqueAssignees: { id: string; name: string; image: string | null }[] =
    [];
  const seenAssignees = new Set<string>();
  for (const i of issues) {
    if (i.assigneeId && i.assigneeName && !seenAssignees.has(i.assigneeId)) {
      seenAssignees.add(i.assigneeId);
      uniqueAssignees.push({
        id: i.assigneeId,
        name: i.assigneeName,
        image: i.assigneeImage,
      });
    }
  }

  const uniqueLabels: { id: string; name: string; color: string }[] = [];
  const seenLabels = new Set<string>();
  for (const labelList of Object.values(labelsMap)) {
    for (const label of labelList) {
      if (!seenLabels.has(label.id)) {
        seenLabels.add(label.id);
        uniqueLabels.push(label);
      }
    }
  }

  const uniqueProjects = issues
    .filter((i) => i.projectId && i.projectName)
    .reduce<{ id: string; name: string }[]>((projects, issueRecord) => {
      if (projects.some((item) => item.id === issueRecord.projectId)) {
        return projects;
      }

      projects.push({
        id: issueRecord.projectId as string,
        name: issueRecord.projectName as string,
      });
      return projects;
    }, []);

  const uniqueEstimates = [
    ...new Set(issues.map((i) => i.estimate).filter((value) => value !== null)),
  ]
    .sort((a, b) => Number(a) - Number(b))
    .map((value) => ({ value: String(value), label: String(value) }));

  const uniqueDueDates = [
    ...new Set(
      issues
        .map((i) => (i.dueDate ? i.dueDate.toISOString().split("T")[0] : null))
        .filter((value): value is string => !!value),
    ),
  ]
    .sort()
    .map((value) => ({
      value,
      label: new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year:
          new Date(`${value}T00:00:00`).getFullYear() !==
          new Date().getFullYear()
            ? "numeric"
            : undefined,
      }),
    }));

  return NextResponse.json({
    team: { id: teamRecord.id, name: teamRecord.name, key: teamRecord.key },
    cycle: {
      ...cycleRecord,
      issueCount: issues.length,
      completedIssueCount: issues.filter((i) =>
        completedStateIds.has(i.stateId),
      ).length,
    },
    groups,
    filterOptions: {
      statuses: states.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        color: s.color,
      })),
      assignees: uniqueAssignees,
      labels: uniqueLabels,
      projects: uniqueProjects,
      creators: [],
      cycles: [
        {
          id: cycleRecord.id,
          name: cycleRecord.name ?? `Cycle ${cycleRecord.number}`,
        },
      ],
      estimates: uniqueEstimates,
      dueDates: uniqueDueDates,
      teams: [{ id: teamRecord.id, name: teamRecord.name }],
      priorities: [
        { value: "urgent", label: "Urgent" },
        { value: "high", label: "High" },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
        { value: "none", label: "No priority" },
      ],
    },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string; cycleId: string }> },
) {
  const { response, session } = await requireApiSession();
  if (response) {
    return response;
  }

  const { key, cycleId } = await params;
  const body = await request.json();

  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const teamId = teamRecord.id;

  if (headlessTeamsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const client = createHeadlessTeamsClient(token);
    const { data, error, response } = await client.PATCH(
      "/teams/{key}/cycles/{cycle_id}",
      {
        params: { path: { key, cycle_id: cycleId } },
        body: body as never,
      },
    );
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const existingCycles = await db
    .select({
      id: cycle.id,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
    })
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.teamId, teamId)))
    .limit(1);

  if (existingCycles.length === 0) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  const existingCycle = existingCycles[0];
  const nextStartDate =
    body.startDate !== undefined
      ? parseCycleDateInput(body.startDate)
      : existingCycle.startDate;
  const nextEndDate =
    body.endDate !== undefined
      ? parseCycleDateInput(body.endDate)
      : existingCycle.endDate;

  if (!nextStartDate || !nextEndDate) {
    return NextResponse.json(
      { error: "Start and end dates must use YYYY-MM-DD format" },
      { status: 400 },
    );
  }

  if (nextStartDate.getTime() > nextEndDate.getTime()) {
    return NextResponse.json(
      { error: "Cycle end date must be on or after the start date" },
      { status: 400 },
    );
  }

  const allTeamCycles = await db
    .select({
      id: cycle.id,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
    })
    .from(cycle)
    .where(eq(cycle.teamId, teamId));

  const overlappingCycle = allTeamCycles.find(
    (teamCycle) =>
      teamCycle.id !== cycleId &&
      cycleRangesOverlap(
        nextStartDate,
        nextEndDate,
        teamCycle.startDate,
        teamCycle.endDate,
      ),
  );

  if (overlappingCycle) {
    return NextResponse.json(
      { error: "Cycle dates overlap with an existing cycle" },
      { status: 409 },
    );
  }

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
    startDate: nextStartDate,
    endDate: nextEndDate,
  };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.autoRollover !== undefined)
    updateData.autoRollover = body.autoRollover;

  const updated = await db
    .update(cycle)
    .set(updateData)
    .where(and(eq(cycle.id, cycleId), eq(cycle.teamId, teamId)))
    .returning();

  if (updated.length === 0) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  return NextResponse.json(updated[0]);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string; cycleId: string }> },
) {
  const { response, session } = await requireApiSession();
  if (response) {
    return response;
  }

  const { key, cycleId } = await params;

  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const teamId = teamRecord.id;

  if (headlessTeamsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const client = createHeadlessTeamsClient(token);
    const { data, error, response } = await client.DELETE(
      "/teams/{key}/cycles/{cycle_id}",
      {
        params: { path: { key, cycle_id: cycleId } },
      },
    );
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const existingCycles = await db
    .select({ id: cycle.id })
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.teamId, teamId)))
    .limit(1);

  if (existingCycles.length === 0) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  // Unlink only issues belonging to the scoped team before deleting.
  await db
    .update(issue)
    .set({ cycleId: null })
    .where(and(eq(issue.cycleId, cycleId), eq(issue.teamId, teamId)));

  await db
    .delete(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.teamId, teamId)))
    .returning();

  return NextResponse.json({ success: true });
}
