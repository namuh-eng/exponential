import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issueLabel, label, member } from "@/lib/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const memberships = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, session.user.id))
    .limit(1);

  if (memberships.length === 0) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const workspaceId = memberships[0].workspaceId;

  // Get workspace-scoped labels (teamId is null) with issue counts
  const labels = await db
    .select({
      id: label.id,
      name: label.name,
      color: label.color,
      description: label.description,
      parentLabelId: label.parentLabelId,
      createdAt: label.createdAt,
      updatedAt: label.updatedAt,
      issueCount: sql<number>`count(${issueLabel.issueId})::int`,
    })
    .from(label)
    .leftJoin(issueLabel, eq(label.id, issueLabel.labelId))
    .where(and(eq(label.workspaceId, workspaceId), isNull(label.teamId)))
    .groupBy(label.id)
    .orderBy(label.name);

  const result = labels.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    description: l.description,
    parentLabelId: l.parentLabelId,
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

  const memberships = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, session.user.id))
    .limit(1);

  if (memberships.length === 0) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const workspaceId = memberships[0].workspaceId;
  const body = await request.json();
  const { name, color, description, parentLabelId } = body;

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const [newLabel] = await db
    .insert(label)
    .values({
      name,
      color: color || "#6b6f76",
      description: description || null,
      workspaceId,
      parentLabelId: parentLabelId || null,
    })
    .returning();

  return NextResponse.json({ label: newLabel }, { status: 201 });
}
