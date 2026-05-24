import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import {
  createHeadlessWorkspacesClient,
  headlessWorkspacesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import {
  canManageInitiativeSettings,
  mergeWorkspaceInitiativeSettings,
  readWorkspaceInitiativeSettings,
  validateWorkspaceInitiativeSettingsPatch,
} from "@/lib/initiative-settings";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function getAccess(userId: string) {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const [access] = await db
    .select({
      workspaceId: workspace.id,
      settings: workspace.settings,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.workspaceId, workspaceId),
        eq(member.userId, userId),
      ),
    )
    .limit(1);

  return access ?? null;
}

type Access = NonNullable<Awaited<ReturnType<typeof getAccess>>>;

function payload(access: Access) {
  return {
    initiativesSettings: readWorkspaceInitiativeSettings(access.settings),
    viewerRole: access.role,
    canManage: canManageInitiativeSettings(access.role),
  };
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  if (headlessWorkspacesEnabled()) {
    const workspaceId = await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.GET(
        "/workspaces/current/initiatives-settings",
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const access = await getAccess(session.user.id);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  return NextResponse.json(payload(access));
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  if (headlessWorkspacesEnabled()) {
    const workspaceId = await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const body = await request.json().catch(() => null);
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessWorkspacesClient(token);
      const { data, error, response } = await client.PATCH(
        "/workspaces/current/initiatives-settings",
        { body: body as never },
      );
      if (error) {
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      }
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const access = await getAccess(session.user.id);
  if (!access) {
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  }

  if (!canManageInitiativeSettings(access.role)) {
    return NextResponse.json(
      { error: "You do not have permission to manage initiative settings" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = validateWorkspaceInitiativeSettingsPatch(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const nextSettings = {
    ...readWorkspaceInitiativeSettings(access.settings),
    ...parsed.settings,
  };

  await db
    .update(workspace)
    .set({
      settings: mergeWorkspaceInitiativeSettings(access.settings, nextSettings),
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, access.workspaceId));

  return NextResponse.json({
    initiativesSettings: nextSettings,
    viewerRole: access.role,
    canManage: true,
  });
}
