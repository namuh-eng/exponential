import { requireApiSession } from "@/lib/api-auth";
import {
  canManageDocumentSettings,
  findDocumentSettingsAccess,
  parseFolderInput,
  persistDocumentSettings,
  readDocumentSettings,
} from "@/lib/document-settings";
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
  const existing = documents.folders.find((folder) => folder.id === id);
  if (!existing) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  let input: ReturnType<typeof parseFolderInput>;
  try {
    input = parseFolderInput(body, existing);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid folder" },
      { status: 400 },
    );
  }

  const folder = { ...existing, ...input, updatedAt: new Date().toISOString() };
  documents.folders = documents.folders.map((item) =>
    item.id === id ? folder : item,
  );
  await persistDocumentSettings(access, documents);

  return NextResponse.json({ folder });
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
  const exists = documents.folders.some((folder) => folder.id === id);
  if (!exists) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }
  documents.folders = documents.folders.filter((folder) => folder.id !== id);
  await persistDocumentSettings(access, documents);

  return NextResponse.json({ success: true });
}
