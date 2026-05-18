import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import { serializeIntegrations } from "@/lib/integrations";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const workspaceId =
    "apiKey" in session
      ? session.apiKey.workspaceId
      : await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  const [row] = await db
    .select({ settings: workspace.settings, role: member.role })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, session.user.id),
      ),
    )
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!row)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  return NextResponse.json({
    integrations: serializeIntegrations(row.settings),
    canManageIntegrations: row.role === "owner" || row.role === "admin",
  });
}
