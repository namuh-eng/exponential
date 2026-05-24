import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import {
  readProjectUpdateConfigurations,
  validateProjectUpdateConfigurationInput,
  writeProjectUpdateConfigurations,
} from "@/lib/project-update-configurations";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type WorkspaceAccess = {
  workspaceId: string;
  role: string;
  settings: unknown;
};

function canManageProjectUpdates(role: string) {
  return role === "owner" || role === "admin";
}

async function getWorkspaceAccess(
  userId: string,
): Promise<WorkspaceAccess | null> {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) {
    return null;
  }

  const [record] = await db
    .select({
      workspaceId: workspace.id,
      role: member.role,
      settings: workspace.settings,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(eq(member.workspaceId, workspace.id), eq(member.userId, userId)),
    )
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  return record ?? null;
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const access = await getWorkspaceAccess(session.user.id);
  if (!access) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  return NextResponse.json({
    configurations: readProjectUpdateConfigurations(access.settings),
    canManage: canManageProjectUpdates(access.role),
  });
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const access = await getWorkspaceAccess(session.user.id);
  if (!access) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  if (!canManageProjectUpdates(access.role)) {
    return NextResponse.json(
      { error: "Only workspace admins can manage project updates" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validation = validateProjectUpdateConfigurationInput(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const now = new Date().toISOString();
  const configuration = {
    ...validation.configuration,
    createdAt: now,
    updatedAt: now,
  };
  const configurations = [
    configuration,
    ...readProjectUpdateConfigurations(access.settings),
  ];

  await db
    .update(workspace)
    .set({
      settings: writeProjectUpdateConfigurations(
        access.settings,
        configurations,
      ),
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, access.workspaceId));

  return NextResponse.json({ configuration }, { status: 201 });
}
