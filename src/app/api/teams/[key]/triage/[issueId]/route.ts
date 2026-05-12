import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, workflowState } from "@/lib/db/schema";
import { getTeamIdByKey } from "@/lib/teams";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

// Accept or decline a triage issue
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string; issueId: string }> },
) {
  const { response } = await requireApiSession();
  if (response) {
    return response;
  }

  const { key, issueId } = await params;
  const body = await request.json();
  const action = body.action as "accept" | "decline";

  const teamId = await getTeamIdByKey(key);
  if (!teamId) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  if (action === "accept") {
    // Move to first backlog state
    const backlogStates = await db
      .select({ id: workflowState.id })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.teamId, teamId),
          eq(workflowState.category, "backlog"),
        ),
      )
      .orderBy(asc(workflowState.position))
      .limit(1);

    if (backlogStates.length === 0) {
      return NextResponse.json(
        { error: "No backlog state found" },
        { status: 400 },
      );
    }

    const updated = await db
      .update(issue)
      .set({ stateId: backlogStates[0].id, updatedAt: new Date() })
      .where(eq(issue.id, issueId))
      .returning();

    return NextResponse.json(updated[0]);
  }

  if (action === "decline") {
    // Move to first canceled state
    const canceledStates = await db
      .select({ id: workflowState.id })
      .from(workflowState)
      .where(
        and(
          eq(workflowState.teamId, teamId),
          eq(workflowState.category, "canceled"),
        ),
      )
      .orderBy(asc(workflowState.position))
      .limit(1);

    if (canceledStates.length === 0) {
      return NextResponse.json(
        { error: "No canceled state found" },
        { status: 400 },
      );
    }

    const updated = await db
      .update(issue)
      .set({
        stateId: canceledStates[0].id,
        canceledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(issue.id, issueId))
      .returning();

    return NextResponse.json(updated[0]);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
