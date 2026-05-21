import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import { asRecord, isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import { readWorkspaceScimSettings } from "@/lib/workspace-saml-scim";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function findCurrentWorkspace(userId: string) {
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tokenId: string }> | { tokenId: string } },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const currentWorkspace = await findCurrentWorkspace(session.user.id);
  if (!currentWorkspace)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  if (!isWorkspaceAdminRole(currentWorkspace.role)) {
    return NextResponse.json(
      { error: "You do not have permission to manage SCIM settings" },
      { status: 403 },
    );
  }
  const { tokenId } = await params;
  const currentSettings = asRecord(currentWorkspace.settings);
  const currentScim = readWorkspaceScimSettings(currentSettings);
  const now = new Date().toISOString();
  const scim = {
    ...currentScim,
    tokens: currentScim.tokens.map((token) =>
      token.id === tokenId
        ? { ...token, revokedAt: token.revokedAt ?? now }
        : token,
    ),
  };
  const settings = {
    ...currentSettings,
    security: { ...asRecord(currentSettings.security), scim },
  };
  await db
    .update(workspace)
    .set({ settings, updatedAt: new Date() })
    .where(eq(workspace.id, currentWorkspace.id));
  return NextResponse.json({
    scim: {
      ...scim,
      tokens: scim.tokens.map(({ tokenHash: _tokenHash, ...item }) => item),
    },
  });
}
