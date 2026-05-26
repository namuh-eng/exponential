import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { projectTemplate } from "@/lib/db/schema";
import {
  createHeadlessProjectTemplatesClient,
  headlessProjectTemplatesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { buildProjectTemplateSettings } from "@/lib/project-template-settings";
import { and, eq } from "drizzle-orm";
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

  let body: {
    name?: unknown;
    description?: unknown;
    settings?: {
      status?: unknown;
      priority?: unknown;
      labelIds?: unknown;
      milestones?: unknown;
    };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id } = await params;

  if (headlessProjectTemplatesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessProjectTemplatesClient(token);
    const { data, error, response } = await client.PATCH(
      "/project-templates/{id}",
      {
        params: { path: { id } },
        body: body as never,
      },
    );
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const name = `${body.name ?? ""}`.trim();
  if (!name) {
    return NextResponse.json(
      { error: "Template name is required" },
      { status: 400 },
    );
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;
  const settings = buildProjectTemplateSettings(body.settings ?? {});

  const [template] = await db
    .update(projectTemplate)
    .set({ name, description, settings, updatedAt: new Date() })
    .where(
      and(
        eq(projectTemplate.id, id),
        eq(projectTemplate.workspaceId, workspaceId),
      ),
    )
    .returning();

  if (!template) {
    return NextResponse.json(
      { error: "Project template not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ template: serializeTemplate(template) });
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

  if (headlessProjectTemplatesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessProjectTemplatesClient(token);
    const { data, error, response } = await client.DELETE(
      "/project-templates/{id}",
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
    .delete(projectTemplate)
    .where(
      and(
        eq(projectTemplate.id, id),
        eq(projectTemplate.workspaceId, workspaceId),
      ),
    )
    .returning();

  if (!deleted) {
    return NextResponse.json(
      { error: "Project template not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true });
}
