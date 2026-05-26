import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, workspace } from "@/lib/db/schema";
import {
  createHeadlessProjectUpdateConfigurationsClient,
  headlessProjectUpdateConfigurationsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const access = await getWorkspaceAccess(session.user.id);
  if (!access) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const { id } = await params;
  if (headlessProjectUpdateConfigurationsEnabled()) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: access.workspaceId,
    });
    const client = createHeadlessProjectUpdateConfigurationsClient(token);
    const { data, error, response } = await client.PATCH(
      "/project-update-configurations/{id}",
      { params: { path: { id } }, body: body as never },
    );
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
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

  const current = readProjectUpdateConfigurations(access.settings);
  const existing = current.find((configuration) => configuration.id === id);
  if (!existing) {
    return NextResponse.json(
      { error: "Project update configuration not found" },
      { status: 404 },
    );
  }

  const validation = validateProjectUpdateConfigurationInput(body, id);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const configuration = {
    ...validation.configuration,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const configurations = current.map((item) =>
    item.id === id ? configuration : item,
  );

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

  return NextResponse.json({ configuration });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const access = await getWorkspaceAccess(session.user.id);
  if (!access) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const { id } = await params;
  if (headlessProjectUpdateConfigurationsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: access.workspaceId,
    });
    const client = createHeadlessProjectUpdateConfigurationsClient(token);
    const { data, error, response } = await client.DELETE(
      "/project-update-configurations/{id}",
      { params: { path: { id } } },
    );
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  if (!canManageProjectUpdates(access.role)) {
    return NextResponse.json(
      { error: "Only workspace admins can manage project updates" },
      { status: 403 },
    );
  }

  const current = readProjectUpdateConfigurations(access.settings);
  if (!current.some((configuration) => configuration.id === id)) {
    return NextResponse.json(
      { error: "Project update configuration not found" },
      { status: 404 },
    );
  }

  await db
    .update(workspace)
    .set({
      settings: writeProjectUpdateConfigurations(
        access.settings,
        current.filter((configuration) => configuration.id !== id),
      ),
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, access.workspaceId));

  return NextResponse.json({ success: true });
}
