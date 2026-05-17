import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { projectTemplate } from "@/lib/db/schema";
import {
  normalizeProjectTemplateSettings,
  readProjectTemplateSettings,
} from "@/lib/project-template-settings";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function serializeTemplate(template: typeof projectTemplate.$inferSelect) {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    settings: readProjectTemplateSettings(template.settings),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

async function requireTemplateAccess(id: string, userId: string) {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) return { workspaceId: null, template: null };
  const rows = await db
    .select()
    .from(projectTemplate)
    .where(
      and(
        eq(projectTemplate.id, id),
        eq(projectTemplate.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return { workspaceId, template: rows[0] ?? null };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const { id } = await context.params;
  const { workspaceId, template } = await requireTemplateAccess(
    id,
    session.user.id,
  );
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  if (!template)
    return NextResponse.json({ error: "Template not found" }, { status: 404 });

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
  const name =
    body.name === undefined ? template.name : `${body.name ?? ""}`.trim();
  if (!name)
    return NextResponse.json(
      { error: "Template name is required" },
      { status: 400 },
    );

  const nextSettings =
    body.settings === undefined
      ? readProjectTemplateSettings(template.settings)
      : normalizeProjectTemplateSettings(body.settings);
  if (body.archived !== undefined)
    nextSettings.archived = body.archived === true;

  const [updated] = await db
    .update(projectTemplate)
    .set({
      name,
      description:
        body.description === undefined
          ? template.description
          : typeof body.description === "string" && body.description.trim()
            ? body.description.trim()
            : null,
      settings: nextSettings,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projectTemplate.id, id),
        eq(projectTemplate.workspaceId, workspaceId),
      ),
    )
    .returning();
  return NextResponse.json({ template: serializeTemplate(updated) });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const { id } = await context.params;
  const { workspaceId, template } = await requireTemplateAccess(
    id,
    session.user.id,
  );
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  if (!template)
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  await db
    .delete(projectTemplate)
    .where(
      and(
        eq(projectTemplate.id, id),
        eq(projectTemplate.workspaceId, workspaceId),
      ),
    );
  return NextResponse.json({ ok: true });
}
