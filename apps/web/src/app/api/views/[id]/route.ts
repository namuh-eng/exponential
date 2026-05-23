import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { customView, team, user } from "@/lib/db/schema";
import { normalizeViewFilterState } from "@/lib/views";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

async function getWorkspaceTeam(
  workspaceId: string,
  teamId: string | null | undefined,
) {
  if (!teamId) {
    return null;
  }

  const matches = await db
    .select({
      id: team.id,
      key: team.key,
      name: team.name,
      workspaceId: team.workspaceId,
    })
    .from(team)
    .where(eq(team.id, teamId))
    .limit(1);

  if (matches[0]?.workspaceId !== workspaceId) {
    return null;
  }

  return matches[0];
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

async function getScopedView(id: string, workspaceId: string) {
  const rows = await db
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
      workspaceId: customView.workspaceId,
    })
    .from(customView)
    .leftJoin(user, eq(customView.ownerId, user.id))
    .leftJoin(team, eq(customView.teamId, team.id))
    .where(eq(customView.id, id))
    .limit(1);

  const view = rows[0];
  if (!view || view.workspaceId !== workspaceId) {
    return null;
  }

  return serializeView(view);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const { id } = await params;
  const view = await getScopedView(id, workspaceId);
  if (!view) {
    return NextResponse.json({ error: "View not found" }, { status: 404 });
  }

  return NextResponse.json({ view });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const { id } = await params;
  const existing = await getScopedView(id, workspaceId);
  if (!existing) {
    return NextResponse.json({ error: "View not found" }, { status: 404 });
  }

  const body = await request.json();
  const selectedTeam =
    body.teamId === undefined
      ? await getWorkspaceTeam(workspaceId, existing.teamId)
      : await getWorkspaceTeam(workspaceId, body.teamId);
  const filterState = normalizeViewFilterState(
    body.filterState ?? existing.filterState,
    selectedTeam?.id ?? existing.teamId,
  );

  if (
    filterState.entityType === "issues" &&
    !(selectedTeam?.id ?? existing.teamId)
  ) {
    return NextResponse.json(
      { error: "Issue views must be scoped to a team" },
      { status: 400 },
    );
  }

  await db
    .update(customView)
    .set({
      name:
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : existing.name,
      layout:
        filterState.entityType === "projects"
          ? "list"
          : body.layout === "board" || body.layout === "timeline"
            ? body.layout
            : existing.layout === "board" || existing.layout === "timeline"
              ? existing.layout
              : "list",
      isPersonal:
        typeof body.isPersonal === "boolean"
          ? body.isPersonal
          : existing.isPersonal,
      filterState: {
        ...filterState,
        scope: selectedTeam ? "team" : "workspace",
      },
      teamId: selectedTeam?.id ?? null,
      updatedAt: new Date(),
    })
    .where(eq(customView.id, id));

  const updated = await getScopedView(id, workspaceId);
  if (!updated) {
    return NextResponse.json({ error: "View not found" }, { status: 404 });
  }

  return NextResponse.json({ view: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const { id } = await params;
  const existing = await getScopedView(id, workspaceId);
  if (!existing) {
    return NextResponse.json({ error: "View not found" }, { status: 404 });
  }

  await db.delete(customView).where(eq(customView.id, id));
  return NextResponse.json({ success: true });
}
