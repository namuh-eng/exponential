import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { project, projectLabel } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function normalizeHexColor(value: unknown) {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    return null;
  }

  return value.toLowerCase();
}

function normalizeDescription(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function removeLabelIdFromSettings(settings: unknown, labelId: string) {
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    return settings;
  }

  const record = settings as Record<string, unknown>;
  if (!Array.isArray(record.labelIds)) {
    return settings;
  }

  return {
    ...record,
    labelIds: record.labelIds.filter((value) => value !== labelId),
  };
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
  const updates: Partial<typeof projectLabel.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const duplicates = await db
      .select({ id: projectLabel.id })
      .from(projectLabel)
      .where(
        and(
          eq(projectLabel.workspaceId, workspaceId),
          eq(projectLabel.name, name),
        ),
      )
      .limit(1);

    if (duplicates.some((duplicate) => duplicate.id !== id)) {
      return NextResponse.json(
        { error: "A project label with this name already exists" },
        { status: 409 },
      );
    }

    updates.name = name;
  }

  if (body.color !== undefined) {
    const color = normalizeHexColor(body.color);
    if (!color) {
      return NextResponse.json({ error: "Invalid color" }, { status: 400 });
    }
    updates.color = color;
  }

  if (body.description !== undefined) {
    updates.description = normalizeDescription(body.description);
  }

  const [updated] = await db
    .update(projectLabel)
    .set(updates)
    .where(
      and(eq(projectLabel.id, id), eq(projectLabel.workspaceId, workspaceId)),
    )
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: "Project label not found" },
      { status: 404 },
    );
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
      .select({ id: projectLabel.id })
      .from(projectLabel)
      .where(
        and(eq(projectLabel.id, id), eq(projectLabel.workspaceId, workspaceId)),
      )
      .limit(1);

    if (!existing) {
      return null;
    }

    const projects = await tx
      .select({ id: project.id, settings: project.settings })
      .from(project)
      .where(eq(project.workspaceId, workspaceId));

    for (const row of projects) {
      const nextSettings = removeLabelIdFromSettings(row.settings, id);
      if (nextSettings !== row.settings) {
        await tx
          .update(project)
          .set({ settings: nextSettings, updatedAt: new Date() })
          .where(eq(project.id, row.id));
      }
    }

    const [deletedLabel] = await tx
      .delete(projectLabel)
      .where(
        and(eq(projectLabel.id, id), eq(projectLabel.workspaceId, workspaceId)),
      )
      .returning();

    return deletedLabel;
  });

  if (!deleted) {
    return NextResponse.json(
      { error: "Project label not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true });
}
