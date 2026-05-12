import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  issue,
  issueLabel,
  label,
  member,
  project,
  projectMember,
  projectMilestone,
  projectTeam,
  team,
  user,
  workflowState,
} from "@/lib/db/schema";
import {
  type ProjectActivityEntry,
  type ProjectResource,
  buildMilestoneData,
  haveSameIds,
  readProjectSettings,
} from "@/lib/project-detail";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

const PROJECT_STATUSES = new Set([
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
]);

const PROJECT_PRIORITIES = new Set(["none", "urgent", "high", "medium", "low"]);

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === "string"),
    ),
  ];
}

function normalizeDateInput(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date;
}

function makeActivityEntry(
  entry: Omit<ProjectActivityEntry, "id" | "createdAt">,
): ProjectActivityEntry {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry,
  };
}

async function findWorkspaceId(userId: string) {
  const memberships = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(desc(member.createdAt))
    .limit(1);

  return memberships[0]?.workspaceId ?? null;
}

async function findProjectInWorkspace(workspaceId: string, slug: string) {
  const projects = await db
    .select()
    .from(project)
    .where(and(eq(project.workspaceId, workspaceId), eq(project.slug, slug)))
    .limit(1);

  return projects[0] ?? null;
}

async function buildProjectResponse(userId: string, slug: string) {
  const workspaceId = await findWorkspaceId(userId);
  if (!workspaceId) {
    return { status: 404 as const, body: { error: "Not found" } };
  }

  const proj = await findProjectInWorkspace(workspaceId, slug);
  if (!proj) {
    return { status: 404 as const, body: { error: "Project not found" } };
  }

  const settings = readProjectSettings(proj.settings);

  const [
    leadData,
    milestones,
    teamLinks,
    memberLinks,
    workspaceMembers,
    workspaceTeams,
    workspaceLabels,
    projectIssues,
  ] = await Promise.all([
    proj.leadId
      ? db
          .select({ id: user.id, name: user.name, image: user.image })
          .from(user)
          .where(eq(user.id, proj.leadId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ id: projectMilestone.id, name: projectMilestone.name })
      .from(projectMilestone)
      .where(eq(projectMilestone.projectId, proj.id))
      .orderBy(asc(projectMilestone.sortOrder)),
    db
      .select({ id: team.id, name: team.name, key: team.key })
      .from(projectTeam)
      .innerJoin(team, eq(projectTeam.teamId, team.id))
      .where(eq(projectTeam.projectId, proj.id)),
    db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(projectMember)
      .innerJoin(user, eq(projectMember.userId, user.id))
      .where(eq(projectMember.projectId, proj.id)),
    db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.workspaceId, workspaceId))
      .orderBy(asc(user.name)),
    db
      .select({ id: team.id, name: team.name, key: team.key })
      .from(team)
      .where(eq(team.workspaceId, workspaceId))
      .orderBy(asc(team.name)),
    db
      .select({ id: label.id, name: label.name, color: label.color })
      .from(label)
      .where(eq(label.workspaceId, workspaceId))
      .orderBy(asc(label.name)),
    db
      .select({
        id: issue.id,
        number: issue.number,
        identifier: issue.identifier,
        title: issue.title,
        priority: issue.priority,
        stateId: issue.stateId,
        stateName: workflowState.name,
        stateCategory: workflowState.category,
        stateColor: workflowState.color,
        statePosition: workflowState.position,
        assigneeId: issue.assigneeId,
        assigneeName: user.name,
        assigneeImage: user.image,
        completedAt: issue.completedAt,
        createdAt: issue.createdAt,
        teamKey: team.key,
        projectMilestoneId: issue.projectMilestoneId,
      })
      .from(issue)
      .leftJoin(user, eq(issue.assigneeId, user.id))
      .leftJoin(workflowState, eq(issue.stateId, workflowState.id))
      .leftJoin(team, eq(issue.teamId, team.id))
      .where(eq(issue.projectId, proj.id))
      .orderBy(asc(workflowState.position), desc(issue.createdAt)),
  ]);

  const projectIssueIds = projectIssues.map((projectIssue) => projectIssue.id);
  const projectIssueLabels =
    projectIssueIds.length > 0
      ? await db
          .select({
            issueId: issueLabel.issueId,
            id: label.id,
            name: label.name,
            color: label.color,
          })
          .from(issueLabel)
          .innerJoin(label, eq(issueLabel.labelId, label.id))
          .where(inArray(issueLabel.issueId, projectIssueIds))
      : [];

  const labelsByIssue = new Map<
    string,
    { id: string; name: string; color: string }[]
  >();
  for (const projectIssueLabel of projectIssueLabels) {
    const issueLabels = labelsByIssue.get(projectIssueLabel.issueId) ?? [];
    issueLabels.push({
      id: projectIssueLabel.id,
      name: projectIssueLabel.name,
      color: projectIssueLabel.color,
    });
    labelsByIssue.set(projectIssueLabel.issueId, issueLabels);
  }

  const issueGroups = new Map<
    string,
    {
      state: { id: string; name: string; category: string; color: string };
      position: number;
      issues: {
        id: string;
        identifier: string;
        title: string;
        priority: string;
        assignee: { name: string; image: string | null } | null;
        createdAt: Date;
        href: string | null;
        labels: { id: string; name: string; color: string }[];
      }[];
    }
  >();

  for (const projectIssue of projectIssues) {
    if (!projectIssue.stateId || !projectIssue.stateName) continue;

    if (!issueGroups.has(projectIssue.stateId)) {
      issueGroups.set(projectIssue.stateId, {
        state: {
          id: projectIssue.stateId,
          name: projectIssue.stateName,
          category: projectIssue.stateCategory ?? "backlog",
          color: projectIssue.stateColor ?? "#6b6f76",
        },
        position: projectIssue.statePosition ?? 0,
        issues: [],
      });
    }

    issueGroups.get(projectIssue.stateId)?.issues.push({
      id: projectIssue.id,
      identifier: projectIssue.identifier,
      title: projectIssue.title,
      priority: projectIssue.priority,
      assignee: projectIssue.assigneeName
        ? {
            name: projectIssue.assigneeName,
            image: projectIssue.assigneeImage,
          }
        : null,
      createdAt: projectIssue.createdAt,
      href: projectIssue.teamKey
        ? `/team/${projectIssue.teamKey}/issue/${projectIssue.id}`
        : null,
      labels: labelsByIssue.get(projectIssue.id) ?? [],
    });
  }

  const assigneeBreakdown = new Map<string, number>();
  const labelBreakdown = new Map<
    string,
    { name: string; color: string; count: number }
  >();

  for (const projectIssue of projectIssues) {
    const assigneeKey = projectIssue.assigneeName ?? "Unassigned";
    assigneeBreakdown.set(
      assigneeKey,
      (assigneeBreakdown.get(assigneeKey) ?? 0) + 1,
    );

    for (const issueLabel of labelsByIssue.get(projectIssue.id) ?? []) {
      const current = labelBreakdown.get(issueLabel.id) ?? {
        name: issueLabel.name,
        color: issueLabel.color,
        count: 0,
      };
      current.count += 1;
      labelBreakdown.set(issueLabel.id, current);
    }
  }

  const totalIssues = projectIssues.length;
  const completedIssues = projectIssues.filter(
    (projectIssue) => projectIssue.completedAt !== null,
  ).length;
  const selectedLabelIds = new Set(settings.labelIds);

  return {
    status: 200 as const,
    body: {
      project: {
        id: proj.id,
        name: proj.name,
        description: proj.description,
        icon: proj.icon,
        slug: proj.slug,
        status: proj.status,
        priority: proj.priority,
        startDate: proj.startDate,
        targetDate: proj.targetDate,
        createdAt: proj.createdAt,
      },
      lead: leadData[0] ?? null,
      members: memberLinks,
      teams: teamLinks,
      labels: workspaceLabels.filter((workspaceLabel) =>
        selectedLabelIds.has(workspaceLabel.id),
      ),
      availableMembers: workspaceMembers,
      availableTeams: workspaceTeams,
      availableLabels: workspaceLabels,
      slackChannel: settings.slackChannel,
      resources: settings.resources
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      activity: settings.activity
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      milestones: buildMilestoneData(milestones, projectIssues),
      issueGroups: Array.from(issueGroups.values())
        .sort((left, right) => left.position - right.position)
        .map((group) => ({ state: group.state, issues: group.issues })),
      progress: {
        total: totalIssues,
        completed: completedIssues,
        percentage:
          totalIssues > 0
            ? Math.round((completedIssues / totalIssues) * 100)
            : 0,
        assignees: Array.from(assigneeBreakdown.entries()).map(
          ([name, count]) => ({
            name,
            count,
          }),
        ),
        labels: Array.from(labelBreakdown.entries()).map(([id, value]) => ({
          id,
          name: value.name,
          color: value.color,
          count: value.count,
        })),
      },
    },
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { slug } = await params;
  const result = await buildProjectResponse(session.user.id, slug);
  return NextResponse.json(result.body, { status: result.status });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { slug } = await params;
  const workspaceId = await findWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const proj = await findProjectInWorkspace(workspaceId, slug);
  if (!proj) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json();
  const currentSettings = readProjectSettings(proj.settings);
  const nextSettings = {
    ...currentSettings,
    resources: [...currentSettings.resources],
    activity: [...currentSettings.activity],
  };
  const nextProjectValues: Partial<typeof project.$inferInsert> = {};
  const activityEntries: ProjectActivityEntry[] = [];

  const [
    workspaceMembers,
    workspaceTeams,
    workspaceLabels,
    currentProjectMembers,
    currentProjectTeams,
  ] = await Promise.all([
    db
      .select({ id: user.id })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.workspaceId, workspaceId)),
    db
      .select({ id: team.id })
      .from(team)
      .where(eq(team.workspaceId, workspaceId)),
    db
      .select({ id: label.id })
      .from(label)
      .where(eq(label.workspaceId, workspaceId)),
    db
      .select({ userId: projectMember.userId })
      .from(projectMember)
      .where(eq(projectMember.projectId, proj.id)),
    db
      .select({ teamId: projectTeam.teamId })
      .from(projectTeam)
      .where(eq(projectTeam.projectId, proj.id)),
  ]);

  const validMemberIds = new Set(
    workspaceMembers.map((workspaceMember) => workspaceMember.id),
  );
  const validTeamIds = new Set(
    workspaceTeams.map((workspaceTeam) => workspaceTeam.id),
  );
  const validLabelIds = new Set(
    workspaceLabels.map((workspaceLabel) => workspaceLabel.id),
  );
  const currentProjectMemberIds = currentProjectMembers.map(
    (projectMemberRow) => projectMemberRow.userId,
  );
  const currentProjectTeamIds = currentProjectTeams.map(
    (projectTeamRow) => projectTeamRow.teamId,
  );

  let replaceMemberIds: string[] | null = null;
  let replaceTeamIds: string[] | null = null;
  let propertiesTouched = false;

  if (typeof body.status === "string" && PROJECT_STATUSES.has(body.status)) {
    if (body.status !== proj.status) {
      nextProjectValues.status = body.status as typeof proj.status;
      propertiesTouched = true;
    }
  }

  if (
    typeof body.priority === "string" &&
    PROJECT_PRIORITIES.has(body.priority)
  ) {
    if (body.priority !== proj.priority) {
      nextProjectValues.priority = body.priority as typeof proj.priority;
      propertiesTouched = true;
    }
  }

  if ("description" in body) {
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
    if (description !== proj.description) {
      nextProjectValues.description = description;
      propertiesTouched = true;
    }
  }

  if ("leadId" in body) {
    const leadId =
      typeof body.leadId === "string" && validMemberIds.has(body.leadId)
        ? body.leadId
        : null;
    if (leadId !== proj.leadId) {
      nextProjectValues.leadId = leadId;
      propertiesTouched = true;
    }
  }

  if ("startDate" in body) {
    const startDate = normalizeDateInput(body.startDate);
    if (startDate === undefined) {
      return NextResponse.json(
        { error: "Invalid start date" },
        { status: 400 },
      );
    }
    if (
      (startDate?.toISOString() ?? null) !==
      (proj.startDate?.toISOString() ?? null)
    ) {
      nextProjectValues.startDate = startDate;
      propertiesTouched = true;
    }
  }

  if ("targetDate" in body) {
    const targetDate = normalizeDateInput(body.targetDate);
    if (targetDate === undefined) {
      return NextResponse.json(
        { error: "Invalid target date" },
        { status: 400 },
      );
    }
    if (
      (targetDate?.toISOString() ?? null) !==
      (proj.targetDate?.toISOString() ?? null)
    ) {
      nextProjectValues.targetDate = targetDate;
      propertiesTouched = true;
    }
  }

  if ("slackChannel" in body) {
    const slackChannel =
      typeof body.slackChannel === "string" && body.slackChannel.trim()
        ? body.slackChannel.trim()
        : null;
    if (slackChannel !== currentSettings.slackChannel) {
      nextSettings.slackChannel = slackChannel;
      propertiesTouched = true;
    }
  }

  if ("memberIds" in body) {
    const memberIds = uniqueStrings(body.memberIds).filter((memberId) =>
      validMemberIds.has(memberId),
    );
    if (!haveSameIds(memberIds, currentProjectMemberIds)) {
      replaceMemberIds = memberIds;
      propertiesTouched = true;
    }
  }

  if ("teamIds" in body) {
    const teamIds = uniqueStrings(body.teamIds).filter((teamId) =>
      validTeamIds.has(teamId),
    );
    if (!haveSameIds(teamIds, currentProjectTeamIds)) {
      replaceTeamIds = teamIds;
      propertiesTouched = true;
    }
  }

  if ("labelIds" in body) {
    const labelIds = uniqueStrings(body.labelIds).filter((labelId) =>
      validLabelIds.has(labelId),
    );
    if (!haveSameIds(labelIds, currentSettings.labelIds)) {
      nextSettings.labelIds = labelIds;
      propertiesTouched = true;
    }
  }

  if (body.resource) {
    const resourceInput = body.resource as Record<string, unknown>;
    const title =
      typeof resourceInput.title === "string" ? resourceInput.title.trim() : "";
    const type = resourceInput.type === "document" ? "document" : "link";
    const url =
      typeof resourceInput.url === "string" && resourceInput.url.trim()
        ? resourceInput.url.trim()
        : null;

    if (!title) {
      return NextResponse.json(
        { error: "Resource title is required" },
        { status: 400 },
      );
    }

    if (type === "link" && !url) {
      return NextResponse.json(
        { error: "Link resources require a URL" },
        { status: 400 },
      );
    }

    const resource: ProjectResource = {
      id: crypto.randomUUID(),
      title,
      type,
      url,
      createdAt: new Date().toISOString(),
    };

    nextSettings.resources.unshift(resource);
    activityEntries.push(
      makeActivityEntry({
        type: "resource",
        title: `Added ${type === "document" ? "document" : "link"} "${title}"`,
        body: url,
        actorName: session.user.name,
        actorImage: session.user.image ?? null,
      }),
    );
  }

  if ("projectUpdate" in body) {
    const projectUpdate =
      typeof body.projectUpdate === "string" ? body.projectUpdate.trim() : "";
    if (!projectUpdate) {
      return NextResponse.json(
        { error: "Project update is required" },
        { status: 400 },
      );
    }

    activityEntries.push(
      makeActivityEntry({
        type: "update",
        title: "Project update",
        body: projectUpdate,
        actorName: session.user.name,
        actorImage: session.user.image ?? null,
      }),
    );
  }

  if (propertiesTouched) {
    activityEntries.push(
      makeActivityEntry({
        type: "properties",
        title: "Updated project properties",
        body: null,
        actorName: session.user.name,
        actorImage: session.user.image ?? null,
      }),
    );
  }

  const shouldUpdateProject =
    Object.keys(nextProjectValues).length > 0 ||
    replaceMemberIds !== null ||
    replaceTeamIds !== null ||
    activityEntries.length > 0 ||
    nextSettings.slackChannel !== currentSettings.slackChannel ||
    nextSettings.labelIds.join(",") !== currentSettings.labelIds.join(",") ||
    nextSettings.resources.length !== currentSettings.resources.length;

  if (!shouldUpdateProject) {
    const unchanged = await buildProjectResponse(session.user.id, slug);
    return NextResponse.json(unchanged.body, { status: unchanged.status });
  }

  nextSettings.activity = [...activityEntries, ...nextSettings.activity].slice(
    0,
    50,
  );

  await db.transaction(async (tx) => {
    if (replaceMemberIds !== null) {
      await tx
        .delete(projectMember)
        .where(eq(projectMember.projectId, proj.id));
      if (replaceMemberIds.length > 0) {
        await tx.insert(projectMember).values(
          replaceMemberIds.map((memberId) => ({
            projectId: proj.id,
            userId: memberId,
          })),
        );
      }
    }

    if (replaceTeamIds !== null) {
      await tx.delete(projectTeam).where(eq(projectTeam.projectId, proj.id));
      if (replaceTeamIds.length > 0) {
        await tx.insert(projectTeam).values(
          replaceTeamIds.map((teamId) => ({
            projectId: proj.id,
            teamId,
          })),
        );
      }
    }

    await tx
      .update(project)
      .set({
        ...nextProjectValues,
        settings: nextSettings,
        updatedAt: new Date(),
      })
      .where(eq(project.id, proj.id));
  });

  const updated = await buildProjectResponse(session.user.id, slug);
  return NextResponse.json(updated.body, { status: updated.status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { slug } = await params;
  const workspaceId = await findWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const proj = await findProjectInWorkspace(workspaceId, slug);
  if (!proj) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  await db.transaction(async (tx) => {
    // Delete project members, teams, milestones, and issues
    // Or let cascade handle it. In our schema we usually use cascades.
    // For safety, let's just delete the project record.
    await tx.delete(project).where(eq(project.id, proj.id));
  });

  return NextResponse.json({ success: true });
}
