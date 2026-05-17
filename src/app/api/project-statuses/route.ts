import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, project, workspace } from "@/lib/db/schema";
import {
  DEFAULT_PROJECT_STATUSES,
  readProjectStatusSettings,
  serializeProjectStatusSettings,
  validateProjectStatusesInput,
} from "@/lib/project-status-settings";
import { and, count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type ProjectStatusDbValue = (typeof DEFAULT_PROJECT_STATUSES)[number]["key"];

type WorkspaceAccess = {
  workspaceId: string;
  role: string;
  settings: unknown;
};

function canManageProjectStatuses(role: string) {
  return role === "owner" || role === "admin";
}

function toStatusCounts(
  rows: { status: ProjectStatusDbValue; count: number | string }[],
) {
  const countsByDbValue = new Map<string, number>();

  for (const row of rows) {
    countsByDbValue.set(row.status, Number(row.count));
  }

  return countsByDbValue;
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

async function getProjectCounts(workspaceId: string) {
  const rows = await db
    .select({ status: project.status, count: count() })
    .from(project)
    .where(eq(project.workspaceId, workspaceId))
    .groupBy(project.status);

  return toStatusCounts(rows);
}

function buildStatuses(settings: unknown, countsByKey: Map<string, number>) {
  return readProjectStatusSettings(settings).map((status) => ({
    ...status,
    projectCount: countsByKey.get(status.key) ?? 0,
  }));
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  try {
    const access = await getWorkspaceAccess(session.user.id);
    if (!access) {
      return NextResponse.json({
        statuses: DEFAULT_PROJECT_STATUSES.map((status) => ({
          ...status,
          projectCount: 0,
        })),
        totalProjects: 0,
        readOnly: false,
        customStatusesSupported: true,
        canManage: false,
      });
    }

    const countsByKey = await getProjectCounts(access.workspaceId);
    const statuses = buildStatuses(access.settings, countsByKey);

    return NextResponse.json({
      statuses,
      totalProjects: statuses.reduce(
        (total: number, status: { projectCount: number }) =>
          total + status.projectCount,
        0,
      ),
      readOnly: false,
      customStatusesSupported: true,
      canManage: canManageProjectStatuses(access.role),
      limitation:
        "Custom project statuses are configurable in settings; project records still store the default lifecycle values.",
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load project statuses" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const access = await getWorkspaceAccess(session.user.id);
  if (!access) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  if (!canManageProjectStatuses(access.role)) {
    return NextResponse.json(
      { error: "Only workspace admins can manage project statuses" },
      { status: 403 },
    );
  }

  let body: { statuses?: unknown };
  try {
    body = (await request.json()) as { statuses?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const countsByKey = await getProjectCounts(access.workspaceId);
  const validation = validateProjectStatusesInput(body.statuses, countsByKey);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  await db
    .update(workspace)
    .set({
      settings: {
        ...(access.settings && typeof access.settings === "object"
          ? (access.settings as Record<string, unknown>)
          : {}),
        projectStatuses: serializeProjectStatusSettings(validation.statuses),
      },
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, access.workspaceId));

  const statuses = validation.statuses.map((status) => ({
    ...status,
    projectCount: countsByKey.get(status.key) ?? 0,
  }));

  return NextResponse.json({
    statuses,
    totalProjects: statuses.reduce(
      (total: number, status: { projectCount: number }) =>
        total + status.projectCount,
      0,
    ),
    readOnly: false,
    customStatusesSupported: true,
    canManage: true,
  });
}

export type ProjectStatusSettingsStatus = ReturnType<
  typeof readProjectStatusSettings
>[number] & {
  projectCount: number;
};
