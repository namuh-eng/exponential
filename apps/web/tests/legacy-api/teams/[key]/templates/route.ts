import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issueTemplate } from "@/lib/db/schema";
import {
  createHeadlessTeamsClient,
  headlessTeamsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { findAccessibleTeam } from "@/lib/teams";
import { and, desc, eq } from "drizzle-orm";
import {
  type IssueTemplateSettings,
  normalizeIssueTemplateSettings,
} from "legacy-api/issue-templates/route";
import { NextResponse } from "next/server";

type TemplatePayload = typeof issueTemplate.$inferSelect;

function serialize(template: TemplatePayload) {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    settings: normalizeIssueTemplateSettings(template.settings),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

function belongsToTeam(
  template: TemplatePayload,
  teamId: string,
  teamKey: string,
) {
  const settings = normalizeIssueTemplateSettings(template.settings);
  return (
    settings.defaultTeamId === teamId ||
    settings.defaultTeamKey?.toUpperCase() === teamKey.toUpperCase()
  );
}

async function requireTeam(request: Request, params: Promise<{ key: string }>) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return { response: authResponse } as const;

  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return {
      response: NextResponse.json({ error: "Team not found" }, { status: 404 }),
    } as const;
  }

  return { session, teamRecord } as const;
}

async function createTeamTemplateClient(input: {
  userId: string;
  workspaceId: string;
}) {
  const token = await mintInternalApiToken(input);
  return createHeadlessTeamsClient(token);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const result = await requireTeam(request, params);
  if ("response" in result) return result.response;
  const { teamRecord } = result;

  if (headlessTeamsEnabled()) {
    const client = await createTeamTemplateClient({
      userId: result.session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const { data, error, response } = await client.GET("/issue-templates", {
      params: { query: { teamKey: teamRecord.key } },
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(
      {
        team: { name: teamRecord.name, key: teamRecord.key },
        templates: data?.templates ?? [],
      },
      { status: (response as Response).status },
    );
  }

  const templates = await db
    .select()
    .from(issueTemplate)
    .where(eq(issueTemplate.workspaceId, teamRecord.workspaceId))
    .orderBy(desc(issueTemplate.createdAt));

  return NextResponse.json({
    team: { name: teamRecord.name, key: teamRecord.key },
    templates: templates
      .filter((template) =>
        belongsToTeam(template, teamRecord.id, teamRecord.key),
      )
      .map(serialize)
      .filter((template) => !template.settings.archivedAt),
  });
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as {
      id?: unknown;
      name?: unknown;
      description?: unknown;
      settings?: unknown;
    };
  } catch {
    return null;
  }
}

function normalizeBodySettings(
  settings: unknown,
  teamRecord: { id: string; key: string },
): IssueTemplateSettings {
  const normalized = normalizeIssueTemplateSettings(settings ?? {});
  normalized.defaultTeamId = teamRecord.id;
  normalized.defaultTeamKey = teamRecord.key;
  return normalized;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const result = await requireTeam(request, params);
  if ("response" in result) return result.response;
  const { session, teamRecord } = result;
  const body = await readBody(request);
  if (!body)
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  let settings: ReturnType<typeof normalizeIssueTemplateSettings>;
  try {
    settings = normalizeBodySettings(body.settings, teamRecord);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid settings" },
      { status: 400 },
    );
  }

  if (!name) {
    return NextResponse.json(
      { error: "Template name is required" },
      { status: 400 },
    );
  }
  if (!description && !settings.body) {
    return NextResponse.json(
      { error: "Issue description is required" },
      { status: 400 },
    );
  }

  if (headlessTeamsEnabled()) {
    const client = await createTeamTemplateClient({
      userId: session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const { data, error, response } = await client.POST("/issue-templates", {
      body: {
        name,
        description,
        settings,
      } as never,
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const [template] = await db
    .insert(issueTemplate)
    .values({
      name,
      description: description || settings.body || "",
      workspaceId: teamRecord.workspaceId,
      createdById: session.user.id,
      settings,
    })
    .returning();

  return NextResponse.json({ template: serialize(template) }, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const result = await requireTeam(request, params);
  if ("response" in result) return result.response;
  const { teamRecord } = result;
  const body = await readBody(request);
  if (!body)
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const id = typeof body.id === "string" ? body.id : "";
  if (!id)
    return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const currentRows = await db
    .select()
    .from(issueTemplate)
    .where(
      and(
        eq(issueTemplate.id, id),
        eq(issueTemplate.workspaceId, teamRecord.workspaceId),
      ),
    )
    .limit(1);
  const current = currentRows[0];
  if (!current || !belongsToTeam(current, teamRecord.id, teamRecord.key)) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  let settings: ReturnType<typeof normalizeIssueTemplateSettings>;
  try {
    settings = normalizeBodySettings(body.settings, teamRecord);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid settings" },
      { status: 400 },
    );
  }
  if (!name) {
    return NextResponse.json(
      { error: "Template name is required" },
      { status: 400 },
    );
  }
  if (!description && !settings.body) {
    return NextResponse.json(
      { error: "Issue description is required" },
      { status: 400 },
    );
  }

  if (headlessTeamsEnabled()) {
    const client = await createTeamTemplateClient({
      userId: result.session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const { data, error, response } = await client.PATCH(
      "/issue-templates/{id}",
      {
        params: { path: { id } },
        body: {
          name,
          description,
          settings,
        } as never,
      },
    );
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const [template] = await db
    .update(issueTemplate)
    .set({
      name,
      description: description || settings.body || "",
      settings,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(issueTemplate.id, id),
        eq(issueTemplate.workspaceId, teamRecord.workspaceId),
      ),
    )
    .returning();

  return NextResponse.json({ template: serialize(template) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const result = await requireTeam(request, params);
  if ("response" in result) return result.response;
  const { teamRecord } = result;
  const body = await readBody(request);
  if (!body)
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const id = typeof body.id === "string" ? body.id : "";
  if (!id)
    return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const currentRows = await db
    .select()
    .from(issueTemplate)
    .where(
      and(
        eq(issueTemplate.id, id),
        eq(issueTemplate.workspaceId, teamRecord.workspaceId),
      ),
    )
    .limit(1);
  const current = currentRows[0];
  if (!current || !belongsToTeam(current, teamRecord.id, teamRecord.key)) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  if (headlessTeamsEnabled()) {
    const client = await createTeamTemplateClient({
      userId: result.session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const { data, error, response } = await client.DELETE(
      "/issue-templates/{id}",
      {
        params: { path: { id } },
      },
    );
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const [deleted] = await db
    .delete(issueTemplate)
    .where(
      and(
        eq(issueTemplate.id, id),
        eq(issueTemplate.workspaceId, teamRecord.workspaceId),
      ),
    )
    .returning();
  if (!deleted) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
