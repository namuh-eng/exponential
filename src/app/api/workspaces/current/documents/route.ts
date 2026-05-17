import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type DocumentTemplate = {
  id: string;
  name: string;
  description: string;
};

type DocumentsSettings = {
  defaultVisibility: "workspace" | "private";
  autoLinkProjectDocuments: boolean;
  templates: DocumentTemplate[];
};

const defaultDocuments: DocumentsSettings = {
  defaultVisibility: "workspace",
  autoLinkProjectDocuments: true,
  templates: [],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeDocuments(settings: unknown): DocumentsSettings {
  const documents = asRecord(asRecord(settings).documents);
  const rawTemplates = Array.isArray(documents.templates)
    ? documents.templates
    : [];

  return {
    defaultVisibility:
      documents.defaultVisibility === "private" ? "private" : "workspace",
    autoLinkProjectDocuments:
      typeof documents.autoLinkProjectDocuments === "boolean"
        ? documents.autoLinkProjectDocuments
        : defaultDocuments.autoLinkProjectDocuments,
    templates: rawTemplates
      .map((template) => asRecord(template))
      .filter(
        (template) =>
          typeof template.id === "string" && typeof template.name === "string",
      )
      .map((template) => ({
        id: String(template.id),
        name: String(template.name),
        description:
          typeof template.description === "string" ? template.description : "",
      })),
  };
}

async function loadWorkspace(userId: string, request: Request) {
  const workspaceId = await resolveRequestWorkspaceId(userId, request);
  if (!workspaceId) return null;

  const [record] = await db
    .select({ id: workspace.id, settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  return record ?? null;
}

async function saveDocuments(
  workspaceId: string,
  settings: unknown,
  documents: DocumentsSettings,
) {
  await db
    .update(workspace)
    .set({
      settings: { ...asRecord(settings), documents },
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, workspaceId));
}

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const currentWorkspace = await loadWorkspace(session.user.id, request);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    documents: normalizeDocuments(currentWorkspace.settings),
  });
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const currentWorkspace = await loadWorkspace(session.user.id, request);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    defaultVisibility?: unknown;
    autoLinkProjectDocuments?: unknown;
  } | null;
  if (!body)
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const documents = normalizeDocuments(currentWorkspace.settings);
  const nextDocuments: DocumentsSettings = {
    ...documents,
    defaultVisibility:
      body.defaultVisibility === "workspace" ||
      body.defaultVisibility === "private"
        ? body.defaultVisibility
        : documents.defaultVisibility,
    autoLinkProjectDocuments:
      typeof body.autoLinkProjectDocuments === "boolean"
        ? body.autoLinkProjectDocuments
        : documents.autoLinkProjectDocuments,
  };

  await saveDocuments(
    currentWorkspace.id,
    currentWorkspace.settings,
    nextDocuments,
  );
  return NextResponse.json({ documents: nextDocuments });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const currentWorkspace = await loadWorkspace(session.user.id, request);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    description?: unknown;
  } | null;
  if (!body)
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: "Template name is required" },
      { status: 400 },
    );
  }

  const documents = normalizeDocuments(currentWorkspace.settings);
  const template: DocumentTemplate = {
    id: crypto.randomUUID(),
    name: name.slice(0, 120),
    description:
      typeof body.description === "string"
        ? body.description.trim().slice(0, 500)
        : "",
  };
  const nextDocuments = {
    ...documents,
    templates: [template, ...documents.templates],
  };

  await saveDocuments(
    currentWorkspace.id,
    currentWorkspace.settings,
    nextDocuments,
  );
  return NextResponse.json(
    { documents: nextDocuments, template },
    { status: 201 },
  );
}
