import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  issue,
  label,
  member,
  project,
  team,
  user,
  workflowState,
  workspace,
} from "@/lib/db/schema";
import { isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

type ExportJob = {
  id: string;
  status: "complete";
  createdAt: string;
  completedAt: string;
  artifact: unknown;
  counts: Record<string, number>;
};
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function jobs(settings: unknown): ExportJob[] {
  const value = asRecord(asRecord(settings).importExport).exports;
  return Array.isArray(value) ? (value as ExportJob[]) : [];
}
async function current(userId: string) {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) return null;
  const [row] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      urlSlug: workspace.urlSlug,
      settings: workspace.settings,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(eq(member.workspaceId, workspace.id), eq(member.userId, userId)),
    )
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  return row;
}
function publicJob(job: ExportJob) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    counts: job.counts,
    downloadUrl: `/api/workspaces/exports?id=${job.id}&download=1`,
  };
}
export async function GET(request: Request) {
  const { response, session } = await requireApiSession();
  if (response) return response;
  const ws = await current(session.user.id);
  if (!ws)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  if (!isWorkspaceAdminRole(ws.role))
    return NextResponse.json(
      { error: "Workspace admin access required" },
      { status: 403 },
    );
  const url = new URL(request.url);
  const all = jobs(ws.settings);
  const id = url.searchParams.get("id");
  if (id && url.searchParams.get("download")) {
    const job = all.find((item) => item.id === id);
    if (!job)
      return NextResponse.json({ error: "Export not found" }, { status: 404 });
    return new Response(JSON.stringify(job.artifact, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${ws.urlSlug}-export-${id}.json"`,
      },
    });
  }
  return NextResponse.json({ exports: all.map(publicJob) });
}
export async function POST() {
  const { response, session } = await requireApiSession();
  if (response) return response;
  const ws = await current(session.user.id);
  if (!ws)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  if (!isWorkspaceAdminRole(ws.role))
    return NextResponse.json(
      { error: "Workspace admin access required" },
      { status: 403 },
    );
  const teams = await db.select().from(team).where(eq(team.workspaceId, ws.id));
  const teamIds = teams.map((t) => t.id);
  const [states, labels, projects, members, users, issues] = await Promise.all([
    teamIds.length
      ? db
          .select()
          .from(workflowState)
          .where(inArray(workflowState.teamId, teamIds))
      : [],
    db.select().from(label).where(eq(label.workspaceId, ws.id)),
    db.select().from(project).where(eq(project.workspaceId, ws.id)),
    db.select().from(member).where(eq(member.workspaceId, ws.id)),
    db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .innerJoin(
        member,
        and(eq(member.userId, user.id), eq(member.workspaceId, ws.id)),
      ),
    teamIds.length
      ? db.select().from(issue).where(inArray(issue.teamId, teamIds))
      : [],
  ]);
  const now = new Date().toISOString();
  const artifact = {
    exportedAt: now,
    workspace: { id: ws.id, name: ws.name, urlSlug: ws.urlSlug },
    teams,
    workflowStates: states,
    labels,
    projects,
    members,
    users,
    issues,
  };
  const job: ExportJob = {
    id: crypto.randomUUID(),
    status: "complete",
    createdAt: now,
    completedAt: now,
    artifact,
    counts: {
      teams: teams.length,
      issues: issues.length,
      projects: projects.length,
      labels: labels.length,
      members: members.length,
    },
  };
  const settings = asRecord(ws.settings);
  await db
    .update(workspace)
    .set({
      settings: {
        ...settings,
        importExport: {
          ...asRecord(settings.importExport),
          exports: [job, ...jobs(settings)].slice(0, 10),
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, ws.id));
  return NextResponse.json({
    export: publicJob(job),
    exports: [publicJob(job), ...jobs(settings).map(publicJob)].slice(0, 10),
  });
}
