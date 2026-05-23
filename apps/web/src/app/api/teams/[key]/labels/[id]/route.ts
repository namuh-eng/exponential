import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issueLabel, label } from "@/lib/db/schema";
import { validateScopedParentLabel } from "@/lib/label-parent-validation";
import { findAccessibleTeam } from "@/lib/teams";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string; id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key, id } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const [existing] = await db
    .select({ id: label.id })
    .from(label)
    .where(
      and(
        eq(label.id, id),
        eq(label.workspaceId, teamRecord.workspaceId),
        eq(label.teamId, teamRecord.id),
      ),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

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
  if (body.description !== undefined)
    updates.description = body.description || null;
  if (body.parentLabelId !== undefined) {
    const parentValidation = await validateScopedParentLabel({
      workspaceId: teamRecord.workspaceId,
      teamId: teamRecord.id,
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
    .where(
      and(
        eq(label.id, id),
        eq(label.workspaceId, teamRecord.workspaceId),
        eq(label.teamId, teamRecord.id),
      ),
    )
    .returning();

  return NextResponse.json({ label: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string; id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key, id } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const deleted = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: label.id })
      .from(label)
      .where(
        and(
          eq(label.id, id),
          eq(label.workspaceId, teamRecord.workspaceId),
          eq(label.teamId, teamRecord.id),
        ),
      )
      .limit(1);
    if (!existing) return null;

    await tx.delete(issueLabel).where(eq(issueLabel.labelId, id));
    const [deletedLabel] = await tx
      .delete(label)
      .where(
        and(
          eq(label.id, id),
          eq(label.workspaceId, teamRecord.workspaceId),
          eq(label.teamId, teamRecord.id),
        ),
      )
      .returning();
    return deletedLabel;
  });

  if (!deleted) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
