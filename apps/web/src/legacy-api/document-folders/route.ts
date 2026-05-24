import { randomUUID } from "node:crypto";
import { requireApiSession } from "@/lib/api-auth";
import {
  canManageDocumentSettings,
  findDocumentSettingsAccess,
  parseFolderInput,
  persistDocumentSettings,
  readDocumentSettings,
} from "@/lib/document-settings";
import {
  createHeadlessDocumentsClient,
  headlessDocumentsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  if (headlessDocumentsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: access.id,
    });
    const client = createHeadlessDocumentsClient(token);
    const { data, error, response } = await client.POST("/document-folders", {
      body: body as never,
    });
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  let input: ReturnType<typeof parseFolderInput>;
  try {
    input = parseFolderInput(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid folder" },
      { status: 400 },
    );
  }

  const documents = readDocumentSettings(access.settings);
  const now = new Date().toISOString();
  const folder = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
  documents.folders = [folder, ...documents.folders];
  await persistDocumentSettings(access, documents);

  return NextResponse.json({ folder }, { status: 201 });
}
