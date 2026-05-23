import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  initiative,
  initiativeProject,
  initiativeTeam,
  member,
  project,
  team,
  user,
  workspace,
} from "@/lib/db/schema";
import {
  isInitiativeHealth,
  readInitiativeSettings,
} from "@/lib/initiative-detail";
import { readWorkspaceInitiativeSettings } from "@/lib/initiative-settings";
import { readProjectSettings } from "@/lib/project-detail";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const [workspaceRecord] = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const initiativeSettings = readWorkspaceInitiativeSettings(
    workspaceRecord?.settings,
  );

  if (!initiativeSettings.enabled) {
    return NextResponse.json({
      initiatives: [],
      workspaceMembers: [],
      workspaceTeams: [],
      initiativesSettings: initiativeSettings,
    });
  }

  const [initiatives, workspaceMembers, workspaceTeams] = await Promise.all([
    db.select().from(initiative).where(eq(initiative.workspaceId, workspaceId)),
    db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.workspaceId, workspaceId)),
    db
      .select({ id: team.id, name: team.name, key: team.key, icon: team.icon })
      .from(team)
      .where(eq(team.workspaceId, workspaceId)),
  ]);

  const membersById = new Map(workspaceMembers.map((m) => [m.id, m]));

  // Get roadmap rollups per initiative
  const result = await Promise.all(
    initiatives.map(async (init) => {
      const projects = await db
        .select({
          id: project.id,
          name: project.name,
          status: project.status,
          icon: project.icon,
          settings: project.settings,
        })
        .from(initiativeProject)
        .innerJoin(project, eq(initiativeProject.projectId, project.id))
        .where(eq(initiativeProject.initiativeId, init.id));

      const completedCount = projects.filter(
        (p) => p.status === "completed",
      ).length;
      const teamRows = await db
        .select({
          id: team.id,
          name: team.name,
          key: team.key,
          icon: team.icon,
        })
        .from(initiativeTeam)
        .innerJoin(team, eq(initiativeTeam.teamId, team.id))
        .where(eq(initiativeTeam.initiativeId, init.id));
      const latestUpdate =
        readInitiativeSettings(init.settings).updates[0] ?? null;
      const activeProjects = projects.filter(
        (p) => p.status !== "completed" && p.status !== "canceled",
      );
      const activeProjectUpdateCount = activeProjects.filter((p) =>
        readProjectSettings(p.settings).activity.some(
          (entry) => entry.type === "update",
        ),
      ).length;

      return {
        id: init.id,
        name: init.name,
        description: init.description,
        status: init.status,
        ownerId: init.ownerId,
        owner: init.ownerId ? (membersById.get(init.ownerId) ?? null) : null,
        teams: teamRows,
        startDate: init.startDate,
        targetDate: init.targetDate,
        timeframe: init.timeframe,
        health: init.health,
        parentInitiativeId: init.parentInitiativeId,
        projectCount: projects.length,
        completedProjectCount: completedCount,
        latestUpdate,
        activeProjectHealthRollup: initiativeSettings.projectRollups
          ? {
              total: activeProjects.length,
              withUpdates: activeProjectUpdateCount,
              withoutUpdates: activeProjects.length - activeProjectUpdateCount,
              paused: activeProjects.filter((p) => p.status === "paused")
                .length,
            }
          : null,
        createdAt: init.createdAt,
        updatedAt: init.updatedAt,
      };
    }),
  );

  return NextResponse.json({
    initiatives: result,
    workspaceMembers,
    workspaceTeams,
    initiativesSettings: initiativeSettings,
  });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const [workspaceRecord] = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const initiativeSettings = readWorkspaceInitiativeSettings(
    workspaceRecord?.settings,
  );
  if (!initiativeSettings.enabled) {
    return NextResponse.json(
      { error: "Initiatives are disabled for this workspace" },
      { status: 403 },
    );
  }

  const body = await request.json();
  const name = `${body.name ?? ""}`.trim();
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;
  const status =
    body.status === "active" ||
    body.status === "planned" ||
    body.status === "completed"
      ? body.status
      : "planned";
  const health = isInitiativeHealth(body.health) ? body.health : "unknown";
  const targetDate =
    typeof body.targetDate === "string" && body.targetDate
      ? new Date(body.targetDate)
      : null;
  const startDate =
    typeof body.startDate === "string" && body.startDate
      ? new Date(body.startDate)
      : null;
  const timeframe =
    typeof body.timeframe === "string" && body.timeframe.trim()
      ? body.timeframe.trim().slice(0, 120)
      : null;
  const ownerId =
    typeof body.ownerId === "string" && body.ownerId.trim()
      ? body.ownerId.trim()
      : null;
  const parentInitiativeId =
    typeof body.parentInitiativeId === "string" && body.parentInitiativeId
      ? body.parentInitiativeId
      : null;
  const teamIds: string[] = Array.isArray(body.teamIds)
    ? Array.from(
        new Set(
          body.teamIds.filter(
            (teamId: unknown): teamId is string => typeof teamId === "string",
          ),
        ),
      )
    : [];

  if (!name) {
    return NextResponse.json(
      { error: "Initiative name is required" },
      { status: 400 },
    );
  }

  if (
    (targetDate && Number.isNaN(targetDate.getTime())) ||
    (startDate && Number.isNaN(startDate.getTime()))
  ) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  if (ownerId) {
    const owners = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(eq(member.workspaceId, workspaceId), eq(member.userId, ownerId)),
      )
      .limit(1);
    if (owners.length === 0) {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }
  }

  if (parentInitiativeId) {
    const parents = await db
      .select({ id: initiative.id })
      .from(initiative)
      .where(
        and(
          eq(initiative.id, parentInitiativeId),
          eq(initiative.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (parents.length === 0) {
      return NextResponse.json(
        { error: "Parent initiative not found" },
        { status: 404 },
      );
    }
  }

  if (teamIds.length > 0) {
    const teams = await db
      .select({ id: team.id })
      .from(team)
      .where(and(eq(team.workspaceId, workspaceId), inArray(team.id, teamIds)));
    if (teams.length !== teamIds.length) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
  }

  const createValues = {
    name,
    description,
    status,
    health,
    startDate,
    targetDate,
    timeframe,
    ownerId,
    parentInitiativeId,
    workspaceId,
  };

  if (teamIds.length === 0) {
    const newInitiative = await db
      .insert(initiative)
      .values(createValues)
      .returning();
    return NextResponse.json(newInitiative[0], { status: 201 });
  }

  const [newInitiative] = await db.transaction(async (tx) => {
    const created = await tx
      .insert(initiative)
      .values(createValues)
      .returning();

    if (teamIds.length > 0) {
      await tx.insert(initiativeTeam).values(
        teamIds.map((teamId) => ({
          initiativeId: created[0].id,
          teamId,
        })),
      );
    }

    return created;
  });

  return NextResponse.json(newInitiative, { status: 201 });
}
