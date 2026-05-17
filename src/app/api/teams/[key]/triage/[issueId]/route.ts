import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, workflowState } from "@/lib/db/schema";
import { readTeamSettings } from "@/lib/team-settings";
import { findAccessibleTeam } from "@/lib/teams";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const ACCEPT_DESTINATION_CATEGORIES = new Set([
  "backlog",
  "unstarted",
  "started",
  "completed",
]);

type TriageAction = "accept" | "decline";

interface TriageDecisionBody {
  action?: TriageAction;
  destinationStateId?: string;
  confirmed?: boolean;
  reason?: string;
}

async function readDecisionBody(request: Request) {
  try {
    return (await request.json()) as TriageDecisionBody;
  } catch {
    return {};
  }
}

// Accept or decline a triage issue after an explicit guarded decision.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string; issueId: string }> },
) {
  const { response, session } = await requireApiSession();
  if (response) {
    return response;
  }

  const { key, issueId } = await params;
  const body = await readDecisionBody(request);

  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  if (body.action !== "accept" && body.action !== "decline") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const triageSettings = readTeamSettings(teamRecord.settings);
  const destinationStateId =
    body.destinationStateId ??
    (body.action === "accept"
      ? triageSettings.triageAcceptDestinationStateId
      : triageSettings.triageDeclineDestinationStateId);

  if (!destinationStateId) {
    return NextResponse.json(
      { error: "Destination status is required" },
      { status: 400 },
    );
  }

  if (body.confirmed !== true) {
    return NextResponse.json(
      { error: "Decision confirmation is required" },
      { status: 400 },
    );
  }

  const existingIssues = await db
    .select({
      id: issue.id,
      teamId: issue.teamId,
      stateId: issue.stateId,
      stateCategory: workflowState.category,
    })
    .from(issue)
    .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
    .where(and(eq(issue.id, issueId), eq(issue.teamId, teamRecord.id)))
    .limit(1);

  const existingIssue = existingIssues[0];
  if (!existingIssue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  if (existingIssue.stateCategory !== "triage") {
    return NextResponse.json(
      { error: "Issue is not currently in triage" },
      { status: 409 },
    );
  }

  const destinationStates = await db
    .select({
      id: workflowState.id,
      name: workflowState.name,
      category: workflowState.category,
      teamId: workflowState.teamId,
    })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.id, destinationStateId),
        eq(workflowState.teamId, teamRecord.id),
      ),
    )
    .limit(1);

  const destinationState = destinationStates[0];
  if (!destinationState) {
    return NextResponse.json(
      { error: "Destination status not found for this team" },
      { status: 400 },
    );
  }

  const destinationAllowed =
    body.action === "accept"
      ? ACCEPT_DESTINATION_CATEGORIES.has(destinationState.category)
      : destinationState.category === "canceled";

  if (!destinationAllowed) {
    return NextResponse.json(
      { error: "Destination status is not allowed for this triage decision" },
      { status: 400 },
    );
  }

  const now = new Date();
  const updated = await db
    .update(issue)
    .set({
      stateId: destinationState.id,
      canceledAt: body.action === "decline" ? now : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(issue.id, issueId),
        eq(issue.teamId, teamRecord.id),
        eq(issue.stateId, existingIssue.stateId),
      ),
    )
    .returning();

  if (updated.length === 0) {
    return NextResponse.json(
      { error: "Issue left triage before the decision completed" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    issue: updated[0],
    decision: {
      action: body.action,
      destinationState: {
        id: destinationState.id,
        name: destinationState.name,
        category: destinationState.category,
      },
      reason: body.reason?.trim() || null,
    },
  });
}
