import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issueLabel, label } from "@/lib/db/schema";
import { validateWorkspaceParentLabel } from "@/lib/label-parent-validation";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

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

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) {
    const trimmedName = typeof body.name === "string" ? body.name.trim() : "";
    if (!trimmedName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    updates.name = trimmedName;
  }
  if (body.color !== undefined) updates.color = body.color;
  if (body.description !== undefined) updates.description = body.description;
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
    .where(
      and(
        eq(label.id, id),
        eq(label.workspaceId, workspaceId),
        isNull(label.teamId),
      ),
    )
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
      .where(
        and(
          eq(label.id, id),
          eq(label.workspaceId, workspaceId),
          isNull(label.teamId),
        ),
      )
      .limit(1);

    if (!existing) {
      return null;
    }

    await tx.delete(issueLabel).where(eq(issueLabel.labelId, id));

    const [deletedLabel] = await tx
      .delete(label)
      .where(
        and(
          eq(label.id, id),
          eq(label.workspaceId, workspaceId),
          isNull(label.teamId),
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
