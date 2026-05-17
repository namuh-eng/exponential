import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  label,
  member,
  team,
  teamMember,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import { buildTeamInboundEmailAddress } from "@/lib/team-email";
import {
  activeTeamFilter,
  getTeamRestorableUntil,
  isTeamRestorable,
} from "@/lib/team-lifecycle";
import { getMutableTeamSettings, readTeamSettings } from "@/lib/team-settings";
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
  ]);

  const flags = readTeamSettings(teamRecord.settings);
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
    canModifyAgentGuidance,
    autoAssignment: flags.autoAssignment,
    discussionSummariesEnabled: flags.discussionSummariesEnabled,
    parentTeamId: teamRecord.parentTeamId ?? null,
    parentTeam: visibleParentTeam,
    eligibleParentTeams: visibleEligibleParentTeams,
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
    agentGuidance?: string;
    autoAssignment?: boolean;
    discussionSummariesEnabled?: boolean;
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
        agentGuidance: nextAgentGuidance,
        autoAssignment: body.autoAssignment ?? currentFlags.autoAssignment,
        discussionSummariesEnabled:
          body.discussionSummariesEnabled ??
          currentFlags.discussionSummariesEnabled,
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
