import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  comment,
  cycle,
  issue,
  issueLabel,
  issueSubscription,
  member,
  project,
  projectMilestone,
  team,
  workflowState,
} from "@/lib/db/schema";
import {
  createHeadlessTeamsClient,
  headlessTeamsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { normalizeApplicableIssueLabelIds } from "@/lib/label-application";
import { readTeamSettings } from "@/lib/team-settings";
import { findAccessibleTeam } from "@/lib/teams";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const PRIORITIES = new Set(["none", "urgent", "high", "medium", "low"]);

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
  priority?: string | null;
  estimate?: number | null;
  labelIds?: string[];
  cycleId?: string | null;
  projectId?: string | null;
  projectMilestoneId?: string | null;
  assigneeId?: string | null;
  comment?: string | null;
  subscribe?: boolean;
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

  if (headlessTeamsEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId: teamRecord.workspaceId,
    });
    const client = createHeadlessTeamsClient(token);
    const { data, error, response } = await client.PATCH(
      "/teams/{key}/triage/{issueID}",
      {
        params: { path: { key, issueID: issueId } },
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
      workspaceId: team.workspaceId,
    })
    .from(issue)
    .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
    .innerJoin(team, eq(issue.teamId, team.id))
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

  const updateData: Partial<typeof issue.$inferInsert> = {
    stateId: destinationState.id,
    canceledAt: body.action === "decline" ? new Date() : null,
    updatedAt: new Date(),
  };

  let normalizedLabelIds: string[] | undefined;
  if (body.action === "accept") {
    if (body.priority !== undefined) {
      const nextPriority = body.priority ?? "none";
      if (!PRIORITIES.has(nextPriority)) {
        return NextResponse.json(
          { error: "Invalid priority" },
          { status: 400 },
        );
      }
      updateData.priority = nextPriority as typeof issue.$inferInsert.priority;
    }

    if (body.estimate !== undefined) {
      if (
        body.estimate !== null &&
        (!Number.isFinite(body.estimate) || body.estimate < 0)
      ) {
        return NextResponse.json(
          { error: "Invalid estimate" },
          { status: 400 },
        );
      }
      updateData.estimate = body.estimate;
    }

    if (body.assigneeId !== undefined) {
      if (body.assigneeId) {
        const [assigneeMember] = await db
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.workspaceId, existingIssue.workspaceId),
              eq(member.userId, body.assigneeId),
            ),
          )
          .limit(1);
        if (!assigneeMember) {
          return NextResponse.json(
            { error: "Assignee is not a workspace member" },
            { status: 400 },
          );
        }
      }
      updateData.assigneeId = body.assigneeId;
    }

    if (body.projectId !== undefined) {
      if (body.projectId) {
        const [projectRecord] = await db
          .select({ id: project.id })
          .from(project)
          .where(
            and(
              eq(project.id, body.projectId),
              eq(project.workspaceId, existingIssue.workspaceId),
            ),
          )
          .limit(1);
        if (!projectRecord) {
          return NextResponse.json(
            { error: "Project not found" },
            { status: 400 },
          );
        }
      }
      updateData.projectId = body.projectId;
    }

    if (body.projectMilestoneId !== undefined) {
      if (body.projectMilestoneId) {
        const [milestoneRecord] = await db
          .select({
            id: projectMilestone.id,
            projectId: projectMilestone.projectId,
          })
          .from(projectMilestone)
          .innerJoin(project, eq(projectMilestone.projectId, project.id))
          .where(
            and(
              eq(projectMilestone.id, body.projectMilestoneId),
              eq(project.workspaceId, existingIssue.workspaceId),
            ),
          )
          .limit(1);
        if (
          !milestoneRecord ||
          (body.projectId && milestoneRecord.projectId !== body.projectId)
        ) {
          return NextResponse.json(
            { error: "Project milestone not found" },
            { status: 400 },
          );
        }
      }
      updateData.projectMilestoneId = body.projectMilestoneId;
    }

    if (body.cycleId !== undefined) {
      if (body.cycleId) {
        const [cycleRecord] = await db
          .select({ id: cycle.id })
          .from(cycle)
          .where(
            and(eq(cycle.id, body.cycleId), eq(cycle.teamId, teamRecord.id)),
          )
          .limit(1);
        if (!cycleRecord) {
          return NextResponse.json(
            { error: "Cycle not found for this team" },
            { status: 400 },
          );
        }
      }
      updateData.cycleId = body.cycleId;
    }

    if (body.labelIds !== undefined) {
      const normalizedLabels = await normalizeApplicableIssueLabelIds({
        db,
        labelIds: body.labelIds,
        workspaceId: existingIssue.workspaceId,
        teamId: teamRecord.id,
      });
      if (!normalizedLabels.ok) {
        return NextResponse.json(
          { error: normalizedLabels.error },
          { status: 400 },
        );
      }
      normalizedLabelIds = normalizedLabels.labelIds;
    }
  }

  const trimmedComment =
    body.action === "accept" ? body.comment?.trim() : undefined;
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(issue)
      .set(updateData)
      .where(
        and(
          eq(issue.id, issueId),
          eq(issue.teamId, teamRecord.id),
          eq(issue.stateId, existingIssue.stateId),
        ),
      )
      .returning();

    if (rows.length === 0) {
      return rows;
    }

    if (normalizedLabelIds !== undefined) {
      await tx.delete(issueLabel).where(eq(issueLabel.issueId, issueId));
      if (normalizedLabelIds.length > 0) {
        await tx
          .insert(issueLabel)
          .values(normalizedLabelIds.map((labelId) => ({ issueId, labelId })));
      }
    }

    if (trimmedComment) {
      await tx
        .insert(comment)
        .values({ body: trimmedComment, issueId, userId: session.user.id });
    }

    if (body.action === "accept" && body.subscribe !== undefined) {
      await tx
        .insert(issueSubscription)
        .values({
          issueId,
          userId: session.user.id,
          subscribed: body.subscribe,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [issueSubscription.issueId, issueSubscription.userId],
          set: { subscribed: body.subscribe, updatedAt: new Date() },
        });
    }

    return rows;
  });

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
