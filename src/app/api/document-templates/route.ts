import { randomUUID } from "node:crypto";
import { requireApiSession } from "@/lib/api-auth";
import {
  canManageDocumentSettings,
  findDocumentSettingsAccess,
  parseTemplateInput,
  persistDocumentSettings,
  readDocumentSettings,
} from "@/lib/document-settings";
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

  let input: ReturnType<typeof parseTemplateInput>;
  try {
    input = parseTemplateInput(body);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid template" },
      { status: 400 },
    );
  }

  const documents = readDocumentSettings(access.settings);
  const now = new Date().toISOString();
  const template = {
    id: randomUUID(),
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  documents.templates = [template, ...documents.templates];
  await persistDocumentSettings(access, documents);

  return NextResponse.json({ template }, { status: 201 });
}
