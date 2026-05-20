import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import { readImportExportState } from "@/lib/import-export";
import { isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );

  const [currentWorkspace] = await db
    .select({
      id: workspace.id,
      urlSlug: workspace.urlSlug,
      settings: workspace.settings,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, session.user.id),
        eq(member.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!currentWorkspace)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  if (!isWorkspaceAdminRole(currentWorkspace.role)) {
    return NextResponse.json(
      { error: "Only workspace admins can download workspace exports" },
      { status: 403 },
    );
  }

  const { id } = await params;
  const state = readImportExportState(currentWorkspace.settings);
  const artifact = state.artifacts[id];
  const job = state.exports.find((candidate) => candidate.id === id);
  if (!artifact || !job)
    return NextResponse.json({ error: "Export not found" }, { status: 404 });

  return new Response(JSON.stringify(artifact, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${currentWorkspace.urlSlug}-workspace-export-${id}.json"`,
    },
  });
}
