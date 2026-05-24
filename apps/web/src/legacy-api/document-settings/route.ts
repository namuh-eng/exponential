import { requireApiSession } from "@/lib/api-auth";
import {
  findDocumentSettingsAccess,
  readDocumentSettings,
} from "@/lib/document-settings";
import {
  createHeadlessDocumentsClient,
  headlessDocumentsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
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

  if (headlessDocumentsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: access.id,
    });
    const client = createHeadlessDocumentsClient(token);
    const { data, error, response } = await client.GET("/document-settings");
    if (error)
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    return NextResponse.json(data, { status: (response as Response).status });
  }

  return NextResponse.json({
    documents: readDocumentSettings(access.settings),
  });
}
