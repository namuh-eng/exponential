import { requireApiSession } from "@/lib/api-auth";
import {
  canManageDocumentSettings,
  findDocumentSettingsAccess,
  parseTemplateInput,
  persistDocumentSettings,
  readDocumentSettings,
} from "@/lib/document-settings";
import {
  createHeadlessDocumentsClient,
  headlessDocumentsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await findDocumentSettingsAccess(session.user.id, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }
  if (!canManageDocumentSettings(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const documents = readDocumentSettings(access.settings);
  const { id } = await params;
  const existing = documents.templates.find((template) => template.id === id);
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  if (headlessDocumentsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: access.id,
    });
    const client = createHeadlessDocumentsClient(token);
    const { data, error, response } = await client.PATCH(
      "/document-templates/{id}",
      {
        params: { path: { id } },
        body: body as never,
      },
    );
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  let input: ReturnType<typeof parseTemplateInput>;
  try {
    input = parseTemplateInput(body, existing);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid template" },
      { status: 400 },
    );
  }

  const template = {
    ...existing,
    ...input,
    updatedAt: new Date().toISOString(),
  };
  documents.templates = documents.templates.map((item) =>
    item.id === id ? template : item,
  );
  await persistDocumentSettings(access, documents);

  return NextResponse.json({ template });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await findDocumentSettingsAccess(session.user.id, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }
  if (!canManageDocumentSettings(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const documents = readDocumentSettings(access.settings);
  const { id } = await params;

  if (headlessDocumentsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: access.id,
    });
    const client = createHeadlessDocumentsClient(token);
    const { data, error, response } = await client.DELETE(
      "/document-templates/{id}",
      {
        params: { path: { id } },
      },
    );
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const exists = documents.templates.some((template) => template.id === id);
  if (!exists) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  documents.templates = documents.templates.filter(
    (template) => template.id !== id,
  );
  await persistDocumentSettings(access, documents);

  return NextResponse.json({ success: true });
}
