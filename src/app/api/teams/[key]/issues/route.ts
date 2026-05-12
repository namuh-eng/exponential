import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { cycle, issue, project, user, workflowState } from "@/lib/db/schema";
import { getLabelsForIssues } from "@/lib/issue-labels";
import { getTeamByKey } from "@/lib/teams";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
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

  const teamRecord = await getTeamByKey(key);
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  // Get workflow states for this team
  const states = await db
    .select()
    .from(workflowState)
    .where(eq(workflowState.teamId, teamRecord.id))
    .orderBy(asc(workflowState.position));

  // Get issues with assignee info
  const issues = await db
    .select({
      id: issue.id,
      number: issue.number,
      identifier: issue.identifier,
      title: issue.title,
      priority: issue.priority,
      stateId: issue.stateId,
      assigneeId: issue.assigneeId,
      creatorId: issue.creatorId,
      assigneeName: user.name,
      assigneeImage: user.image,
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
    .where(eq(issue.teamId, teamRecord.id))
    .orderBy(asc(issue.sortOrder), desc(issue.createdAt));

  // Get labels for all issues
  const issueIds = issues.map((i) => i.id);
  const labelsMap = await getLabelsForIssues(issueIds);

  const creatorIds = [
    ...new Set(
      issues.map((i) => i.creatorId).filter((id): id is string => !!id),
    ),
  ];
  const creators =
    creatorIds.length > 0
      ? await db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, creatorIds))
      : [];
  const creatorMap = new Map(
    creators.map((creator) => [creator.id, creator.name ?? "Unknown user"]),
  );

  const cycleIds = [
    ...new Set(issues.map((i) => i.cycleId).filter((id): id is string => !!id)),
  ];
  const cycles =
    cycleIds.length > 0
      ? await db
          .select({ id: cycle.id, name: cycle.name, number: cycle.number })
          .from(cycle)
          .where(inArray(cycle.id, cycleIds))
      : [];
  const cycleMap = new Map(
    cycles.map((item) => [item.id, item.name ?? `Cycle ${item.number}`]),
  );

  // Group issues by workflow state
  const grouped = states.map((state) => ({
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
          ? {
              name: i.assigneeName,
              image: i.assigneeImage,
            }
          : null,
        creatorId: i.creatorId,
        creatorName: creatorMap.get(i.creatorId) ?? null,
        labels: labelsMap[i.id] ?? [],
        labelIds: (labelsMap[i.id] ?? []).map((l) => l.name),
        projectId: i.projectId,
        projectName: i.projectName,
        cycleId: i.cycleId,
        cycleName: i.cycleId ? (cycleMap.get(i.cycleId) ?? null) : null,
        estimate: i.estimate,
        dueDate: i.dueDate,
        createdAt: i.createdAt,
      })),
  }));

  // Build unique assignees and labels for filter options
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
    for (const l of labelList) {
      if (!seenLabels.has(l.name)) {
        seenLabels.add(l.name);
        uniqueLabels.push({ id: l.name, name: l.name, color: l.color });
      }
    }
  }

  const uniqueProjects = issues
    .filter((i) => i.projectId && i.projectName)
    .reduce<{ id: string; name: string }[]>((projects, issueRecord) => {
      if (
        projects.some(
          (projectRecord) => projectRecord.id === issueRecord.projectId,
        )
      ) {
        return projects;
      }

      projects.push({
        id: issueRecord.projectId as string,
        name: issueRecord.projectName as string,
      });
      return projects;
    }, []);

  const uniqueCreators = creators
    .filter((creator) => creator.name)
    .map((creator) => ({
      id: creator.id,
      name: creator.name as string,
    }));

  const uniqueCycles = cycles.map((item) => ({
    id: item.id,
    name: item.name ?? `Cycle ${item.number}`,
  }));

  const uniqueEstimates = [
    ...new Set(issues.map((i) => i.estimate).filter((value) => value !== null)),
  ]
    .sort((a, b) => Number(a) - Number(b))
    .map((value) => ({
      value: String(value),
      label: String(value),
    }));

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
    groups: grouped,
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
      creators: uniqueCreators,
      cycles: uniqueCycles,
      estimates: uniqueEstimates,
      dueDates: uniqueDueDates,
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
