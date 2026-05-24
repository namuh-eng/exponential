import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, member, team, workflowState, workspace } from "@/lib/db/schema";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import { isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

type Mapping = {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
};
type ImportJob = {
  id: string;
  provider: "csv";
  status: "complete" | "failed";
  createdAt: string;
  completedAt: string;
  fileName?: string;
  importedCount: number;
  errorCount: number;
  errors: Array<{ row: number; message: string }>;
};
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function importJobs(settings: unknown): ImportJob[] {
  const value = asRecord(asRecord(settings).importExport).imports;
  return Array.isArray(value) ? (value as ImportJob[]) : [];
}
function parseCsv(text: string) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = (lines.shift() ?? "")
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.map((line, index) => {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    return {
      row: index + 2,
      get: (name?: string) => {
        const idx = headers.indexOf(name ?? "");
        return idx >= 0 ? (cols[idx] ?? "") : "";
      },
    };
  });
}
function priority(value: string) {
  const normalized = value.toLowerCase();
  return ["urgent", "high", "medium", "low", "none"].includes(normalized)
    ? normalized
    : "none";
}
async function current(userId: string) {
  const workspaceId = await resolveActiveWorkspaceId(userId);
  if (!workspaceId) return null;
  const [row] = await db
    .select({
      id: workspace.id,
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
export async function GET() {
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
  const teams = await db
    .select({ id: team.id, name: team.name, key: team.key })
    .from(team)
    .where(eq(team.workspaceId, ws.id));
  const states = teams.length
    ? await db
        .select({
          id: workflowState.id,
          name: workflowState.name,
          category: workflowState.category,
          teamId: workflowState.teamId,
        })
        .from(workflowState)
        .where(
          inArray(
            workflowState.teamId,
            teams.map((t) => t.id),
          ),
        )
    : [];
  return NextResponse.json({
    imports: importJobs(ws.settings),
    teams: teams.map((t) => ({
      ...t,
      states: states.filter((s) => s.teamId === t.id),
    })),
  });
}
export async function POST(request: Request) {
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
  const body = await request.json();
  const mapping = asRecord(body.mapping) as Mapping;
  const rows = parseCsv(String(body.csv ?? ""));
  const teamId = String(body.teamId ?? "");
  const [teamRow] = await db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.workspaceId, ws.id)))
    .limit(1);
  if (!teamRow)
    return NextResponse.json(
      { error: "Choose a valid target team." },
      { status: 400 },
    );
  const states = await db
    .select()
    .from(workflowState)
    .where(eq(workflowState.teamId, teamId));
  const defaultState =
    states.find((s) => s.category === "backlog") ?? states[0];
  if (!defaultState)
    return NextResponse.json(
      { error: "Target team has no workflow states." },
      { status: 400 },
    );
  const errors = rows.flatMap((row) => {
    const rowErrors = [];
    if (!row.get(mapping.title).trim()) rowErrors.push("Title is required");
    if (
      mapping.status &&
      row.get(mapping.status) &&
      !states.some(
        (s) => s.name.toLowerCase() === row.get(mapping.status).toLowerCase(),
      )
    )
      rowErrors.push(`Unknown status: ${row.get(mapping.status)}`);
    return rowErrors.map((message) => ({ row: row.row, message }));
  });
  if (errors.length)
    return NextResponse.json(
      { error: "Fix CSV validation errors before importing.", preview: errors },
      { status: 400 },
    );
  let nextNumber =
    Number(
      (
        await db
          .select({ maxNum: sql<number>`COALESCE(MAX(${issue.number}), 0)` })
          .from(issue)
          .where(eq(issue.teamId, teamId))
      )[0]?.maxNum ?? 0,
    ) + 1;
  const created = await db.transaction(async (tx) => {
    const inserted = [];
    for (const row of rows) {
      const state =
        states.find(
          (s) => s.name.toLowerCase() === row.get(mapping.status).toLowerCase(),
        ) ?? defaultState;
      const identifier = `${teamRow.key}-${nextNumber}`;
      const [createdIssue] = await tx
        .insert(issue)
        .values({
          number: nextNumber,
          identifier,
          title: row.get(mapping.title).trim(),
          description: row.get(mapping.description).trim() || null,
          priority: priority(row.get(mapping.priority)) as "none",
          teamId,
          stateId: state.id,
          creatorId: session.user.id,
        })
        .returning();
      await insertIssueHistoryEvent(tx, teamRow, {
        issueId: createdIssue.id,
        actorId: session.user.id,
        actorName: session.user.name ?? null,
        actorEmail: session.user.email ?? null,
        eventType: "created",
        metadata: { identifier, source: "csv-import" },
      });
      inserted.push(createdIssue);
      nextNumber += 1;
    }
    return inserted;
  });
  const now = new Date().toISOString();
  const job: ImportJob = {
    id: crypto.randomUUID(),
    provider: "csv",
    status: "complete",
    createdAt: now,
    completedAt: now,
    fileName: typeof body.fileName === "string" ? body.fileName : "import.csv",
    importedCount: created.length,
    errorCount: 0,
    errors: [],
  };
  const settings = asRecord(ws.settings);
  await db
    .update(workspace)
    .set({
      settings: {
        ...settings,
        importExport: {
          ...asRecord(settings.importExport),
          imports: [job, ...importJobs(settings)].slice(0, 10),
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, ws.id));
  return NextResponse.json({ import: job });
}
