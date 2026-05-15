import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issueLabel, label, team } from "@/lib/db/schema";
import { validateWorkspaceParentLabel } from "@/lib/label-parent-validation";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function validateTeamScope(workspaceId: string, teamId: unknown) {
  if (teamId === null || teamId === undefined || teamId === "") return null;
  if (typeof teamId !== "string") return undefined;
  const [teamRecord] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.workspaceId, workspaceId)))
    .limit(1);
  return teamRecord?.id;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);

  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const { id } = await params;
  const body = await request.json();

  const updates: Partial<typeof label.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) {
    const trimmedName = typeof body.name === "string" ? body.name.trim() : "";
    if (!trimmedName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    updates.name = trimmedName;
  }
  if (body.color !== undefined) updates.color = body.color;
  if (body.description !== undefined) updates.description = body.description;
  if (body.archived !== undefined) {
    updates.archivedAt = body.archived ? new Date() : null;
  }
  if (body.convertToGroup === true) {
    updates.parentLabelId = null;
    updates.color = "#6b6f76";
  }
  if (body.teamId !== undefined) {
    const nextTeamId = await validateTeamScope(workspaceId, body.teamId);
    if (nextTeamId === undefined) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    updates.teamId = nextTeamId;
  }
  if (body.parentLabelId !== undefined) {
    const parentValidation = await validateWorkspaceParentLabel({
      workspaceId,
      parentLabelId: body.parentLabelId,
      currentLabelId: id,
    });
    if (!parentValidation.ok) {
      return NextResponse.json(
        { error: parentValidation.error },
        { status: parentValidation.status },
      );
    }
    updates.parentLabelId = parentValidation.parentLabelId;
  }

  const [updated] = await db
    .update(label)
    .set(updates)
    .where(and(eq(label.id, id), eq(label.workspaceId, workspaceId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  return NextResponse.json({ label: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);

  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const { id } = await params;

  const deleted = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: label.id })
      .from(label)
      .where(and(eq(label.id, id), eq(label.workspaceId, workspaceId)))
      .limit(1);

    if (!existing) {
      return null;
    }

    await tx.delete(issueLabel).where(eq(issueLabel.labelId, id));

    const [deletedLabel] = await tx
      .delete(label)
      .where(and(eq(label.id, id), eq(label.workspaceId, workspaceId)))
      .returning();

    return deletedLabel;
  });

  if (!deleted) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
