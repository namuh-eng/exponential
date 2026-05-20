import {
  type IssueTemplateSettings,
  normalizeIssueTemplateSettings,
} from "@/app/api/issue-templates/route";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issueTemplate } from "@/lib/db/schema";
import { findAccessibleTeam } from "@/lib/teams";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const TEMPLATE_TYPES = new Set(["issue", "document", "project"]);

type TemplateType = "issue" | "document" | "project";

function normalizeTemplateType(value: unknown): TemplateType {
  if (typeof value !== "string") return "issue";
  const templateType = value.trim().toLowerCase();
  return TEMPLATE_TYPES.has(templateType)
    ? (templateType as TemplateType)
    : "issue";
}

function serializeTemplate(template: typeof issueTemplate.$inferSelect) {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    type: normalizeTemplateType(template.templateType),
    settings: normalizeIssueTemplateSettings(template.settings),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

async function resolveTeam(request: Request, key: string, userId: string) {
  return findAccessibleTeam(key, userId, { request });
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeTemplateInput(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const type = normalizeTemplateType(body.type);
  const settings = normalizeIssueTemplateSettings(body.settings ?? {});

  if (!name) throw new Error("Template name is required");
  if (type === "issue" && !description && !settings.body) {
    throw new Error("Issue description is required");
  }

  return {
    name,
    description: description || settings.body || "",
    type,
    settings,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const teamRecord = await resolveTeam(request, key, session.user.id);
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const templates = await db
    .select()
    .from(issueTemplate)
    .where(
      and(
        eq(issueTemplate.workspaceId, teamRecord.workspaceId),
        eq(issueTemplate.teamId, teamRecord.id),
      ),
    )
    .orderBy(desc(issueTemplate.createdAt));

  return NextResponse.json({
    team: { id: teamRecord.id, name: teamRecord.name, key: teamRecord.key },
    templates: templates
      .map(serializeTemplate)
      .filter((template) => !template.settings.archivedAt),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const teamRecord = await resolveTeam(request, key, session.user.id);
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const body = await readBody(request);
  if (!body)
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  let input: {
    name: string;
    description: string;
    type: TemplateType;
    settings: IssueTemplateSettings;
  };
  try {
    input = normalizeTemplateInput(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid template" },
      { status: 400 },
    );
  }

  const [template] = await db
    .insert(issueTemplate)
    .values({
      name: input.name,
      description: input.description,
      templateType: input.type,
      workspaceId: teamRecord.workspaceId,
      teamId: teamRecord.id,
      createdById: session.user.id,
      settings: {
        ...input.settings,
        defaultTeamId: teamRecord.id,
        defaultTeamKey: teamRecord.key,
      },
    })
    .returning();

  return NextResponse.json(
    { template: serializeTemplate(template) },
    { status: 201 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const teamRecord = await resolveTeam(request, key, session.user.id);
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const body = await readBody(request);
  if (!body)
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const templateId =
    typeof body.id === "string"
      ? body.id
      : typeof body.templateId === "string"
        ? body.templateId
        : "";
  if (!templateId) {
    return NextResponse.json(
      { error: "Template id is required" },
      { status: 400 },
    );
  }

  let input: {
    name: string;
    description: string;
    type: TemplateType;
    settings: IssueTemplateSettings;
  };
  try {
    input = normalizeTemplateInput(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid template" },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(issueTemplate)
    .set({
      name: input.name,
      description: input.description,
      templateType: input.type,
      settings: {
        ...input.settings,
        defaultTeamId: teamRecord.id,
        defaultTeamKey: teamRecord.key,
      },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(issueTemplate.id, templateId),
        eq(issueTemplate.workspaceId, teamRecord.workspaceId),
        eq(issueTemplate.teamId, teamRecord.id),
      ),
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ template: serializeTemplate(updated) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const teamRecord = await resolveTeam(request, key, session.user.id);
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const body = await readBody(request);
  if (!body)
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const templateId =
    typeof body.id === "string"
      ? body.id
      : typeof body.templateId === "string"
        ? body.templateId
        : "";
  if (!templateId) {
    return NextResponse.json(
      { error: "Template id is required" },
      { status: 400 },
    );
  }

  const [deleted] = await db
    .delete(issueTemplate)
    .where(
      and(
        eq(issueTemplate.id, templateId),
        eq(issueTemplate.workspaceId, teamRecord.workspaceId),
        eq(issueTemplate.teamId, teamRecord.id),
      ),
    )
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
