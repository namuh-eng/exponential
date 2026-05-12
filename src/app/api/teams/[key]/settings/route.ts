import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { label, team, teamMember, workflowState } from "@/lib/db/schema";
import { findAccessibleTeam } from "@/lib/teams";
import { and, count, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

type TeamSettingsFlags = {
  emailEnabled: boolean;
  detailedHistory: boolean;
  agentGuidance: string;
  autoAssignment: boolean;
};

type EstimateTypeValue = "not_in_use" | "linear" | "exponential" | "tshirt";

function readTeamSettings(settings: unknown): TeamSettingsFlags {
  const parsed =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>)
      : {};

  return {
    emailEnabled: parsed.emailEnabled === true,
    detailedHistory: parsed.detailedHistory === true,
    agentGuidance:
      typeof parsed.agentGuidance === "string" ? parsed.agentGuidance : "",
    autoAssignment: parsed.autoAssignment === true,
  };
}

async function getTeamMembership(teamId: string, userId: string) {
  const [membership] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .limit(1);

  return membership ?? null;
}

async function buildTeamResponse(
  teamRecord: NonNullable<Awaited<ReturnType<typeof findAccessibleTeam>>>,
) {
  const [memberCountResult, labelCountResult, statusCountResult] =
    await Promise.all([
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
    ]);

  const flags = readTeamSettings(teamRecord.settings);

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
    cyclesEnabled: teamRecord.cyclesEnabled ?? false,
    cycleStartDay: teamRecord.cycleStartDay ?? 1,
    cycleDurationWeeks: teamRecord.cycleDurationWeeks ?? 2,
    memberCount: memberCountResult[0]?.value ?? 0,
    labelCount: labelCountResult[0]?.value ?? 0,
    statusCount: statusCountResult[0]?.value ?? 0,
    emailEnabled: flags.emailEnabled,
    detailedHistory: flags.detailedHistory,
    agentGuidance: flags.agentGuidance,
    autoAssignment: flags.autoAssignment,
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

  return NextResponse.json({ team: await buildTeamResponse(teamRecord) });
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
    cyclesEnabled?: boolean;
    cycleStartDay?: number;
    cycleDurationWeeks?: number;
    emailEnabled?: boolean;
    detailedHistory?: boolean;
    agentGuidance?: string;
    autoAssignment?: boolean;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const nextName = body.name?.trim();
  const nextIcon = body.icon?.trim() || teamRecord.icon || "•";
  const nextKey = body.key?.trim().toUpperCase();
  const nextEstimateType = (
    body.estimateType === "none" ? "not_in_use" : body.estimateType
  ) as EstimateTypeValue | undefined;
  const nextCyclesEnabled =
    body.cyclesEnabled ?? teamRecord.cyclesEnabled ?? false;

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

  const currentFlags = readTeamSettings(teamRecord.settings);
  const currentSettings =
    teamRecord.settings && typeof teamRecord.settings === "object"
      ? (teamRecord.settings as Record<string, unknown>)
      : {};
  const [updatedTeam] = await db
    .update(team)
    .set({
      name: nextName,
      icon: nextIcon,
      key: nextKey,
      timezone: body.timezone?.trim() || null,
      estimateType:
        nextEstimateType ??
        (teamRecord.estimateType as EstimateTypeValue | null) ??
        "not_in_use",
      cyclesEnabled: nextCyclesEnabled,
      cycleStartDay: nextCycleStartDay,
      cycleDurationWeeks: nextCycleDurationWeeks,
      settings: {
        ...currentSettings,
        emailEnabled: body.emailEnabled ?? currentFlags.emailEnabled,
        detailedHistory: body.detailedHistory ?? currentFlags.detailedHistory,
        agentGuidance: body.agentGuidance ?? currentFlags.agentGuidance,
        autoAssignment: body.autoAssignment ?? currentFlags.autoAssignment,
      },
      updatedAt: new Date(),
    })
    .where(eq(team.id, teamRecord.id))
    .returning({
      id: team.id,
      workspaceId: team.workspaceId,
      name: team.name,
      key: team.key,
      icon: team.icon,
      timezone: team.timezone,
      estimateType: team.estimateType,
      triageEnabled: team.triageEnabled,
      cyclesEnabled: team.cyclesEnabled,
      cycleStartDay: team.cycleStartDay,
      cycleDurationWeeks: team.cycleDurationWeeks,
      settings: team.settings,
    });

  if (!updatedTeam) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  return NextResponse.json({ team: await buildTeamResponse(updatedTeam) });
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
  const teamRecord = await findAccessibleTeam(key, session.user.id);

  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    action?: "leave" | "retire" | "delete";
  } | null;

  if (!body?.action) {
    return NextResponse.json({ error: "Action is required" }, { status: 400 });
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

  if (body.action === "retire") {
    const currentSettings =
      teamRecord.settings && typeof teamRecord.settings === "object"
        ? (teamRecord.settings as Record<string, unknown>)
        : {};

    const [updatedTeam] = await db
      .update(team)
      .set({
        settings: {
          ...currentSettings,
          retired: true,
          retiredAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(team.id, teamRecord.id))
      .returning({
        id: team.id,
        workspaceId: team.workspaceId,
        name: team.name,
        key: team.key,
        icon: team.icon,
        timezone: team.timezone,
        estimateType: team.estimateType,
        triageEnabled: team.triageEnabled,
        cyclesEnabled: team.cyclesEnabled,
        cycleStartDay: team.cycleStartDay,
        cycleDurationWeeks: team.cycleDurationWeeks,
        settings: team.settings,
      });

    if (!updatedTeam) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `${updatedTeam.name} is now retired.`,
      team: await buildTeamResponse(updatedTeam),
    });
  }

  await db.delete(team).where(eq(team.id, teamRecord.id));

  return NextResponse.json({
    success: true,
    redirectTo: "/settings",
    message: `${teamRecord.name} was deleted.`,
  });
}
