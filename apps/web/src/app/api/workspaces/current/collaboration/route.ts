import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import {
  mergeCollaborationSettings,
  parseCollaborationUpdate,
  readCollaborationSettings,
} from "@/lib/collaboration-settings";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function findWorkspaceSettings(userId: string) {
  const activeWorkspaceId = await resolveActiveWorkspaceId(userId);
  if (!activeWorkspaceId) return null;

  const [currentWorkspace] = await db
    .select({
      id: workspace.id,
      settings: workspace.settings,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, userId),
        eq(member.workspaceId, activeWorkspaceId),
      ),
    )
    .limit(1);

  return currentWorkspace ?? null;
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const currentWorkspace = await findWorkspaceSettings(session.user.id);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    collaboration: readCollaborationSettings(currentWorkspace.settings),
    permissions: {
      canManage:
        currentWorkspace.role === "owner" || currentWorkspace.role === "admin",
      role: currentWorkspace.role,
    },
  });
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const currentWorkspace = await findWorkspaceSettings(session.user.id);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (currentWorkspace.role !== "owner" && currentWorkspace.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const settings = mergeCollaborationSettings(
    currentWorkspace.settings,
    parseCollaborationUpdate(body),
  );

  await db
    .update(workspace)
    .set({ settings, updatedAt: new Date() })
    .where(eq(workspace.id, currentWorkspace.id));

  return NextResponse.json({
    collaboration: readCollaborationSettings(settings),
    permissions: { canManage: true, role: currentWorkspace.role },
  });
}
