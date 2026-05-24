import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, workflowState } from "@/lib/db/schema";
import {
  createHeadlessTeamsClient,
  headlessTeamsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import { readTeamSettings } from "@/lib/team-settings";
import { findAccessibleTeam } from "@/lib/teams";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

const ACCEPT_DESTINATION_CATEGORIES = new Set([
  "backlog",
  "unstarted",
  "started",
  "completed",
]);

type TriageAction = "accept" | "decline";

interface BulkTriageDecisionBody {
  action?: TriageAction;
  issueIds?: unknown;
  destinationStateId?: string;
  confirmed?: boolean;
  reason?: string;
}

function uniqueStrings(values: unknown): string[] {
  return Array.isArray(values)
    ? [
        ...new Set(
          values.filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          ),
        ),
      ]
    : [];
}

async function readBody(request: Request) {
  try {
    return (await request.json()) as BulkTriageDecisionBody;
  } catch {
    return {};
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response, session } = await requireApiSession();
  if (response) {
    return response;
  }

  const { key } = await params;
  const body = await readBody(request);
  const issueIds = uniqueStrings(body.issueIds);

  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  if (headlessTeamsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const client = createHeadlessTeamsClient(token);
    const { data, error, response } = await client.PATCH(
      "/teams/{key}/triage/bulk",
      {
        params: { path: { key } },
        body: body as never,
      },
    );
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  if (body.action !== "accept" && body.action !== "decline") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (issueIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one issue" },
      { status: 400 },
    );
  }
  if (issueIds.length > 100) {
    return NextResponse.json(
      { error: "Bulk triage decisions are limited to 100 issues" },
      { status: 400 },
    );
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

  const existingIssues = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      teamId: issue.teamId,
      stateId: issue.stateId,
      stateCategory: workflowState.category,
    })
    .from(issue)
    .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
    .where(and(inArray(issue.id, issueIds), eq(issue.teamId, teamRecord.id)));

  const foundById = new Map(
    existingIssues.map((record) => [record.id, record]),
  );
  const now = new Date();
  const results = [];

  for (const issueId of issueIds) {
    const existingIssue = foundById.get(issueId);
    if (!existingIssue) {
      results.push({ issueId, status: "not_found", error: "Issue not found" });
      continue;
    }

    if (existingIssue.stateCategory !== "triage") {
      results.push({
        issueId,
        identifier: existingIssue.identifier,
        status: "conflict",
        error: "Issue is not currently in triage",
      });
      continue;
    }

    const updated = await db
      .update(issue)
      .set({
        stateId: destinationState.id,
        canceledAt: body.action === "decline" ? now : null,
        completedAt: destinationState.category === "completed" ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(issue.id, existingIssue.id),
          eq(issue.teamId, teamRecord.id),
          eq(issue.stateId, existingIssue.stateId),
        ),
      )
      .returning({ id: issue.id });

    if (updated.length === 0) {
      results.push({
        issueId,
        identifier: existingIssue.identifier,
        status: "conflict",
        error: "Issue left triage before the decision completed",
      });
      continue;
    }

    await insertIssueHistoryEvent(
      db,
      { settings: teamRecord.settings },
      {
        issueId: existingIssue.id,
        actorId: session.user.id,
        actorName: session.user.name ?? null,
        actorEmail: session.user.email ?? null,
        eventType: "updated",
        metadata: {
          changedFields: ["stateId"],
          identifier: existingIssue.identifier,
          bulk: true,
          triageDecision: body.action,
        },
      },
    );

    results.push({
      issueId,
      identifier: existingIssue.identifier,
      status: "updated",
    });
  }

  const updatedCount = results.filter(
    (result) => result.status === "updated",
  ).length;
  const conflictCount = results.length - updatedCount;

  return NextResponse.json(
    {
      updatedCount,
      conflictCount,
      results,
      decision: {
        action: body.action,
        destinationState: {
          id: destinationState.id,
          name: destinationState.name,
          category: destinationState.category,
        },
        reason: body.reason?.trim() || null,
      },
    },
    { status: conflictCount > 0 ? 207 : 200 },
  );
}
