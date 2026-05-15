import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issueLabel, label, team } from "@/lib/db/schema";
import { validateWorkspaceParentLabel } from "@/lib/label-parent-validation";
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  request = new Request("http://localhost/api/labels"),
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);

  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") ?? "workspace";
  const teamId = searchParams.get("teamId");
  const includeArchived = searchParams.get("includeArchived") === "true";

  if (scope === "team" && !teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  if (teamId) {
    const [teamRecord] = await db
      .select({ id: team.id })
      .from(team)
      .where(and(eq(team.id, teamId), eq(team.workspaceId, workspaceId)))
      .limit(1);
    if (!teamRecord) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
  }

  const scopeFilter =
    scope === "all"
      ? undefined
      : scope === "team" && teamId
        ? eq(label.teamId, teamId)
        : scope === "team"
          ? isNotNull(label.teamId)
          : isNull(label.teamId);
  const archivedFilter = includeArchived ? undefined : isNull(label.archivedAt);

  const labels = await db
    .select({
      id: label.id,
      name: label.name,
      color: label.color,
      description: label.description,
      parentLabelId: label.parentLabelId,
      teamId: label.teamId,
      teamName: team.name,
      teamKey: team.key,
      archivedAt: label.archivedAt,
      createdAt: label.createdAt,
      updatedAt: label.updatedAt,
      issueCount: sql<number>`count(${issueLabel.issueId})::int`,
    })
    .from(label)
    .leftJoin(issueLabel, eq(label.id, issueLabel.labelId))
    .leftJoin(team, eq(label.teamId, team.id))
    .where(
      and(
        eq(label.workspaceId, workspaceId),
        scopeFilter,
        archivedFilter,
        or(isNull(label.teamId), eq(team.workspaceId, workspaceId)),
      ),
    )
    .groupBy(label.id, team.id)
    .orderBy(asc(team.name), asc(label.name));

  const result = labels.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    description: l.description,
    parentLabelId: l.parentLabelId,
    teamId: l.teamId,
    teamName: l.teamName,
    teamKey: l.teamKey,
    scope: l.teamId ? "team" : "workspace",
    archivedAt: l.archivedAt?.toISOString() ?? null,
    issueCount: l.issueCount,
    lastApplied: l.issueCount > 0 ? l.updatedAt?.toISOString() : null,
    createdAt: l.createdAt.toISOString(),
  }));

  return NextResponse.json({ labels: result });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);

  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }
  const body = await request.json();
  const { name, color, description, parentLabelId, teamId } = body;
  const trimmedName = typeof name === "string" ? name.trim() : "";

  if (!trimmedName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  if (teamId) {
    const [teamRecord] = await db
      .select({ id: team.id })
      .from(team)
      .where(and(eq(team.id, teamId), eq(team.workspaceId, workspaceId)))
      .limit(1);
    if (!teamRecord) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
  }

  const parentValidation = await validateWorkspaceParentLabel({
    workspaceId,
    parentLabelId,
  });
  if (!parentValidation.ok) {
    return NextResponse.json(
      { error: parentValidation.error },
      { status: parentValidation.status },
    );
  }

  const [newLabel] = await db
    .insert(label)
    .values({
      name: trimmedName,
      color: color || "#6b6f76",
      description: description || null,
      workspaceId,
      teamId: teamId || null,
      parentLabelId: parentValidation.parentLabelId,
    })
    .returning();

  return NextResponse.json({ label: newLabel }, { status: 201 });
}
