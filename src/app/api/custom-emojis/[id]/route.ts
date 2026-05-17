import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { type ApiSession, requireApiSession } from "@/lib/api-auth";
import { removeCustomEmojiFromWorkspaceSettings } from "@/lib/custom-emojis";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function getWorkspaceId(session: ApiSession) {
  if ("apiKey" in session) return session.apiKey.workspaceId;
  return resolveActiveWorkspaceId(session.user.id);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const workspaceId = await getWorkspaceId(session);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const [currentWorkspace] = await db
    .select({ id: workspace.id, settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  if (!currentWorkspace) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const { id } = await context.params;
  const update = removeCustomEmojiFromWorkspaceSettings(
    currentWorkspace.settings,
    id,
  );
  if (!update.found) {
    return NextResponse.json(
      { error: "Custom emoji not found" },
      { status: 404 },
    );
  }

  await db
    .update(workspace)
    .set({ settings: update.settings, updatedAt: new Date() })
    .where(eq(workspace.id, currentWorkspace.id));
  return NextResponse.json({ ok: true });
}
