import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { project } from "@/lib/db/schema";
import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const PROJECT_STATUS_DEFINITIONS = [
  {
    value: "planned",
    dbValue: "planned",
    label: "Planned",
    description: "Projects that are proposed or scheduled but not active yet.",
  },
  {
    value: "in_progress",
    dbValue: "started",
    label: "In progress",
    description: "Projects that are actively being worked on.",
  },
  {
    value: "paused",
    dbValue: "paused",
    label: "Paused",
    description: "Projects that are temporarily on hold.",
  },
  {
    value: "completed",
    dbValue: "completed",
    label: "Completed",
    description: "Projects that have reached their intended outcome.",
  },
  {
    value: "canceled",
    dbValue: "canceled",
    label: "Canceled",
    description: "Projects that are no longer planned to continue.",
  },
] as const;

type ProjectStatusValue = (typeof PROJECT_STATUS_DEFINITIONS)[number]["value"];
type ProjectStatusDbValue =
  (typeof PROJECT_STATUS_DEFINITIONS)[number]["dbValue"];

function toStatusCounts(
  rows: { status: ProjectStatusDbValue; count: number | string }[],
) {
  const countsByDbValue = new Map<ProjectStatusDbValue, number>();

  for (const row of rows) {
    countsByDbValue.set(row.status, Number(row.count));
  }

  return PROJECT_STATUS_DEFINITIONS.map(
    ({ dbValue: _dbValue, ...definition }) => ({
      ...definition,
      projectCount: countsByDbValue.get(_dbValue) ?? 0,
    }),
  );
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  try {
    const workspaceId = await resolveActiveWorkspaceId(session.user.id);
    if (!workspaceId) {
      return NextResponse.json({
        statuses: PROJECT_STATUS_DEFINITIONS.map(
          ({ dbValue: _dbValue, ...definition }) => ({
            ...definition,
            projectCount: 0,
          }),
        ),
        totalProjects: 0,
        readOnly: true,
        customStatusesSupported: false,
      });
    }

    const rows = await db
      .select({ status: project.status, count: count() })
      .from(project)
      .where(eq(project.workspaceId, workspaceId))
      .groupBy(project.status);

    const statuses = toStatusCounts(rows);

    return NextResponse.json({
      statuses,
      totalProjects: statuses.reduce(
        (total: number, status: { projectCount: number }) =>
          total + status.projectCount,
        0,
      ),
      readOnly: true,
      customStatusesSupported: false,
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to load project statuses" },
      { status: 500 },
    );
  }
}

export type ProjectStatusSettingsStatus = {
  value: ProjectStatusValue;
  label: string;
  description: string;
  projectCount: number;
};
