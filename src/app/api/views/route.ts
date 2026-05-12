import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { customView, team, user } from "@/lib/db/schema";
import { normalizeViewFilterState } from "@/lib/views";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function getWorkspaceTeam(
  workspaceId: string,
  teamId: string | null | undefined,
) {
  if (!teamId) {
    return null;
  }

  const matches = await db
    .select({ id: team.id, key: team.key, name: team.name })
    .from(team)
    .where(eq(team.id, teamId))
    .limit(1);

  if (matches.length === 0) {
    return null;
  }

  const teamRecord = matches[0];
  if (teamRecord && workspaceId) {
    const workspaceTeams = await db
      .select({ id: team.id })
      .from(team)
      .where(eq(team.workspaceId, workspaceId));

    if (!workspaceTeams.some((row) => row.id === teamRecord.id)) {
      return null;
    }
  }

  return teamRecord;
}

function serializeView(row: {
  id: string;
  name: string;
  layout: "list" | "board" | "timeline";
  isPersonal: boolean | null;
  filterState: unknown;
  teamId: string | null;
  teamKey: string | null;
  teamName: string | null;
  ownerName: string | null;
  ownerImage: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const filterState = normalizeViewFilterState(row.filterState, row.teamId);

  return {
    id: row.id,
    name: row.name,
    layout: row.layout,
    isPersonal: row.isPersonal ?? true,
    filterState,
    entityType: filterState.entityType,
    scope: filterState.scope,
    teamId: row.teamId,
    teamKey: row.teamKey,
    teamName: row.teamName,
    owner: row.ownerName
      ? { name: row.ownerName, image: row.ownerImage }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ views: [], teams: [] });
  }

  const views = await db
    .select({
      id: customView.id,
      name: customView.name,
      layout: customView.layout,
      isPersonal: customView.isPersonal,
      filterState: customView.filterState,
      teamId: customView.teamId,
      teamKey: team.key,
      teamName: team.name,
      ownerName: user.name,
      ownerImage: user.image,
      createdAt: customView.createdAt,
      updatedAt: customView.updatedAt,
    })
    .from(customView)
    .leftJoin(user, eq(customView.ownerId, user.id))
    .leftJoin(team, eq(customView.teamId, team.id))
    .where(eq(customView.workspaceId, workspaceId))
    .orderBy(asc(customView.name), asc(customView.createdAt));

  const teams = await db
    .select({ id: team.id, key: team.key, name: team.name })
    .from(team)
    .where(eq(team.workspaceId, workspaceId))
    .orderBy(asc(team.name));

  return NextResponse.json({
    views: views.map(serializeView),
    teams,
  });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const body = await request.json();

  const {
    name,
    layout,
    isPersonal,
    filterState: rawFilterState,
    teamId,
  } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const selectedTeam = await getWorkspaceTeam(workspaceId, teamId);
  const filterState = normalizeViewFilterState(
    rawFilterState,
    selectedTeam?.id,
  );

  if (filterState.entityType === "issues" && !selectedTeam) {
    return NextResponse.json(
      { error: "Issue views must be scoped to a team" },
      { status: 400 },
    );
  }

  const nextLayout =
    filterState.entityType === "projects"
      ? "list"
      : layout === "board"
        ? "board"
        : "list";

  const [newView] = await db
    .insert(customView)
    .values({
      name: name.trim(),
      ownerId: session.user.id,
      workspaceId,
      layout: nextLayout,
      isPersonal: isPersonal ?? true,
      filterState: {
        ...filterState,
        scope: selectedTeam ? "team" : "workspace",
      },
      teamId: selectedTeam?.id ?? null,
    })
    .returning();

  const viewRows = await db
    .select({
      id: customView.id,
      name: customView.name,
      layout: customView.layout,
      isPersonal: customView.isPersonal,
      filterState: customView.filterState,
      teamId: customView.teamId,
      teamKey: team.key,
      teamName: team.name,
      ownerName: user.name,
      ownerImage: user.image,
      createdAt: customView.createdAt,
      updatedAt: customView.updatedAt,
    })
    .from(customView)
    .leftJoin(user, eq(customView.ownerId, user.id))
    .leftJoin(team, eq(customView.teamId, team.id))
    .where(eq(customView.id, newView.id))
    .limit(1);

  return NextResponse.json(
    { view: serializeView(viewRows[0]) },
    { status: 201 },
  );
}
