import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import { asRecord, isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import {
  normalizeSamlInput,
  readWorkspaceSamlSettings,
  validateSamlSettings,
} from "@/lib/workspace-saml-scim";
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

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const currentWorkspace = await findCurrentWorkspace(session.user.id);
  if (!currentWorkspace) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (!isWorkspaceAdminRole(currentWorkspace.role)) {
    return NextResponse.json(
      { error: "You do not have permission to manage SAML settings" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const currentSettings = asRecord(currentWorkspace.settings);
  const currentSaml = readWorkspaceSamlSettings(currentSettings);
  const saml = normalizeSamlInput(body, currentSaml);
  const validationError = validateSamlSettings(saml);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const settings = {
    ...currentSettings,
    security: {
      ...asRecord(currentSettings.security),
      saml,
    },
  };

  await db
    .update(workspace)
    .set({ settings, updatedAt: new Date() })
    .where(eq(workspace.id, currentWorkspace.id));

  return NextResponse.json({ saml });
}
