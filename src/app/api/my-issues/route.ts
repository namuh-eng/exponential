import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  comment,
  issue,
  member,
  project,
  team,
  user,
  workflowState,
} from "@/lib/db/schema";
import { getLabelsForIssues } from "@/lib/issue-labels";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const userId = session.user.id;
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "assigned";

  // Get user's workspace
  const memberships = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(desc(member.createdAt))
    .limit(1);

  if (memberships.length === 0) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const workspaceId = memberships[0].workspaceId;

  // Get all teams in workspace
  const teams = await db
    .select({ id: team.id, name: team.name, key: team.key })
    .from(team)
    .where(eq(team.workspaceId, workspaceId));

  const teamIds = teams.map((t) => t.id);
  if (teamIds.length === 0) {
    return NextResponse.json({ groups: [], filterOptions: emptyFilterOptions });
  }

  // Get all workflow states for workspace teams
  const states = await db
    .select()
    .from(workflowState)
    .where(inArray(workflowState.teamId, teamIds))
    .orderBy(asc(workflowState.position));

  // Determine which issues to fetch based on tab
  let issues: IssueRecord[];

  if (tab === "assigned") {
    issues = await fetchIssuesByAssignee(userId, teamIds);
  } else if (tab === "created") {
    issues = await fetchIssuesByCreator(userId, teamIds);
  } else if (tab === "subscribed") {
    issues = sortIssuesByUpdatedAtDesc(
      dedupeIssuesById([
        ...(await fetchIssuesByAssignee(userId, teamIds)),
        ...(await fetchIssuesByCreator(userId, teamIds)),
        ...(await fetchIssuesByCommenter(userId, teamIds)),
      ]),
    );
  } else {
    issues = sortIssuesByUpdatedAtDesc(
      dedupeIssuesById([
        ...(await fetchIssuesByAssignee(userId, teamIds)),
        ...(await fetchIssuesByCreator(userId, teamIds)),
        ...(await fetchIssuesByCommenter(userId, teamIds)),
      ]),
    );
  }

  // Get labels for all issues
  const issueIds = issues.map((i) => i.id);
  const labelsMap = await getLabelsForIssues(issueIds);

  // Build team lookup
  const teamMap = new Map(teams.map((t) => [t.id, t]));

  // Group issues by workflow state name so identical states across teams
  // render as one section in workspace-wide My Issues views.
  const stateMap = new Map(states.map((s) => [s.id, s]));
  const groupedByStateName = new Map<
    string,
    {
      state: {
        id: string;
        name: string;
        category: string;
        color: string;
        position: number;
      };
      issues: Array<{
        id: string;
        number: number;
        identifier: string;
        title: string;
        priority: string;
        stateId: string;
        assigneeId: string | null;
        assignee: { name: string; image: string | null } | null;
        labels: { name: string; color: string }[];
        labelIds: string[];
        projectId: string | null;
        projectName: string | null;
        dueDate: Date | null;
        createdAt: Date;
        updatedAt: Date;
        displayAt: Date;
        teamKey: string;
      }>;
    }
  >();

  for (const issueRecord of issues) {
    const state = stateMap.get(issueRecord.stateId);
    if (!state) {
      continue;
    }

    const groupKey = `${state.category}:${state.name}`;
    const existingGroup = groupedByStateName.get(groupKey);
    const t = teamMap.get(issueRecord.teamId);
    const issueEntry = {
      id: issueRecord.id,
      number: issueRecord.number,
      identifier: issueRecord.identifier,
      title: issueRecord.title,
      priority: issueRecord.priority,
      stateId: groupKey,
      assigneeId: issueRecord.assigneeId,
      assignee: issueRecord.assigneeName
        ? { name: issueRecord.assigneeName, image: issueRecord.assigneeImage }
        : null,
      labels: labelsMap[issueRecord.id] ?? [],
      labelIds: (labelsMap[issueRecord.id] ?? []).map((l) => l.name),
      projectId: issueRecord.projectId,
      projectName: issueRecord.projectName,
      dueDate: issueRecord.dueDate,
      createdAt: issueRecord.createdAt,
      updatedAt: issueRecord.updatedAt,
      displayAt:
        tab === "activity" ? issueRecord.updatedAt : issueRecord.createdAt,
      teamKey: t?.key ?? "",
    };

    if (existingGroup) {
      existingGroup.issues.push(issueEntry);
      continue;
    }

    groupedByStateName.set(groupKey, {
      state: {
        id: groupKey,
        name: state.name,
        category: state.category,
        color: state.color,
        position: state.position,
      },
      issues: [issueEntry],
    });
  }

  const grouped = Array.from(groupedByStateName.values()).sort(
    (left, right) => left.state.position - right.state.position,
  );
  const statusOptions = Array.from(
    groupedByStateName.values(),
    ({ state }) => ({
      id: state.id,
      name: state.name,
      category: state.category,
      color: state.color,
    }),
  );

  // Build filter options
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

  return NextResponse.json({
    groups: grouped,
    totalCount: issues.length,
    filterOptions: {
      statuses: statusOptions,
      assignees: uniqueAssignees,
      labels: uniqueLabels,
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

// ─── Helpers ────────────────────────────────────────────────────────

interface IssueRecord {
  id: string;
  number: number;
  identifier: string;
  title: string;
  priority: string;
  stateId: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeImage: string | null;
  projectId: string | null;
  projectName: string | null;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sortOrder: number;
  teamId: string;
}

const emptyFilterOptions = {
  statuses: [],
  assignees: [],
  labels: [],
  priorities: [
    { value: "urgent", label: "Urgent" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
    { value: "none", label: "No priority" },
  ],
};

async function fetchIssuesByAssignee(
  userId: string,
  teamIds: string[],
): Promise<IssueRecord[]> {
  return db
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
      projectId: issue.projectId,
      projectName: project.name,
      dueDate: issue.dueDate,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      sortOrder: issue.sortOrder,
      teamId: issue.teamId,
    })
    .from(issue)
    .leftJoin(user, eq(issue.assigneeId, user.id))
    .leftJoin(project, eq(issue.projectId, project.id))
    .where(and(inArray(issue.teamId, teamIds), eq(issue.assigneeId, userId)))
    .orderBy(asc(issue.sortOrder), desc(issue.createdAt));
}

async function fetchIssuesByCreator(
  userId: string,
  teamIds: string[],
): Promise<IssueRecord[]> {
  return db
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
      projectId: issue.projectId,
      projectName: project.name,
      dueDate: issue.dueDate,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      sortOrder: issue.sortOrder,
      teamId: issue.teamId,
    })
    .from(issue)
    .leftJoin(user, eq(issue.assigneeId, user.id))
    .leftJoin(project, eq(issue.projectId, project.id))
    .where(and(inArray(issue.teamId, teamIds), eq(issue.creatorId, userId)))
    .orderBy(desc(issue.createdAt));
}

async function fetchIssuesByCommenter(
  userId: string,
  teamIds: string[],
): Promise<IssueRecord[]> {
  return db
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
      projectId: issue.projectId,
      projectName: project.name,
      dueDate: issue.dueDate,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      sortOrder: issue.sortOrder,
      teamId: issue.teamId,
    })
    .from(comment)
    .innerJoin(issue, eq(comment.issueId, issue.id))
    .leftJoin(user, eq(issue.assigneeId, user.id))
    .leftJoin(project, eq(issue.projectId, project.id))
    .where(and(eq(comment.userId, userId), inArray(issue.teamId, teamIds)))
    .orderBy(desc(issue.updatedAt));
}

function dedupeIssuesById(issues: IssueRecord[]): IssueRecord[] {
  const latestById = new Map<string, IssueRecord>();

  for (const issueRecord of issues) {
    const existing = latestById.get(issueRecord.id);
    if (!existing || existing.updatedAt < issueRecord.updatedAt) {
      latestById.set(issueRecord.id, issueRecord);
    }
  }

  return Array.from(latestById.values());
}

function sortIssuesByUpdatedAtDesc(issues: IssueRecord[]): IssueRecord[] {
  return [...issues].sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
}
