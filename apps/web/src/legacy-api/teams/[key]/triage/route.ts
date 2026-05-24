import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  cycle,
  issue,
  label,
  member,
  project,
  projectMilestone,
  projectTeam,
  teamMember,
  user,
  workflowState,
} from "@/lib/db/schema";
import {
  createHeadlessTeamsClient,
  headlessTeamsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { getLabelsForIssues } from "@/lib/issue-labels";
import { readTeamSettings } from "@/lib/team-settings";
import { findAccessibleTeam } from "@/lib/teams";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response, session } = await requireApiSession();
  if (response) {
    return response;
  }

  const { key } = await params;

  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  if (headlessTeamsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const client = createHeadlessTeamsClient(token);
    const { data, error, response } = await client.GET("/teams/{key}/triage", {
      params: { path: { key } },
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const hierarchyTeamIds = teamRecord.hierarchyTeamIds ?? [teamRecord.id];

  if (teamRecord.triageEnabled === false) {
    return NextResponse.json({
      team: teamRecord,
      issues: [],
      count: 0,
      createStateId: null,
      createStateName: null,
      triageEnabled: false,
    });
  }

  // Find triage workflow states
  const triageStates = await db
    .select({
      id: workflowState.id,
      name: workflowState.name,
      color: workflowState.color,
    })
    .from(workflowState)
    .where(
      and(
        inArray(workflowState.teamId, hierarchyTeamIds),
        eq(workflowState.category, "triage"),
      ),
    );

  if (triageStates.length === 0) {
    return NextResponse.json({
      team: teamRecord,
      issues: [],
      count: 0,
      createStateId: null,
      createStateName: null,
      triageEnabled: teamRecord.triageEnabled ?? true,
    });
  }

  const triageStateIds = triageStates.map((s) => s.id);

  // Get issues in triage state with creator info
  const issues = await db
    .select({
      id: issue.id,
      number: issue.number,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      stateId: issue.stateId,
      stateName: workflowState.name,
      stateColor: workflowState.color,
      creatorId: issue.creatorId,
      creatorName: user.name,
      creatorImage: user.image,
      assigneeId: issue.assigneeId,
      projectId: issue.projectId,
      projectName: project.name,
      projectMilestoneId: issue.projectMilestoneId,
      cycleId: issue.cycleId,
      dueDate: issue.dueDate,
      estimate: issue.estimate,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      teamId: issue.teamId,
    })
    .from(issue)
    .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
    .leftJoin(user, eq(issue.creatorId, user.id))
    .leftJoin(project, eq(issue.projectId, project.id))
    .where(
      and(
        inArray(issue.teamId, hierarchyTeamIds),
        inArray(issue.stateId, triageStateIds),
      ),
    )
    .orderBy(desc(issue.createdAt));

  const triageSettings = readTeamSettings(teamRecord.settings);

  const decisionStates = await db
    .select({
      id: workflowState.id,
      name: workflowState.name,
      category: workflowState.category,
      color: workflowState.color,
      position: workflowState.position,
      isDefault: workflowState.isDefault,
    })
    .from(workflowState)
    .where(eq(workflowState.teamId, teamRecord.id))
    .orderBy(asc(workflowState.position), asc(workflowState.name));

  const acceptDestinationStates = decisionStates
    .filter((state) =>
      ["backlog", "unstarted", "started", "completed"].includes(state.category),
    )
    .map((state) => ({
      ...state,
      isDefault:
        state.id === triageSettings.triageAcceptDestinationStateId ||
        (!triageSettings.triageAcceptDestinationStateId && state.isDefault),
    }));
  const declineDestinationStates = decisionStates
    .filter((state) => state.category === "canceled")
    .map((state) => ({
      ...state,
      isDefault:
        state.id === triageSettings.triageDeclineDestinationStateId ||
        (!triageSettings.triageDeclineDestinationStateId && state.isDefault),
    }));

  // Get labels for issues
  const issueIds = issues.map((i) => i.id);
  const labelsMap = await getLabelsForIssues(issueIds);

  const formattedIssues = issues.map((i) => ({
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    description: i.description,
    priority: i.priority,
    stateId: i.stateId,
    stateName: i.stateName,
    stateColor: i.stateColor,
    creatorId: i.creatorId,
    creatorName: i.creatorName ?? "Unknown",
    creatorImage: i.creatorImage,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    labelIds: (labelsMap[i.id] ?? []).map((currentLabel) => currentLabel.id),
    labels: labelsMap[i.id] ?? [],
    assigneeId: i.assigneeId,
    projectId: i.projectId,
    projectName: i.projectName,
    projectMilestoneId: i.projectMilestoneId,
    cycleId: i.cycleId,
    dueDate: i.dueDate,
    estimate: i.estimate,
    teamId: i.teamId,
  }));

  const [labelOptions, cycleOptions, projectOptions, memberOptions] =
    await Promise.all([
      db
        .select({ id: label.id, name: label.name, color: label.color })
        .from(label)
        .where(
          and(
            eq(label.workspaceId, teamRecord.workspaceId),
            isNull(label.archivedAt),
            or(isNull(label.teamId), eq(label.teamId, teamRecord.id)),
          ),
        )
        .orderBy(asc(label.name)),
      db
        .select({ id: cycle.id, name: cycle.name, number: cycle.number })
        .from(cycle)
        .where(eq(cycle.teamId, teamRecord.id))
        .orderBy(desc(cycle.startDate), desc(cycle.number)),
      db
        .select({ id: project.id, name: project.name })
        .from(project)
        .leftJoin(projectTeam, eq(projectTeam.projectId, project.id))
        .where(
          and(
            eq(project.workspaceId, teamRecord.workspaceId),
            or(
              isNull(projectTeam.teamId),
              eq(projectTeam.teamId, teamRecord.id),
            ),
          ),
        )
        .orderBy(asc(project.name)),
      db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(teamMember)
        .innerJoin(user, eq(teamMember.userId, user.id))
        .innerJoin(member, eq(member.userId, user.id))
        .where(
          and(
            eq(teamMember.teamId, teamRecord.id),
            eq(member.workspaceId, teamRecord.workspaceId),
          ),
        )
        .orderBy(asc(user.name), asc(user.email)),
    ]);

  const projectIds = projectOptions.map((currentProject) => currentProject.id);
  const projectMilestoneOptions =
    projectIds.length === 0
      ? []
      : await db
          .select({
            id: projectMilestone.id,
            name: projectMilestone.name,
            projectId: projectMilestone.projectId,
          })
          .from(projectMilestone)
          .where(inArray(projectMilestone.projectId, projectIds))
          .orderBy(asc(projectMilestone.sortOrder), asc(projectMilestone.name));

  return NextResponse.json({
    team: teamRecord,
    issues: formattedIssues,
    count: formattedIssues.length,
    createStateId: triageStateIds[0] ?? null,
    createStateName: triageStates[0]?.name ?? null,
    triageEnabled: teamRecord.triageEnabled ?? true,
    acceptDestinationStates,
    declineDestinationStates,
    metadataOptions: {
      labels: labelOptions,
      cycles: cycleOptions,
      projects: projectOptions,
      projectMilestones: projectMilestoneOptions,
      members: memberOptions,
    },
  });
}
