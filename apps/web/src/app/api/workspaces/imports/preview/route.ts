import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { member, team, workflowState, workspace } from "@/lib/db/schema";
import { isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
export async function POST(request: Request) {
  const { response, session } = await requireApiSession();
  if (response) return response;
  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId)
    return NextResponse.json(
      { error: "No active workspace found" },
      { status: 404 },
    );
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.workspaceId, workspaceId),
        eq(member.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!isWorkspaceAdminRole(membership?.role))
    return NextResponse.json(
      { error: "Workspace admin access required" },
      { status: 403 },
    );
  const body = await request.json();
  const mapping = asRecord(body.mapping);
  if (typeof mapping.title !== "string" || !mapping.title)
    return NextResponse.json(
      { error: "Map a title column before previewing." },
      { status: 400 },
    );
  const teamId = String(body.teamId ?? "");
  const [teamRow] = await db
    .select()
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.workspaceId, workspaceId)))
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
  const rows = parseCsv(String(body.csv ?? ""));
  if (!rows.length)
    return NextResponse.json(
      { error: "CSV must include at least one issue row." },
      { status: 400 },
    );
  const preview = rows.slice(0, 100).map((row) => {
    const title = row.get(String(mapping.title));
    const status = row.get(
      typeof mapping.status === "string" ? mapping.status : "",
    );
    const errors: string[] = [];
    if (!title.trim()) errors.push("Title is required");
    if (
      status &&
      !states.some((s) => s.name.toLowerCase() === status.toLowerCase())
    )
      errors.push(`Unknown status: ${status}`);
    return {
      row: row.row,
      title,
      description: row.get(String(mapping.description ?? "")),
      priority: row.get(String(mapping.priority ?? "")),
      status,
      errors,
    };
  });
  return NextResponse.json({ preview });
}
