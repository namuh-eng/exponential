import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, workflowState } from "@/lib/db/schema";
import { findAccessibleTeam } from "@/lib/teams";
import { asc, count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const CATEGORY_ORDER = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
] as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const teamRecord = await findAccessibleTeam(key, session.user.id);
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const states = await db
    .select({
      id: workflowState.id,
      name: workflowState.name,
      category: workflowState.category,
      color: workflowState.color,
      description: workflowState.description,
      position: workflowState.position,
      isDefault: workflowState.isDefault,
    })
    .from(workflowState)
    .where(eq(workflowState.teamId, teamRecord.id))
    .orderBy(asc(workflowState.position));

  // Count issues per status
  const issueCounts = await db
    .select({
      stateId: issue.stateId,
      count: count(),
    })
    .from(issue)
    .where(eq(issue.teamId, teamRecord.id))
    .groupBy(issue.stateId);

  const countMap = new Map(issueCounts.map((ic) => [ic.stateId, ic.count]));

  // Group by category
  const grouped: Record<
    string,
    Array<{
      id: string;
      name: string;
      issueCount: number;
      description: string | null;
      color: string;
      isDefault: boolean | null;
    }>
  > = {};

  for (const cat of CATEGORY_ORDER) {
    grouped[cat] = [];
  }

  for (const state of states) {
    const cat = state.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      id: state.id,
      name: state.name,
      issueCount: countMap.get(state.id) ?? 0,
      description: state.description,
      color: state.color,
      isDefault: state.isDefault,
    });
  }

  return NextResponse.json({ statuses: grouped });
}
