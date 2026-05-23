import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  teamNotificationIntegration,
  workspaceIntegration,
} from "@/lib/db/schema";
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

  const [integration] = await db
    .select({ id: workspaceIntegration.id })
    .from(workspaceIntegration)
    .where(
      and(
        eq(workspaceIntegration.workspaceId, access.workspaceId),
        eq(workspaceIntegration.provider, "slack"),
      ),
    )
    .limit(1);

  if (integration) {
    await db
      .delete(teamNotificationIntegration)
      .where(
        eq(teamNotificationIntegration.workspaceIntegrationId, integration.id),
      );
    await db
      .delete(workspaceIntegration)
      .where(eq(workspaceIntegration.id, integration.id));
  }

  return NextResponse.json({ success: true });
}
