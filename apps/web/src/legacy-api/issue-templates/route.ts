import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issueTemplate } from "@/lib/db/schema";
import {
  createHeadlessIssueTemplatesClient,
  headlessIssueTemplatesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { findAccessibleTeam } from "@/lib/teams";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";

export type IssueTemplateSettings = {
  title?: string;
  body?: string;
  defaultPriority?: string;
  defaultStatusId?: string;
  defaultStatusName?: string;
  defaultTeamId?: string;
  defaultTeamKey?: string;
  defaultScope?: string;
  defaultProjectId?: string | null;
  archivedAt?: string;
};

type IssueTemplatePayload = {
  id: string;
  name: string;
  description: string;
  templateType?: string;
  teamId?: string | null;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const PRIORITIES = new Set(["urgent", "high", "medium", "low", "none", ""]);

export function normalizeIssueTemplateSettings(
  value: unknown,
): IssueTemplateSettings {
  const input =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const settings: IssueTemplateSettings = {};
  for (const key of [
    "title",
    "body",
    "defaultStatusId",
    "defaultStatusName",
    "defaultTeamId",
    "defaultTeamKey",
    "defaultScope",
    "archivedAt",
  ] as const) {
    if (typeof input[key] === "string") settings[key] = input[key].trim();
  }
  if (typeof input.defaultPriority === "string") {
    const priority = input.defaultPriority.trim().toLowerCase();
    if (!PRIORITIES.has(priority)) throw new Error("Invalid default priority");
    if (priority) settings.defaultPriority = priority;
  }
  if (input.defaultProjectId === null) settings.defaultProjectId = null;
  else if (typeof input.defaultProjectId === "string")
    settings.defaultProjectId = input.defaultProjectId.trim() || null;
  return settings;
}

function serializeTemplate(template: IssueTemplatePayload) {
  const settings = normalizeIssueTemplateSettings(template.settings);
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? "",
    type: template.templateType ?? "issue",
    teamId: template.teamId ?? null,
    settings,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

async function getWorkspace(userId: string) {
  return resolveActiveWorkspaceId(userId);
}

export async function GET(
  request = new Request("http://localhost/api/issue-templates"),
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const workspaceId = await getWorkspace(session.user.id);
  if (!workspaceId) return NextResponse.json({ templates: [] });

  if (headlessIssueTemplatesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessIssueTemplatesClient(token);
    const searchParams = new URL(request.url).searchParams;
    const query = Object.fromEntries(searchParams.entries());
    const { data, error, response } = await client.GET("/issue-templates", {
      params: { query },
    } as never);
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const teamKey = new URL(request.url).searchParams.get("teamKey")?.trim();
  let teamId: string | null = null;
  if (teamKey) {
    const teamRecord = await findAccessibleTeam(teamKey, session.user.id, {
      request,
    });
    if (!teamRecord) {
      return NextResponse.json({ templates: [] });
    }
    teamId = teamRecord.id;
  }

  const templates = await db
    .select({
      id: issueTemplate.id,
      name: issueTemplate.name,
      description: issueTemplate.description,
      templateType: issueTemplate.templateType,
      teamId: issueTemplate.teamId,
      settings: issueTemplate.settings,
      createdAt: issueTemplate.createdAt,
      updatedAt: issueTemplate.updatedAt,
    })
    .from(issueTemplate)
    .where(
      and(
        eq(issueTemplate.workspaceId, workspaceId),
        teamId
          ? or(isNull(issueTemplate.teamId), eq(issueTemplate.teamId, teamId))
          : isNull(issueTemplate.teamId),
        eq(issueTemplate.templateType, "issue"),
      ),
    )
    .orderBy(desc(issueTemplate.createdAt));

  return NextResponse.json({
    templates: templates
      .map(serializeTemplate)
      .filter((template) => !template.settings.archivedAt),
  });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const workspaceId = await getWorkspace(session.user.id);
  if (!workspaceId)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });

  let body: {
    name?: unknown;
    description?: unknown;
    settings?: unknown;
    duplicateFromId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (headlessIssueTemplatesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessIssueTemplatesClient(token);
    const { data, error, response } = await client.POST("/issue-templates", {
      body: body as never,
    });
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  let source: IssueTemplatePayload | null = null;
  if (typeof body.duplicateFromId === "string" && body.duplicateFromId) {
    [source] = await db
      .select({
        id: issueTemplate.id,
        name: issueTemplate.name,
        description: issueTemplate.description,
        templateType: issueTemplate.templateType,
        teamId: issueTemplate.teamId,
        settings: issueTemplate.settings,
        createdAt: issueTemplate.createdAt,
        updatedAt: issueTemplate.updatedAt,
      })
      .from(issueTemplate)
      .where(
        and(
          eq(issueTemplate.id, body.duplicateFromId),
          eq(issueTemplate.workspaceId, workspaceId),
          isNull(issueTemplate.teamId),
        ),
      )
      .limit(1);
    if (!source)
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 },
      );
  }

  const name = `${body.name ?? source?.name ?? ""}`.trim();
  const description =
    typeof body.description === "string"
      ? body.description.trim()
      : (source?.description ?? "").trim();
  let settings: IssueTemplateSettings;
  try {
    settings = normalizeIssueTemplateSettings(
      body.settings ?? source?.settings ?? {},
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid settings" },
      { status: 400 },
    );
  }

  if (!name)
    return NextResponse.json(
      { error: "Template name is required" },
      { status: 400 },
    );
  if (!description && !settings.body)
    return NextResponse.json(
      { error: "Issue description is required" },
      { status: 400 },
    );

  const [template] = await db
    .insert(issueTemplate)
    .values({
      name: source && !body.name ? `${name} copy` : name,
      description: description || settings.body || "",
      templateType: "issue",
      workspaceId,
      teamId: null,
      createdById: session.user.id,
      settings,
    })
    .returning();
  return NextResponse.json(
    { template: serializeTemplate(template) },
    { status: 201 },
  );
}
