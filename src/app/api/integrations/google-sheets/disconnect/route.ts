import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { workspaceIntegration } from "@/lib/db/schema";
import { GOOGLE_SHEETS_PROVIDER } from "@/lib/google-sheets-sync";
import {
  canManageIntegrations,
  getWorkspaceAccess,
} from "@/lib/workspace-integrations";
import { and, eq } from "drizzle-orm";
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

  await db
    .delete(workspaceIntegration)
    .where(
      and(
        eq(workspaceIntegration.workspaceId, access.workspaceId),
        eq(workspaceIntegration.provider, GOOGLE_SHEETS_PROVIDER),
      ),
    );

  return NextResponse.json({ success: true });
}
