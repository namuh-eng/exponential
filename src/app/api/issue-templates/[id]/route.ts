import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issueTemplate } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { normalizeIssueTemplateSettings } from "../route";

function serialize(template: typeof issueTemplate.$inferSelect) {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    settings: normalizeIssueTemplateSettings(template.settings),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  const { id } = await params;
  let body: {
    name?: unknown;
    description?: unknown;
    settings?: unknown;
    archived?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const updates: Partial<typeof issueTemplate.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name)
      return NextResponse.json(
        { error: "Template name is required" },
        { status: 400 },
      );
    updates.name = name;
  }
  if (body.description !== undefined) {
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    if (!description)
      return NextResponse.json(
        { error: "Issue description is required" },
        { status: 400 },
      );
    updates.description = description;
  }
  if (body.settings !== undefined || body.archived !== undefined) {
    try {
      const settings = normalizeIssueTemplateSettings(body.settings ?? {});
      if (body.archived === true)
        settings.archivedAt = new Date().toISOString();
      updates.settings = settings;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid settings" },
        { status: 400 },
      );
    }
  }
  const [updated] = await db
    .update(issueTemplate)
    .set(updates)
    .where(
      and(
        eq(issueTemplate.id, id),
        eq(issueTemplate.workspaceId, workspaceId),
        isNull(issueTemplate.teamId),
      ),
    )
    .returning();
  if (!updated)
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ template: serialize(updated) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  const { id } = await params;
  const [deleted] = await db
    .delete(issueTemplate)
    .where(
      and(
        eq(issueTemplate.id, id),
        eq(issueTemplate.workspaceId, workspaceId),
        isNull(issueTemplate.teamId),
      ),
    )
    .returning();
  if (!deleted)
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
