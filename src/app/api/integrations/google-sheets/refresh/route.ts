import { requireApiSession } from "@/lib/api-auth";
import {
  findGoogleSheetsIntegration,
  refreshGoogleSheetsIntegration,
  serializeGoogleSheetsIntegration,
} from "@/lib/google-sheets-sync";
import {
  canManageIntegrations,
  getWorkspaceAccess,
} from "@/lib/workspace-integrations";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const access = await getWorkspaceAccess(session, request);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }
  if (!canManageIntegrations(access.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const integration = await findGoogleSheetsIntegration(access.workspaceId);
  if (!integration) {
    return NextResponse.json(
      { error: "Google Sheets is not connected" },
      { status: 404 },
    );
  }

  const { metadata } = await refreshGoogleSheetsIntegration(
    access,
    integration,
  );

  return NextResponse.json({
    integration: serializeGoogleSheetsIntegration(
      { ...integration, metadata, status: "connected" },
      access,
    ),
  });
}
