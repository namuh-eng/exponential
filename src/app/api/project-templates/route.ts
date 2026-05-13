import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { projectTemplate } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type ProjectTemplatePayload = {
  id: string;
  name: string;
  description: string | null;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function serializeTemplate(template: ProjectTemplatePayload) {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    settings: template.settings ?? {},
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ templates: [] });
  }

  const templates = await db
    .select({
      id: projectTemplate.id,
      name: projectTemplate.name,
      description: projectTemplate.description,
      settings: projectTemplate.settings,
      createdAt: projectTemplate.createdAt,
      updatedAt: projectTemplate.updatedAt,
    })
    .from(projectTemplate)
    .where(eq(projectTemplate.workspaceId, workspaceId))
    .orderBy(desc(projectTemplate.createdAt));

  return NextResponse.json({ templates: templates.map(serializeTemplate) });
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

  let body: { name?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = `${body.name ?? ""}`.trim();
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  if (!name) {
    return NextResponse.json(
      { error: "Template name is required" },
      { status: 400 },
    );
  }

  const [template] = await db
    .insert(projectTemplate)
    .values({
      name,
      description,
      workspaceId,
      createdById: session.user.id,
      settings: {},
    })
    .returning();

  return NextResponse.json(
    { template: serializeTemplate(template) },
    { status: 201 },
  );
}
