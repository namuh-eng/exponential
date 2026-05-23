import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import { asRecord, isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import {
  createScimToken,
  readWorkspaceScimSettings,
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

function baseUrl(request: Request, workspaceId: string) {
  return `${new URL(request.url).origin}/api/scim/${workspaceId}`;
}

async function loadAdminWorkspace(userId: string) {
  const currentWorkspace = await findCurrentWorkspace(userId);
  if (!currentWorkspace) {
    return {
      error: NextResponse.json(
        { error: "No active workspace found" },
        { status: 404 },
      ),
    };
  }
  if (!isWorkspaceAdminRole(currentWorkspace.role)) {
    return {
      error: NextResponse.json(
        { error: "You do not have permission to manage SCIM settings" },
        { status: 403 },
      ),
    };
  }
  return { currentWorkspace };
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const loaded = await loadAdminWorkspace(session.user.id);
  if (loaded.error) return loaded.error;

  const body = (await request.json().catch(() => null)) as {
    enabled?: unknown;
  } | null;
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "SCIM enabled must be a boolean" },
      { status: 400 },
    );
  }

  const currentSettings = asRecord(loaded.currentWorkspace.settings);
  const scim = {
    ...readWorkspaceScimSettings(
      currentSettings,
      baseUrl(request, loaded.currentWorkspace.id),
    ),
    enabled: body.enabled,
    status: body.enabled ? ("enabled" as const) : ("disabled" as const),
  };
  const settings = {
    ...currentSettings,
    security: { ...asRecord(currentSettings.security), scim },
  };
  await db
    .update(workspace)
    .set({ settings, updatedAt: new Date() })
    .where(eq(workspace.id, loaded.currentWorkspace.id));
  return NextResponse.json({
    scim: {
      ...scim,
      tokens: scim.tokens.map(({ tokenHash: _tokenHash, ...item }) => item),
    },
  });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;
  const loaded = await loadAdminWorkspace(session.user.id);
  if (loaded.error) return loaded.error;

  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const { secret, token } = createScimToken(
    typeof body.name === "string" ? body.name : undefined,
  );
  const currentSettings = asRecord(loaded.currentWorkspace.settings);
  const currentScim = readWorkspaceScimSettings(
    currentSettings,
    baseUrl(request, loaded.currentWorkspace.id),
  );
  const scim = {
    ...currentScim,
    enabled: true,
    status: "enabled" as const,
    tokens: [...currentScim.tokens, token],
  };
  const settings = {
    ...currentSettings,
    security: { ...asRecord(currentSettings.security), scim },
  };
  await db
    .update(workspace)
    .set({ settings, updatedAt: new Date() })
    .where(eq(workspace.id, loaded.currentWorkspace.id));
  const { tokenHash: _tokenHash, ...created } = token;
  return NextResponse.json({
    token: secret,
    scim: {
      ...scim,
      tokens: scim.tokens.map(({ tokenHash: _hash, ...item }) => item),
    },
    created,
  });
}
