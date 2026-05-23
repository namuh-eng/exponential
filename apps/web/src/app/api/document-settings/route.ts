import { requireApiSession } from "@/lib/api-auth";
import {
  findDocumentSettingsAccess,
  readDocumentSettings,
} from "@/lib/document-settings";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await findDocumentSettingsAccess(session.user.id, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    documents: readDocumentSettings(access.settings),
  });
}
