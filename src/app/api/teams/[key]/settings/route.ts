import { readAccountPreferencesFromUserSettings } from "@/lib/account-preferences";
import {
  buildEffectiveAgentGuidance,
  readWorkspaceAgentGuidance,
} from "@/lib/agent-guidance";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  label,
  member,
  team,
  teamMember,
  user,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import { buildTeamInboundEmailAddress } from "@/lib/team-email";
import {
  activeTeamFilter,
  getTeamRestorableUntil,
  isTeamRestorable,
} from "@/lib/team-lifecycle";
import {
  type StatusTransitionRule,
  type TeamWorkflowAutomationSettings,
  getMutableTeamSettings,
  readTeamSettings,
} from "@/lib/team-settings";
import { findAccessibleTeam } from "@/lib/teams";
import {
  canPerformWorkspacePermission,
  isWorkspaceAdminRole,
  readWorkspacePermissionSettings,
} from "@/lib/workspace-permissions";
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

type EstimateTypeValue = "not_in_use" | "linear" | "exponential" | "tshirt";

async function getTeamMembership(teamId: string, userId: string) {
  const [membership] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .limit(1);

  return membership ?? null;
}

async function getWorkspaceRole(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.workspaceId, workspaceId), eq(member.userId, userId)))
    .limit(1);

  return row?.role;
}

type TeamSettingsRecord = Omit<
  NonNullable<Awaited<ReturnType<typeof findAccessibleTeam>>>,
  "childTeamIds" | "hierarchyTeamIds"
> & {
  childTeamIds?: string[];
  hierarchyTeamIds?: string[];
  updatedAt?: Date | null;
};

async function buildTeamResponse(
  teamRecord: TeamSettingsRecord,
  userId: string,
) {
  const [
    memberCountResult,
    labelCountResult,
    statusCountResult,
    workflowStateRows,
    workspaceRow,
    workspaceMemberRow,
    parentTeamRow,
    eligibleParentRows,
    childTeamRows,
    userRow,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(teamMember)
      .where(eq(teamMember.teamId, teamRecord.id)),
    db
      .select({ value: count() })
      .from(label)
      .where(eq(label.teamId, teamRecord.id)),
    db
      .select({ value: count() })
      .from(workflowState)
      .where(eq(workflowState.teamId, teamRecord.id)),
    db
      .select({
        id: workflowState.id,
        name: workflowState.name,
        category: workflowState.category,
        color: workflowState.color,
        position: workflowState.position,
      })
      .from(workflowState)
      .where(eq(workflowState.teamId, teamRecord.id))
      .orderBy(asc(workflowState.position), asc(workflowState.name)),
    db
      .select({ urlSlug: workspace.urlSlug, settings: workspace.settings })
      .from(workspace)
      .where(eq(workspace.id, teamRecord.workspaceId))
      .limit(1),
    db
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.workspaceId, teamRecord.workspaceId),
          eq(member.userId, userId),
        ),
      )
      .limit(1),
    teamRecord.parentTeamId
      ? db
          .select({
            id: team.id,
            name: team.name,
            key: team.key,
            isPrivate: team.isPrivate,
          })
          .from(team)
          .where(eq(team.id, teamRecord.parentTeamId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({
        id: team.id,
        name: team.name,
        key: team.key,
        isPrivate: team.isPrivate,
      })
      .from(team)
      .where(
        and(
          eq(team.workspaceId, teamRecord.workspaceId),
          ne(team.id, teamRecord.id),
          activeTeamFilter,
        ),
      ),
    db
      .select({
        id: team.id,
        name: team.name,
        key: team.key,
        isPrivate: team.isPrivate,
      })
      .from(team)
      .where(and(eq(team.parentTeamId, teamRecord.id), activeTeamFilter))
      .orderBy(asc(team.name)),
    db
      .select({ settings: user.settings })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1),
  ]);

  const flags = readTeamSettings(teamRecord.settings);
  const workspaceAgentGuidance = readWorkspaceAgentGuidance(
    workspaceRow[0]?.settings,
  );
  const accountAgentGuidance = readAccountPreferencesFromUserSettings(
    userRow[0]?.settings,
  ).agentPersonalization.instructions;
  const effectiveGuidance = buildEffectiveAgentGuidance({
    workspaceGuidance: workspaceAgentGuidance,
    accountGuidance: accountAgentGuidance,
    teamGuidance: flags.agentGuidance,
    teamKey: teamRecord.key,
  });
  const acceptDestinationStates = workflowStateRows.filter((state) =>
    ["backlog", "unstarted", "started", "completed"].includes(state.category),
  );
  const declineDestinationStates = workflowStateRows.filter(
    (state) => state.category === "canceled",
  );
  const workspaceSlug = workspaceRow[0]?.urlSlug ?? "workspace";
  const eligibleTeamIds = eligibleParentRows.map((row) => row.id);
  const eligibleMembershipRows =
    eligibleTeamIds.length === 0
      ? []
      : await db
          .select({ teamId: teamMember.teamId })
          .from(teamMember)
          .where(
            and(
              inArray(teamMember.teamId, eligibleTeamIds),
              eq(teamMember.userId, userId),
            ),
          );
  const eligibleMembershipIds = new Set(
    eligibleMembershipRows.map((row) => row.teamId),
  );
  const viewerRole = workspaceMemberRow[0]?.role;
  const viewerIsAdmin = isWorkspaceAdminRole(viewerRole);
  const permissions = readWorkspacePermissionSettings(
    workspaceRow[0]?.settings,
  );
  const canModifyAgentGuidance = canPerformWorkspacePermission(
    viewerRole,
    permissions.agentGuidanceRole,
  );
  const canSeeTeamSummary = (entry: {
    id: string;
    isPrivate: boolean | null;
  }) =>
    !entry.isPrivate || viewerIsAdmin || eligibleMembershipIds.has(entry.id);
  const visibleParentTeam =
    parentTeamRow[0] && canSeeTeamSummary(parentTeamRow[0])
      ? {
          id: parentTeamRow[0].id,
          name: parentTeamRow[0].name,
          key: parentTeamRow[0].key,
        }
      : null;
  const visibleEligibleParentTeams = eligibleParentRows
    .filter(canSeeTeamSummary)
    .map(({ id, name, key }) => ({ id, name, key }));
  const visibleChildTeams = childTeamRows
    .filter(canSeeTeamSummary)
    .map(({ id, name, key }) => ({ id, name, key }));

  return {
    id: teamRecord.id,
    name: teamRecord.name,
    key: teamRecord.key,
    icon: teamRecord.icon ?? "•",
    timezone: teamRecord.timezone ?? "",
    estimateType:
      teamRecord.estimateType === "not_in_use"
        ? "none"
        : (teamRecord.estimateType ?? "none"),
    triageEnabled: teamRecord.triageEnabled ?? true,
    triageAcceptDestinationStateId: flags.triageAcceptDestinationStateId,
    triageDeclineDestinationStateId: flags.triageDeclineDestinationStateId,
    acceptDestinationStates,
    declineDestinationStates,
    workflowStates: workflowStateRows,
    workflowAutomation: flags.workflowAutomation,
    cyclesEnabled: teamRecord.cyclesEnabled ?? false,
    cycleStartDay: teamRecord.cycleStartDay ?? 1,
    cycleDurationWeeks: teamRecord.cycleDurationWeeks ?? 2,
    memberCount: memberCountResult[0]?.value ?? 0,
    labelCount: labelCountResult[0]?.value ?? 0,
    statusCount: statusCountResult[0]?.value ?? 0,
    emailEnabled: flags.emailEnabled,
    inboundEmailAddress: buildTeamInboundEmailAddress(
      teamRecord.key,
      workspaceSlug,
    ),
    detailedHistory: flags.detailedHistory,
    agentGuidance: flags.agentGuidance,
    workspaceAgentGuidance,
    accountAgentGuidance,
    guidanceEntries: effectiveGuidance.entries,
    effectiveAgentPromptPreview:
      effectiveGuidance.effectiveInstructions ||
      "No guidance configured yet. Agents will use the default workspace prompt.",
    agentGuidanceLastSavedAt: teamRecord.updatedAt?.toISOString() ?? null,
    agentGuidancePermissionLabel: canModifyAgentGuidance
      ? "You can edit team agent guidance for this workspace."
      : "Workspace policy restricts team agent guidance edits.",
    canModifyAgentGuidance,
    autoAssignment: flags.autoAssignment,
    autoAssignMode: flags.autoAssignMode,
    defaultAssigneeId: flags.defaultAssigneeId,
    gitBranchFormat: flags.gitBranchFormat,
    gitPrAutomationEnabled: flags.gitPrAutomationEnabled,
    gitPrMergeTargetStatusId: flags.gitPrMergeTargetStatusId,
    gitBranchCreateTargetStatusId: flags.gitBranchCreateTargetStatusId,
    statusTransitionRules: flags.statusTransitionRules,
    discussionSummariesEnabled: flags.discussionSummariesEnabled,
    discussionSummaryMinComments: flags.discussionSummaryMinComments,
    discussionSummaryRefreshMode: flags.discussionSummaryRefreshMode,
    parentTeamId: teamRecord.parentTeamId ?? null,
    parentTeam: visibleParentTeam,
    eligibleParentTeams: visibleEligibleParentTeams,
    childTeams: visibleChildTeams,
    hierarchyTeamIds: teamRecord.hierarchyTeamIds ?? [
      teamRecord.id,
      ...visibleChildTeams.map((child) => child.id),
    ],
    hierarchyImpact: {
      rollupTeamCount: teamRecord.hierarchyTeamIds?.length ?? 1,
      filters: ["Issues", "Cycles", "Triage", "Analytics"],
      teamScopePath: `/${workspaceSlug}/teams/${teamRecord.key}`,
    },
    retiredAt: teamRecord.retiredAt?.toISOString() ?? null,
    deletedAt: teamRecord.deletedAt?.toISOString() ?? null,
    deleteScheduledAt: teamRecord.deleteScheduledAt?.toISOString() ?? null,
    restorableUntil: teamRecord.restorableUntil?.toISOString() ?? null,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id);

  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  return NextResponse.json({
    team: await buildTeamResponse(teamRecord, session.user.id),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id);

  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    icon?: string;
    key?: string;
    timezone?: string;
    estimateType?: string;
    triageEnabled?: boolean;
    triageAcceptDestinationStateId?: string | null;
    triageDeclineDestinationStateId?: string | null;
    cyclesEnabled?: boolean;
    cycleStartDay?: number;
    cycleDurationWeeks?: number;
    emailEnabled?: boolean;
    detailedHistory?: boolean;
    gitBranchFormat?: string;
    gitPrAutomationEnabled?: boolean;
    gitPrMergeTargetStatusId?: string | null;
    gitBranchCreateTargetStatusId?: string | null;
    autoAssignEnabled?: boolean;
    autoAssignMode?: "creator" | "team_lead" | "round_robin" | "none";
    defaultAssigneeId?: string | null;
    statusTransitionRules?: StatusTransitionRule[];
    agentGuidance?: string;
    autoAssignment?: boolean;
    discussionSummariesEnabled?: boolean;
    discussionSummaryMinComments?: number;
    discussionSummaryRefreshMode?: "manual" | "automatic";
    workflowAutomation?: Partial<TeamWorkflowAutomationSettings>;
    parentTeamId?: string | null;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nextName = body.name === undefined ? teamRecord.name : body.name.trim();
  const nextIcon = body.icon?.trim() || teamRecord.icon || "•";
  const nextKey =
    body.key === undefined ? teamRecord.key : body.key.trim().toUpperCase();
  const nextTimezone =
    body.timezone === undefined
      ? (teamRecord.timezone ?? null)
      : body.timezone.trim() || null;
  const nextEstimateType = (
    body.estimateType === "none" ? "not_in_use" : body.estimateType
  ) as EstimateTypeValue | undefined;
  const nextCyclesEnabled =
    body.cyclesEnabled ?? teamRecord.cyclesEnabled ?? false;
  const nextTriageEnabled =
    body.triageEnabled ?? teamRecord.triageEnabled ?? true;

  if (!nextName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  if (!nextKey || !/^[A-Z0-9]{2,10}$/.test(nextKey)) {
    return NextResponse.json(
      { error: "Key must be 2-10 uppercase letters or numbers" },
      { status: 400 },
    );
  }

  if (
    nextEstimateType &&
    !["not_in_use", "linear", "exponential", "tshirt"].includes(
      nextEstimateType,
    )
  ) {
    return NextResponse.json(
      { error: "Estimate type is invalid" },
      { status: 400 },
    );
  }

  const nextCycleStartDay = nextCyclesEnabled
    ? Number(body.cycleStartDay ?? teamRecord.cycleStartDay ?? 1)
    : null;
  const nextCycleDurationWeeks = nextCyclesEnabled
    ? Number(body.cycleDurationWeeks ?? teamRecord.cycleDurationWeeks ?? 2)
    : null;

  if (
    nextCyclesEnabled &&
    (nextCycleStartDay === null ||
      !Number.isInteger(nextCycleStartDay) ||
      nextCycleStartDay < 1 ||
      nextCycleStartDay > 7)
  ) {
    return NextResponse.json(
      { error: "Cycle start day must be between 1 and 7" },
      { status: 400 },
    );
  }

  if (
    nextCyclesEnabled &&
    (nextCycleDurationWeeks === null ||
      !Number.isInteger(nextCycleDurationWeeks) ||
      nextCycleDurationWeeks < 1 ||
      nextCycleDurationWeeks > 8)
  ) {
    return NextResponse.json(
      { error: "Cycle duration must be between 1 and 8 weeks" },
      { status: 400 },
    );
  }

  const normalizeDestinationStateId = (value: string | null | undefined) =>
    typeof value === "string" ? value.trim() || null : (value ?? null);

  const requestedTriageDestinationIds = [
    normalizeDestinationStateId(body.triageAcceptDestinationStateId),
    normalizeDestinationStateId(body.triageDeclineDestinationStateId),
  ].filter((value): value is string => Boolean(value));

  let requestedTriageDestinationRows: {
    id: string;
    category: string;
    teamId: string;
  }[] = [];
  if (requestedTriageDestinationIds.length > 0) {
    requestedTriageDestinationRows = await db
      .select({
        id: workflowState.id,
        category: workflowState.category,
        teamId: workflowState.teamId,
      })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.teamId, teamRecord.id),
          inArray(workflowState.id, requestedTriageDestinationIds),
        ),
      );
  }
  const requestedTriageDestinationById = new Map(
    requestedTriageDestinationRows.map((state) => [state.id, state]),
  );
  const isAcceptDestinationCategory = (category: string) =>
    ["backlog", "unstarted", "started", "completed"].includes(category);

  if (body.triageAcceptDestinationStateId !== undefined) {
    const destinationId = normalizeDestinationStateId(
      body.triageAcceptDestinationStateId,
    );
    if (
      destinationId &&
      !isAcceptDestinationCategory(
        requestedTriageDestinationById.get(destinationId)?.category ?? "",
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Accept destination status must belong to this team's workflow",
        },
        { status: 400 },
      );
    }
  }

  if (body.triageDeclineDestinationStateId !== undefined) {
    const destinationId = normalizeDestinationStateId(
      body.triageDeclineDestinationStateId,
    );
    if (
      destinationId &&
      requestedTriageDestinationById.get(destinationId)?.category !== "canceled"
    ) {
      return NextResponse.json(
        {
          error:
            "Decline destination status must be a canceled status for this team",
        },
        { status: 400 },
      );
    }
  }

  if (nextKey !== teamRecord.key) {
    const [duplicateTeam] = await db
      .select({ id: team.id })
      .from(team)
      .where(
        and(
          eq(team.workspaceId, teamRecord.workspaceId),
          eq(team.key, nextKey),
          ne(team.id, teamRecord.id),
        ),
      )
      .limit(1);

    if (duplicateTeam) {
      return NextResponse.json(
        { error: "Another team already uses that key" },
        { status: 409 },
      );
    }
  }

  let nextParentTeamId = teamRecord.parentTeamId ?? null;
  if (body.parentTeamId !== undefined) {
    nextParentTeamId = body.parentTeamId?.trim() || null;

    if (nextParentTeamId === teamRecord.id) {
      return NextResponse.json(
        { error: "A team cannot be its own parent" },
        { status: 400 },
      );
    }

    if (nextParentTeamId) {
      const [parentCandidate] = await db
        .select({ id: team.id, parentTeamId: team.parentTeamId })
        .from(team)
        .where(
          and(
            eq(team.id, nextParentTeamId),
            eq(team.workspaceId, teamRecord.workspaceId),
          ),
        )
        .limit(1);

      if (!parentCandidate) {
        return NextResponse.json(
          { error: "Parent team must be in the same workspace" },
          { status: 400 },
        );
      }

      const visited = new Set<string>([teamRecord.id]);
      let cursor: string | null = parentCandidate.parentTeamId ?? null;
      while (cursor) {
        if (visited.has(cursor)) {
          return NextResponse.json(
            { error: "Parent team would create a cycle" },
            { status: 400 },
          );
        }
        visited.add(cursor);

        const [ancestor] = await db
          .select({ id: team.id, parentTeamId: team.parentTeamId })
          .from(team)
          .where(
            and(
              eq(team.id, cursor),
              eq(team.workspaceId, teamRecord.workspaceId),
            ),
          )
          .limit(1);
        cursor = ancestor?.parentTeamId ?? null;
      }
    }
  }

  const currentFlags = readTeamSettings(teamRecord.settings);
  const currentSettings = getMutableTeamSettings(teamRecord.settings);
  const workflowStateRows = await db
    .select({
      id: workflowState.id,
      name: workflowState.name,
      category: workflowState.category,
      color: workflowState.color,
      position: workflowState.position,
    })
    .from(workflowState)
    .where(eq(workflowState.teamId, teamRecord.id))
    .orderBy(asc(workflowState.position), asc(workflowState.name));

  const normalizeOptionalStateId = (value: string | null | undefined) =>
    typeof value === "string" ? value.trim() || null : (value ?? null);
  const nextGitBranchFormat =
    body.gitBranchFormat === undefined
      ? currentFlags.gitBranchFormat
      : body.gitBranchFormat.trim();
  if (
    body.gitBranchFormat !== undefined &&
    (!nextGitBranchFormat || !nextGitBranchFormat.includes("{number}"))
  ) {
    return NextResponse.json(
      { error: "Branch format must include {number}" },
      { status: 400 },
    );
  }
  const nextAutoAssignMode = body.autoAssignMode ?? currentFlags.autoAssignMode;
  if (
    !["creator", "team_lead", "round_robin", "none"].includes(
      nextAutoAssignMode,
    )
  ) {
    return NextResponse.json(
      { error: "Auto-assignment mode is invalid" },
      { status: 400 },
    );
  }
  const nextStatusTransitionRules =
    body.statusTransitionRules === undefined
      ? currentFlags.statusTransitionRules
      : body.statusTransitionRules;
  const transitionStateIds = [
    normalizeOptionalStateId(body.gitPrMergeTargetStatusId),
    normalizeOptionalStateId(body.gitBranchCreateTargetStatusId),
    ...nextStatusTransitionRules.map((rule) => rule.targetStatusId),
  ].filter((value): value is string => Boolean(value));
  const uniqueTransitionStateIds = [...new Set(transitionStateIds)];
  const transitionStateRows = uniqueTransitionStateIds.length
    ? await db
        .select({ id: workflowState.id, category: workflowState.category })
        .from(workflowState)
        .where(
          and(
            eq(workflowState.teamId, teamRecord.id),
            inArray(workflowState.id, uniqueTransitionStateIds),
          ),
        )
    : [];
  const transitionStatesById = new Map(
    transitionStateRows.map((state) => [state.id, state]),
  );
  if (uniqueTransitionStateIds.some((id) => !transitionStatesById.has(id))) {
    return NextResponse.json(
      { error: "Target status must belong to this team's workflow" },
      { status: 400 },
    );
  }
  const validRuleTriggers = new Set([
    "branch_created",
    "pr_opened",
    "pr_merged",
    "issue_assigned",
    "issue_unassigned",
  ]);
  const validRuleSources = new Set([
    "any",
    "backlog",
    "unstarted",
    "started",
    "completed",
  ]);
  for (const rule of nextStatusTransitionRules) {
    if (
      !rule.id?.trim() ||
      !rule.name?.trim() ||
      !validRuleTriggers.has(rule.trigger) ||
      !validRuleSources.has(rule.sourceCategory) ||
      !rule.targetStatusId
    ) {
      return NextResponse.json(
        {
          error:
            "Status transition rules must include a name, trigger, and target status",
        },
        { status: 400 },
      );
    }
    const target = transitionStatesById.get(rule.targetStatusId);
    if (
      target &&
      rule.sourceCategory !== "any" &&
      target.category === rule.sourceCategory
    ) {
      return NextResponse.json(
        { error: "Target status must differ from the source category" },
        { status: 400 },
      );
    }
  }
  const nextTriageAcceptDestinationStateId =
    body.triageAcceptDestinationStateId === undefined
      ? currentFlags.triageAcceptDestinationStateId
      : normalizeDestinationStateId(body.triageAcceptDestinationStateId);
  const nextTriageDeclineDestinationStateId =
    body.triageDeclineDestinationStateId === undefined
      ? currentFlags.triageDeclineDestinationStateId
      : normalizeDestinationStateId(body.triageDeclineDestinationStateId);
  const nextAgentGuidance =
    body.agentGuidance === undefined
      ? currentFlags.agentGuidance
      : body.agentGuidance;
  const nextDiscussionSummaryMinComments =
    body.discussionSummaryMinComments === undefined
      ? currentFlags.discussionSummaryMinComments
      : Number(body.discussionSummaryMinComments);
  if (
    !Number.isInteger(nextDiscussionSummaryMinComments) ||
    nextDiscussionSummaryMinComments < 3 ||
    nextDiscussionSummaryMinComments > 50
  ) {
    return NextResponse.json(
      { error: "Discussion summary trigger must be between 3 and 50 comments" },
      { status: 400 },
    );
  }
  const nextDiscussionSummaryRefreshMode =
    body.discussionSummaryRefreshMode === undefined
      ? currentFlags.discussionSummaryRefreshMode
      : body.discussionSummaryRefreshMode;
  if (!["manual", "automatic"].includes(nextDiscussionSummaryRefreshMode)) {
    return NextResponse.json(
      { error: "Discussion summary refresh mode is invalid" },
      { status: 400 },
    );
  }

  const workflowStateIds = new Set(workflowStateRows.map((state) => state.id));
  const normalizeStatusId = (value: string | null | undefined) =>
    typeof value === "string" ? value.trim() || null : (value ?? null);
  const currentWorkflowAutomation = currentFlags.workflowAutomation;
  const workflowAutomationPatch = body.workflowAutomation ?? {};
  const nextWorkflowAutomation: TeamWorkflowAutomationSettings = {
    ...currentWorkflowAutomation,
    ...workflowAutomationPatch,
    gitBranchFormat:
      typeof workflowAutomationPatch.gitBranchFormat === "string"
        ? workflowAutomationPatch.gitBranchFormat.trim()
        : currentWorkflowAutomation.gitBranchFormat,
    gitBranchCreateTargetStatusId:
      workflowAutomationPatch.gitBranchCreateTargetStatusId === undefined
        ? currentWorkflowAutomation.gitBranchCreateTargetStatusId
        : normalizeStatusId(
            workflowAutomationPatch.gitBranchCreateTargetStatusId,
          ),
    gitPrMergeTargetStatusId:
      workflowAutomationPatch.gitPrMergeTargetStatusId === undefined
        ? currentWorkflowAutomation.gitPrMergeTargetStatusId
        : normalizeStatusId(workflowAutomationPatch.gitPrMergeTargetStatusId),
    defaultAssigneeId:
      workflowAutomationPatch.defaultAssigneeId === undefined
        ? currentWorkflowAutomation.defaultAssigneeId
        : normalizeStatusId(workflowAutomationPatch.defaultAssigneeId),
    statusTransitionRules:
      workflowAutomationPatch.statusTransitionRules ??
      currentWorkflowAutomation.statusTransitionRules,
  };

  if (!nextWorkflowAutomation.gitBranchFormat) {
    return NextResponse.json(
      { error: "Git branch format is required" },
      { status: 400 },
    );
  }
  if (
    nextWorkflowAutomation.autoAssignMode &&
    !["creator", "team_lead", "round_robin", "none"].includes(
      nextWorkflowAutomation.autoAssignMode,
    )
  ) {
    return NextResponse.json(
      { error: "Auto-assignment mode is invalid" },
      { status: 400 },
    );
  }

  for (const [field, value] of [
    [
      "Branch creation target status",
      nextWorkflowAutomation.gitBranchCreateTargetStatusId,
    ],
    [
      "Pull request merge target status",
      nextWorkflowAutomation.gitPrMergeTargetStatusId,
    ],
  ] as const) {
    if (value && !workflowStateIds.has(value)) {
      return NextResponse.json(
        { error: `${field} must belong to this team's workflow` },
        { status: 400 },
      );
    }
  }

  if (!Array.isArray(nextWorkflowAutomation.statusTransitionRules)) {
    return NextResponse.json(
      { error: "Status transition rules must be an array" },
      { status: 400 },
    );
  }

  nextWorkflowAutomation.statusTransitionRules =
    nextWorkflowAutomation.statusTransitionRules.map((rule, index) => ({
      id: rule.id?.trim() || `rule-${index + 1}`,
      name: rule.name?.trim() || `Transition rule ${index + 1}`,
      trigger: rule.trigger,
      sourceStatusId: normalizeStatusId(rule.sourceStatusId),
      targetStatusId: normalizeStatusId(rule.targetStatusId) ?? "",
      enabled: rule.enabled !== false,
    }));

  for (const rule of nextWorkflowAutomation.statusTransitionRules) {
    if (
      ![
        "issue_created",
        "branch_created",
        "pull_request_merged",
        "issue_assigned",
      ].includes(rule.trigger)
    ) {
      return NextResponse.json(
        { error: "Status transition trigger is invalid" },
        { status: 400 },
      );
    }
    if (rule.sourceStatusId && !workflowStateIds.has(rule.sourceStatusId)) {
      return NextResponse.json(
        { error: "Source status must belong to this team's workflow" },
        { status: 400 },
      );
    }
    if (!rule.targetStatusId || !workflowStateIds.has(rule.targetStatusId)) {
      return NextResponse.json(
        {
          error:
            "Transition rules require a target status from this team's workflow",
        },
        { status: 400 },
      );
    }
  }

  if (
    body.agentGuidance !== undefined &&
    nextAgentGuidance !== currentFlags.agentGuidance
  ) {
    const [workspaceAccess] = await db
      .select({ role: member.role, settings: workspace.settings })
      .from(workspace)
      .innerJoin(
        member,
        and(
          eq(member.workspaceId, workspace.id),
          eq(member.userId, session.user.id),
        ),
      )
      .where(eq(workspace.id, teamRecord.workspaceId))
      .limit(1);
    const permissions = readWorkspacePermissionSettings(
      workspaceAccess?.settings,
    );

    if (
      !canPerformWorkspacePermission(
        workspaceAccess?.role,
        permissions.agentGuidanceRole,
      )
    ) {
      return NextResponse.json(
        { error: "You do not have permission to modify agent guidance" },
        { status: 403 },
      );
    }
  }
  const [updatedTeam] = await db
    .update(team)
    .set({
      name: nextName,
      icon: nextIcon,
      key: nextKey,
      timezone: nextTimezone,
      estimateType:
        nextEstimateType ??
        (teamRecord.estimateType as EstimateTypeValue | null) ??
        "not_in_use",
      triageEnabled: nextTriageEnabled,
      cyclesEnabled: nextCyclesEnabled,
      cycleStartDay: nextCycleStartDay,
      cycleDurationWeeks: nextCycleDurationWeeks,
      settings: {
        ...currentSettings,
        emailEnabled: body.emailEnabled ?? currentFlags.emailEnabled,
        detailedHistory: body.detailedHistory ?? currentFlags.detailedHistory,
        gitBranchFormat: nextGitBranchFormat,
        gitPrAutomationEnabled:
          body.gitPrAutomationEnabled ?? currentFlags.gitPrAutomationEnabled,
        gitPrMergeTargetStatusId:
          body.gitPrMergeTargetStatusId === undefined
            ? currentFlags.gitPrMergeTargetStatusId
            : normalizeOptionalStateId(body.gitPrMergeTargetStatusId),
        gitBranchCreateTargetStatusId:
          body.gitBranchCreateTargetStatusId === undefined
            ? currentFlags.gitBranchCreateTargetStatusId
            : normalizeOptionalStateId(body.gitBranchCreateTargetStatusId),
        autoAssignment:
          body.autoAssignEnabled ??
          body.autoAssignment ??
          currentFlags.autoAssignment,
        autoAssignMode: nextAutoAssignMode,
        defaultAssigneeId:
          body.defaultAssigneeId === undefined
            ? currentFlags.defaultAssigneeId
            : body.defaultAssigneeId?.trim() || null,
        statusTransitionRules: nextStatusTransitionRules.map((rule) => ({
          id: rule.id.trim(),
          name: rule.name.trim(),
          trigger: rule.trigger,
          sourceCategory: rule.sourceCategory,
          targetStatusId: rule.targetStatusId,
          enabled: rule.enabled !== false,
        })),
        agentGuidance: nextAgentGuidance,
        workflowAutomation: nextWorkflowAutomation,
        discussionSummariesEnabled:
          body.discussionSummariesEnabled ??
          currentFlags.discussionSummariesEnabled,
        discussionSummaryMinComments: nextDiscussionSummaryMinComments,
        discussionSummaryRefreshMode: nextDiscussionSummaryRefreshMode,
        triageAcceptDestinationStateId: nextTriageAcceptDestinationStateId,
        triageDeclineDestinationStateId: nextTriageDeclineDestinationStateId,
      },
      parentTeamId: nextParentTeamId,
      updatedAt: new Date(),
    })
    .where(eq(team.id, teamRecord.id))
    .returning({
      id: team.id,
      workspaceId: team.workspaceId,
      name: team.name,
      key: team.key,
      isPrivate: team.isPrivate,
      icon: team.icon,
      timezone: team.timezone,
      estimateType: team.estimateType,
      triageEnabled: team.triageEnabled,
      cyclesEnabled: team.cyclesEnabled,
      cycleStartDay: team.cycleStartDay,
      cycleDurationWeeks: team.cycleDurationWeeks,
      parentTeamId: team.parentTeamId,
      settings: team.settings,
      retiredAt: team.retiredAt,
      deletedAt: team.deletedAt,
      deleteScheduledAt: team.deleteScheduledAt,
      restorableUntil: team.restorableUntil,
      restoredAt: team.restoredAt,
    });

  if (!updatedTeam) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  return NextResponse.json({
    team: await buildTeamResponse(updatedTeam, session.user.id),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { key } = await params;
  const body = (await request.json().catch(() => null)) as {
    action?: "leave" | "retire" | "delete" | "restore";
  } | null;

  if (!body?.action) {
    return NextResponse.json({ error: "Action is required" }, { status: 400 });
  }
  if (!["leave", "retire", "delete", "restore"].includes(body.action)) {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    includeDeleted: body.action === "restore",
  });

  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  if (body.action === "leave") {
    const membership = await getTeamMembership(teamRecord.id, session.user.id);
    if (!membership) {
      return NextResponse.json(
        { error: "You are not a member of this team" },
        { status: 400 },
      );
    }

    await db.delete(teamMember).where(eq(teamMember.id, membership.id));

    return NextResponse.json({
      success: true,
      redirectTo: "/settings",
      message: `Left ${teamRecord.name}.`,
    });
  }

  const viewerRole = await getWorkspaceRole(
    teamRecord.workspaceId,
    session.user.id,
  );
  if (!isWorkspaceAdminRole(viewerRole)) {
    return NextResponse.json(
      { error: "Only workspace admins can change team lifecycle state" },
      { status: 403 },
    );
  }

  if (body.action === "retire") {
    const currentSettings = getMutableTeamSettings(teamRecord.settings);
    const retiredAt = new Date();

    const [updatedTeam] = await db
      .update(team)
      .set({
        settings: {
          ...currentSettings,
          retired: true,
          retiredAt: retiredAt.toISOString(),
        },
        retiredAt,
        updatedAt: retiredAt,
      })
      .where(eq(team.id, teamRecord.id))
      .returning({
        id: team.id,
        workspaceId: team.workspaceId,
        name: team.name,
        key: team.key,
        isPrivate: team.isPrivate,
        icon: team.icon,
        timezone: team.timezone,
        estimateType: team.estimateType,
        triageEnabled: team.triageEnabled,
        cyclesEnabled: team.cyclesEnabled,
        cycleStartDay: team.cycleStartDay,
        cycleDurationWeeks: team.cycleDurationWeeks,
        parentTeamId: team.parentTeamId,
        settings: team.settings,
        retiredAt: team.retiredAt,
        deletedAt: team.deletedAt,
        deleteScheduledAt: team.deleteScheduledAt,
        restorableUntil: team.restorableUntil,
        restoredAt: team.restoredAt,
      });

    if (!updatedTeam) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `${updatedTeam.name} is now retired.`,
      team: await buildTeamResponse(updatedTeam, session.user.id),
    });
  }

  if (body.action === "restore") {
    if (!isTeamRestorable(teamRecord)) {
      return NextResponse.json(
        { error: "Team restoration window has expired" },
        { status: 410 },
      );
    }

    const restoredAt = new Date();
    const currentSettings = getMutableTeamSettings(teamRecord.settings);
    const [updatedTeam] = await db
      .update(team)
      .set({
        settings: {
          ...currentSettings,
          deleted: false,
          deletedAt: null,
          deleteScheduledAt: null,
          restorableUntil: null,
          restoredAt: restoredAt.toISOString(),
        },
        deletedAt: null,
        deleteScheduledAt: null,
        restorableUntil: null,
        restoredAt,
        updatedAt: restoredAt,
      })
      .where(eq(team.id, teamRecord.id))
      .returning({
        id: team.id,
        workspaceId: team.workspaceId,
        name: team.name,
        key: team.key,
        isPrivate: team.isPrivate,
        icon: team.icon,
        timezone: team.timezone,
        estimateType: team.estimateType,
        triageEnabled: team.triageEnabled,
        cyclesEnabled: team.cyclesEnabled,
        cycleStartDay: team.cycleStartDay,
        cycleDurationWeeks: team.cycleDurationWeeks,
        parentTeamId: team.parentTeamId,
        settings: team.settings,
        retiredAt: team.retiredAt,
        deletedAt: team.deletedAt,
        deleteScheduledAt: team.deleteScheduledAt,
        restorableUntil: team.restorableUntil,
        restoredAt: team.restoredAt,
      });

    if (!updatedTeam) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `${updatedTeam.name} was restored.`,
      team: await buildTeamResponse(updatedTeam, session.user.id),
    });
  }

  const deletedAt = new Date();
  const restorableUntil = getTeamRestorableUntil(deletedAt);
  const currentSettings = getMutableTeamSettings(teamRecord.settings);
  await db
    .update(team)
    .set({
      settings: {
        ...currentSettings,
        deleted: true,
        deletedAt: deletedAt.toISOString(),
        deleteScheduledAt: deletedAt.toISOString(),
        restorableUntil: restorableUntil.toISOString(),
      },
      deletedAt,
      deleteScheduledAt: deletedAt,
      restorableUntil,
      restoredAt: null,
      updatedAt: deletedAt,
    })
    .where(eq(team.id, teamRecord.id));

  return NextResponse.json({
    success: true,
    redirectTo: "/settings",
    message: `${teamRecord.name} was scheduled for deletion and can be restored for 30 days.`,
  });
}
