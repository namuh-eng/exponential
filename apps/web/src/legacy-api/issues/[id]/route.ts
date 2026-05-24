import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  comment,
  commentAttachment,
  cycle,
  issue,
  issueDiscussionSummary,
  issueLabel,
  issueReaction,
  issueRelation,
  label,
  member,
  project,
  projectMilestone,
  reaction,
  team,
  user,
  workflowState,
} from "@/lib/db/schema";
import {
  type DiscussionSummaryStatus,
  buildDiscussionSummaryState,
} from "@/lib/discussion-summary";
import {
  createHeadlessIssuesClient,
  headlessIssuesEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { normalizeIssueDescriptionHtml } from "@/lib/issue-description";
import { insertIssueHistoryEvent } from "@/lib/issue-history";
import { getIssueSubscriptionSummary } from "@/lib/issue-subscriptions";
import {
  buildNotificationValues,
  insertNotifications,
} from "@/lib/notifications";
import { getDownloadUrl } from "@/lib/s3";
import { readTeamSettings } from "@/lib/team-settings";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function findIssueRecord(id: string, workspaceId: string) {
  const issues = await db
    .select({
      id: issue.id,
      number: issue.number,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      stateId: issue.stateId,
      assigneeId: issue.assigneeId,
      creatorId: issue.creatorId,
      projectId: issue.projectId,
      projectMilestoneId: issue.projectMilestoneId,
      parentIssueId: issue.parentIssueId,
      cycleId: issue.cycleId,
      dueDate: issue.dueDate,
      estimate: issue.estimate,
      sortOrder: issue.sortOrder,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      teamId: issue.teamId,
      workspaceId: team.workspaceId,
      teamSettings: team.settings,
      archivedAt: issue.archivedAt,
      canceledAt: issue.canceledAt,
      completedAt: issue.completedAt,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.identifier, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  if (issues.length > 0) {
    return issues[0];
  }

  if (!isUuidLike(id)) {
    return null;
  }

  const byId = await db
    .select({
      id: issue.id,
      number: issue.number,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      stateId: issue.stateId,
      assigneeId: issue.assigneeId,
      creatorId: issue.creatorId,
      projectId: issue.projectId,
      projectMilestoneId: issue.projectMilestoneId,
      parentIssueId: issue.parentIssueId,
      cycleId: issue.cycleId,
      dueDate: issue.dueDate,
      estimate: issue.estimate,
      sortOrder: issue.sortOrder,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      teamId: issue.teamId,
      workspaceId: team.workspaceId,
      teamSettings: team.settings,
      archivedAt: issue.archivedAt,
      canceledAt: issue.canceledAt,
      completedAt: issue.completedAt,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.id, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  return byId[0] ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const workspaceId = await resolveRequestWorkspaceId(
    session.user.id,
    _request,
  );
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  if (headlessIssuesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessIssuesClient(token);
    const { data, error, response } = await client.GET("/issues/{id}", {
      params: { path: { id } },
    });
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const iss = await findIssueRecord(id, workspaceId);
  if (!iss || iss.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  // Fetch related data in parallel
  const [
    stateRows,
    assigneeRows,
    creatorRows,
    teamRows,
    projectRows,
    labelRows,
    commentRows,
    subIssueRows,
    parentIssueRows,
    cycleRows,
    sourceRelationRows,
    targetRelationRows,
    issueReactionRows,
    subscriptionSummary,
    discussionSummaryRows,
  ] = await Promise.all([
    db.select().from(workflowState).where(eq(workflowState.id, iss.stateId)),
    iss.assigneeId
      ? db
          .select({ id: user.id, name: user.name, image: user.image })
          .from(user)
          .where(eq(user.id, iss.assigneeId))
      : Promise.resolve([]),
    db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(user)
      .where(eq(user.id, iss.creatorId)),
    db
      .select({ id: team.id, name: team.name, key: team.key })
      .from(team)
      .where(eq(team.id, iss.teamId)),
    iss.projectId
      ? db
          .select({ id: project.id, name: project.name, icon: project.icon })
          .from(project)
          .where(eq(project.id, iss.projectId))
      : Promise.resolve([]),
    db
      .select({
        labelId: label.id,
        labelName: label.name,
        labelColor: label.color,
      })
      .from(issueLabel)
      .innerJoin(label, eq(issueLabel.labelId, label.id))
      .where(eq(issueLabel.issueId, iss.id)),
    db
      .select({
        id: comment.id,
        body: comment.body,
        userId: comment.userId,
        userName: user.name,
        userImage: user.image,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      })
      .from(comment)
      .leftJoin(user, eq(comment.userId, user.id))
      .where(eq(comment.issueId, iss.id))
      .orderBy(asc(comment.createdAt)),
    db
      .select({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        priority: issue.priority,
        stateId: issue.stateId,
        stateName: workflowState.name,
        stateCategory: workflowState.category,
        stateColor: workflowState.color,
      })
      .from(issue)
      .leftJoin(workflowState, eq(issue.stateId, workflowState.id))
      .where(eq(issue.parentIssueId, iss.id))
      .orderBy(asc(issue.createdAt)),
    iss.parentIssueId
      ? db
          .select({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
          })
          .from(issue)
          .where(eq(issue.id, iss.parentIssueId))
      : Promise.resolve([]),
    iss.cycleId
      ? db
          .select({ id: cycle.id, name: cycle.name, number: cycle.number })
          .from(cycle)
          .where(eq(cycle.id, iss.cycleId))
      : Promise.resolve([]),
    db
      .select({
        id: issueRelation.id,
        type: issueRelation.type,
        relatedIssueId: issueRelation.relatedIssueId,
      })
      .from(issueRelation)
      .where(eq(issueRelation.issueId, iss.id)),
    db
      .select({
        id: issueRelation.id,
        type: issueRelation.type,
        issueId: issueRelation.issueId,
      })
      .from(issueRelation)
      .where(eq(issueRelation.relatedIssueId, iss.id)),
    db
      .select({
        emoji: issueReaction.emoji,
        userId: issueReaction.userId,
      })
      .from(issueReaction)
      .where(eq(issueReaction.issueId, iss.id)),
    getIssueSubscriptionSummary({
      issueId: iss.id,
      userId: session.user.id,
    }),
    db
      .select({
        status: issueDiscussionSummary.status,
        summary: issueDiscussionSummary.summary,
        generatedAt: issueDiscussionSummary.generatedAt,
        generatedBy: issueDiscussionSummary.generatedBy,
        sourceCommentCount: issueDiscussionSummary.sourceCommentCount,
        sourceCommentVersion: issueDiscussionSummary.sourceCommentVersion,
        error: issueDiscussionSummary.error,
        staleAt: issueDiscussionSummary.staleAt,
      })
      .from(issueDiscussionSummary)
      .where(eq(issueDiscussionSummary.issueId, iss.id))
      .limit(1),
  ]);

  const relatedIssueIds = [
    ...new Set([
      ...sourceRelationRows.map((relationRow) => relationRow.relatedIssueId),
      ...targetRelationRows.map((relationRow) => relationRow.issueId),
    ]),
  ];
  const relatedIssueRows =
    relatedIssueIds.length > 0
      ? await db
          .select({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
          })
          .from(issue)
          .where(inArray(issue.id, relatedIssueIds))
      : [];
  const relatedIssueById = new Map(
    relatedIssueRows.map((relatedIssue) => [relatedIssue.id, relatedIssue]),
  );

  const commentIds = commentRows.map((currentComment) => currentComment.id);
  const reactionRows =
    commentIds.length > 0
      ? await db
          .select({
            commentId: reaction.commentId,
            emoji: reaction.emoji,
            userId: reaction.userId,
          })
          .from(reaction)
          .where(inArray(reaction.commentId, commentIds))
      : [];
  const attachmentRows =
    commentIds.length > 0
      ? await db
          .select({
            id: commentAttachment.id,
            commentId: commentAttachment.commentId,
            fileName: commentAttachment.fileName,
            storageKey: commentAttachment.storageKey,
            contentType: commentAttachment.contentType,
            size: commentAttachment.size,
            createdAt: commentAttachment.createdAt,
          })
          .from(commentAttachment)
          .where(inArray(commentAttachment.commentId, commentIds))
          .orderBy(asc(commentAttachment.createdAt))
      : [];

  const issueReactionsByEmoji = new Map<
    string,
    { count: number; reactedByMe: boolean }
  >();
  const reactionsByComment = new Map<
    string,
    Map<string, { count: number; reacted: boolean }>
  >();
  const attachmentsByComment = new Map<
    string,
    {
      id: string;
      fileName: string;
      contentType: string;
      size: number;
      downloadUrl: string | null;
    }[]
  >();

  for (const currentReaction of issueReactionRows) {
    const existing = issueReactionsByEmoji.get(currentReaction.emoji) ?? {
      count: 0,
      reactedByMe: false,
    };

    issueReactionsByEmoji.set(currentReaction.emoji, {
      count: existing.count + 1,
      reactedByMe:
        existing.reactedByMe || currentReaction.userId === session.user.id,
    });
  }

  for (const currentReaction of reactionRows) {
    const byEmoji =
      reactionsByComment.get(currentReaction.commentId) ??
      new Map<string, { count: number; reacted: boolean }>();
    const existing = byEmoji.get(currentReaction.emoji) ?? {
      count: 0,
      reacted: false,
    };

    byEmoji.set(currentReaction.emoji, {
      count: existing.count + 1,
      reacted: existing.reacted || currentReaction.userId === session.user.id,
    });
    reactionsByComment.set(currentReaction.commentId, byEmoji);
  }

  await Promise.all(
    attachmentRows.map(async (currentAttachment) => {
      const attachments =
        attachmentsByComment.get(currentAttachment.commentId) ?? [];
      let downloadUrl: string | null = null;

      try {
        downloadUrl = await getDownloadUrl(currentAttachment.storageKey);
      } catch {
        downloadUrl = null;
      }

      attachments.push({
        id: currentAttachment.id,
        fileName: currentAttachment.fileName,
        contentType: currentAttachment.contentType,
        size: currentAttachment.size,
        downloadUrl,
      });
      attachmentsByComment.set(currentAttachment.commentId, attachments);
    }),
  );

  const discussionSummariesEnabled = readTeamSettings(
    iss.teamSettings,
  ).discussionSummariesEnabled;
  const state = stateRows[0];
  const assignee = assigneeRows[0] ?? null;
  const creator = creatorRows[0] ?? null;
  const teamData = teamRows[0];
  const projectData = projectRows[0] ?? null;
  const parentIssueData = parentIssueRows[0] ?? null;
  const cycleData = cycleRows[0] ?? null;
  const inverseRelationType = {
    blocks: "blocked_by",
    blocked_by: "blocks",
    duplicate: "duplicate",
    related: "related",
  } as const;
  const relationData = [
    ...sourceRelationRows.flatMap((relationRow) => {
      const relatedIssue = relatedIssueById.get(relationRow.relatedIssueId);
      return relatedIssue
        ? [
            {
              id: relationRow.id,
              type: relationRow.type,
              issue: relatedIssue,
            },
          ]
        : [];
    }),
    ...targetRelationRows.flatMap((relationRow) => {
      const relatedIssue = relatedIssueById.get(relationRow.issueId);
      return relatedIssue
        ? [
            {
              id: relationRow.id,
              type: inverseRelationType[relationRow.type],
              issue: relatedIssue,
            },
          ]
        : [];
    }),
  ];

  return NextResponse.json({
    id: iss.id,
    number: iss.number,
    identifier: iss.identifier,
    title: iss.title,
    description: iss.description,
    priority: iss.priority,
    estimate: iss.estimate,
    dueDate: iss.dueDate,
    createdAt: iss.createdAt,
    updatedAt: iss.updatedAt,
    state: state
      ? {
          id: state.id,
          name: state.name,
          category: state.category,
          color: state.color,
        }
      : null,
    assignee,
    creator,
    team: teamData,
    project: projectData,
    cycle: cycleData,
    parentIssue: parentIssueData,
    relations: relationData,
    labels: labelRows.map((l) => ({
      id: l.labelId,
      name: l.labelName,
      color: l.labelColor,
    })),
    subscription: subscriptionSummary,
    reactions: Array.from(issueReactionsByEmoji.entries()).map(
      ([emoji, data]) => ({
        emoji,
        count: data.count,
        reactedByMe: data.reactedByMe,
      }),
    ),
    discussionSummary: buildDiscussionSummaryState({
      enabled: discussionSummariesEnabled,
      comments: commentRows,
      persisted: discussionSummaryRows[0]
        ? {
            status: discussionSummaryRows[0].status as DiscussionSummaryStatus,
            summary: discussionSummaryRows[0].summary,
            generatedAt: discussionSummaryRows[0].generatedAt,
            generatedBy: discussionSummaryRows[0].generatedBy,
            sourceCommentCount: discussionSummaryRows[0].sourceCommentCount,
            sourceCommentVersion: discussionSummaryRows[0].sourceCommentVersion,
            error: discussionSummaryRows[0].error,
            staleAt: discussionSummaryRows[0].staleAt,
          }
        : null,
    }),
    comments: commentRows.map((c) => ({
      id: c.id,
      body: c.body,
      user: { name: c.userName ?? "Unknown user", image: c.userImage },
      createdAt: c.createdAt,
      ownedByMe: c.userId === session.user.id,
      canEdit: c.userId === session.user.id,
      canDelete: c.userId === session.user.id,
      reactions: Array.from(reactionsByComment.get(c.id)?.entries() ?? []).map(
        ([emoji, data]) => ({
          emoji,
          count: data.count,
          reacted: data.reacted,
        }),
      ),
      attachments: attachmentsByComment.get(c.id) ?? [],
    })),
    subIssues: subIssueRows.map((subIssue) => ({
      id: subIssue.id,
      identifier: subIssue.identifier,
      title: subIssue.title,
      priority: subIssue.priority,
      state: subIssue.stateId
        ? {
            id: subIssue.stateId,
            name: subIssue.stateName ?? "Unknown",
            category: subIssue.stateCategory ?? "backlog",
            color: subIssue.stateColor ?? "#6b6f76",
          }
        : null,
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  if (headlessIssuesEnabled()) {
    const body = await request.json().catch(() => null);
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessIssuesClient(token);
    const idempotencyKey = request.headers.get("idempotency-key");
    const { data, error, response } = await client.PATCH("/issues/{id}", {
      params: { path: { id } },
      body: body as never,
      headers: idempotencyKey
        ? { "Idempotency-Key": idempotencyKey }
        : undefined,
    } as never);
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const body = (await request.json()) as {
    title?: string;
    description?: string | null;
    stateId?: string;
    sortOrder?: number;
    archive?: boolean;
    priority?: "none" | "urgent" | "high" | "medium" | "low";
    assigneeId?: string | null;
    projectId?: string | null;
    parentIssueId?: string | null;
    cycleId?: string | null;
    dueDate?: string | null;
    estimate?: number | null;
    labelIds?: string[];
    projectMilestoneId?: string | null;
  };

  const existingIssue = await findIssueRecord(id, workspaceId);
  if (!existingIssue || existingIssue.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const updateData: Partial<typeof issue.$inferInsert> = {
    updatedAt: new Date(),
  };
  const changedFields: string[] = [];

  if (body.title !== undefined) {
    const nextTitle = body.title.trim();
    if (!nextTitle) {
      return NextResponse.json(
        { error: "Title cannot be empty" },
        { status: 400 },
      );
    }

    updateData.title = nextTitle;
    if (nextTitle !== existingIssue.title) {
      changedFields.push("title");
    }
  }

  if (body.description !== undefined) {
    const nextDescription = normalizeIssueDescriptionHtml(body.description);
    updateData.description = nextDescription;
    if (nextDescription !== existingIssue.description) {
      changedFields.push("description");
    }
  }

  if (body.stateId !== undefined) {
    const states = await db
      .select({
        id: workflowState.id,
        teamId: workflowState.teamId,
        category: workflowState.category,
      })
      .from(workflowState)
      .where(eq(workflowState.id, body.stateId))
      .limit(1);

    const nextState = states[0];
    if (!nextState || nextState.teamId !== existingIssue.teamId) {
      return NextResponse.json(
        { error: "Workflow state not found" },
        { status: 400 },
      );
    }

    updateData.stateId = nextState.id;
    if (nextState.id !== existingIssue.stateId) {
      changedFields.push("stateId");
    }
    updateData.completedAt =
      nextState.category === "completed" ? new Date() : null;
    updateData.canceledAt =
      nextState.category === "canceled" ? new Date() : null;

    if (
      body.sortOrder === undefined &&
      nextState.id !== existingIssue.stateId
    ) {
      const lastIssueInState = await db
        .select({ sortOrder: issue.sortOrder })
        .from(issue)
        .where(eq(issue.stateId, nextState.id))
        .orderBy(desc(issue.sortOrder), desc(issue.createdAt))
        .limit(1);

      updateData.sortOrder = (lastIssueInState[0]?.sortOrder ?? -1) + 1;
    }
  }

  if (body.priority !== undefined) {
    const priorities = new Set(["none", "urgent", "high", "medium", "low"]);
    if (!priorities.has(body.priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }
    updateData.priority = body.priority;
    if (body.priority !== existingIssue.priority) {
      changedFields.push("priority");
    }
  }

  if (body.assigneeId !== undefined) {
    if (body.assigneeId) {
      const [assigneeMember] = await db
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.workspaceId, workspaceId),
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
    if (body.assigneeId !== existingIssue.assigneeId) {
      changedFields.push("assigneeId");
    }
  }

  if (body.projectId !== undefined) {
    if (body.projectId) {
      const [projectRecord] = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(
            eq(project.id, body.projectId),
            eq(project.workspaceId, workspaceId),
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
    if (body.projectId !== existingIssue.projectId) {
      changedFields.push("projectId");
    }
  }

  if (body.cycleId !== undefined) {
    if (body.cycleId) {
      const [cycleRecord] = await db
        .select({ id: cycle.id, teamId: cycle.teamId })
        .from(cycle)
        .where(eq(cycle.id, body.cycleId))
        .limit(1);
      if (!cycleRecord || cycleRecord.teamId !== existingIssue.teamId) {
        return NextResponse.json({ error: "Cycle not found" }, { status: 400 });
      }
    }
    updateData.cycleId = body.cycleId;
    if (body.cycleId !== existingIssue.cycleId) {
      changedFields.push("cycleId");
    }
  }

  if (body.parentIssueId !== undefined) {
    if (body.parentIssueId) {
      if (body.parentIssueId === existingIssue.id) {
        return NextResponse.json(
          { error: "Issue cannot be its own parent" },
          { status: 400 },
        );
      }
      const [parentRecord] = await db
        .select({ id: issue.id, teamId: issue.teamId })
        .from(issue)
        .innerJoin(team, eq(issue.teamId, team.id))
        .where(
          and(
            eq(issue.id, body.parentIssueId),
            eq(team.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!parentRecord) {
        return NextResponse.json(
          { error: "Parent issue not found" },
          { status: 400 },
        );
      }
    }
    updateData.parentIssueId = body.parentIssueId;
    if (body.parentIssueId !== existingIssue.parentIssueId) {
      changedFields.push("parentIssueId");
    }
  }

  if (body.dueDate !== undefined) {
    const nextDueDate = body.dueDate
      ? new Date(`${body.dueDate}T00:00:00`)
      : null;
    if (nextDueDate && Number.isNaN(nextDueDate.getTime())) {
      return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
    }
    updateData.dueDate = nextDueDate;
    const currentDueDate = existingIssue.dueDate
      ? existingIssue.dueDate.toISOString().slice(0, 10)
      : null;
    if ((body.dueDate || null) !== currentDueDate) {
      changedFields.push("dueDate");
    }
  }

  if (body.estimate !== undefined) {
    if (
      body.estimate !== null &&
      (!Number.isFinite(body.estimate) || body.estimate < 0)
    ) {
      return NextResponse.json({ error: "Invalid estimate" }, { status: 400 });
    }
    updateData.estimate = body.estimate;
    if (body.estimate !== existingIssue.estimate) {
      changedFields.push("estimate");
    }
  }

  if (body.projectMilestoneId !== undefined) {
    const nextProjectId =
      body.projectId !== undefined ? body.projectId : existingIssue.projectId;

    if (body.projectMilestoneId) {
      if (!nextProjectId) {
        return NextResponse.json(
          {
            error:
              "Issue must be assigned to a project before selecting a milestone",
          },
          { status: 400 },
        );
      }

      const milestoneRows = await db
        .select({ id: projectMilestone.id })
        .from(projectMilestone)
        .innerJoin(project, eq(projectMilestone.projectId, project.id))
        .where(
          and(
            eq(projectMilestone.id, body.projectMilestoneId),
            eq(projectMilestone.projectId, nextProjectId),
            eq(project.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      if (!milestoneRows[0]) {
        return NextResponse.json(
          { error: "Project milestone not found" },
          { status: 400 },
        );
      }
    }

    updateData.projectMilestoneId = body.projectMilestoneId;
    if (body.projectMilestoneId !== existingIssue.projectMilestoneId) {
      changedFields.push("projectMilestoneId");
    }
  } else if (
    body.projectId !== undefined &&
    body.projectId !== existingIssue.projectId &&
    existingIssue.projectMilestoneId
  ) {
    updateData.projectMilestoneId = null;
    changedFields.push("projectMilestoneId");
  }

  let normalizedLabelIds: string[] | undefined;
  if (body.labelIds !== undefined) {
    normalizedLabelIds = [
      ...new Set(
        body.labelIds.filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        ),
      ),
    ];
    if (normalizedLabelIds.length > 0) {
      const labelRows = await db
        .select({ id: label.id })
        .from(label)
        .where(
          and(
            inArray(label.id, normalizedLabelIds),
            eq(label.workspaceId, workspaceId),
            or(isNull(label.teamId), eq(label.teamId, existingIssue.teamId)),
            isNull(label.archivedAt),
          ),
        );
      if (labelRows.length !== normalizedLabelIds.length) {
        return NextResponse.json({ error: "Label not found" }, { status: 400 });
      }
    }
    changedFields.push("labelIds");
  }

  if (body.archive !== undefined) {
    updateData.archivedAt = body.archive ? new Date() : null;
    if (Boolean(existingIssue.archivedAt) !== body.archive) {
      changedFields.push("archivedAt");
    }
  }

  if (body.sortOrder !== undefined) {
    updateData.sortOrder = body.sortOrder;
    if (body.sortOrder !== existingIssue.sortOrder) {
      changedFields.push("sortOrder");
    }
  }

  const updated = await db
    .update(issue)
    .set(updateData)
    .where(eq(issue.id, existingIssue.id))
    .returning({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      updatedAt: issue.updatedAt,
      stateId: issue.stateId,
      sortOrder: issue.sortOrder,
      archivedAt: issue.archivedAt,
      priority: issue.priority,
      assigneeId: issue.assigneeId,
      projectId: issue.projectId,
      projectMilestoneId: issue.projectMilestoneId,
      parentIssueId: issue.parentIssueId,
      cycleId: issue.cycleId,
      dueDate: issue.dueDate,
      estimate: issue.estimate,
    });

  if (normalizedLabelIds !== undefined) {
    await db.delete(issueLabel).where(eq(issueLabel.issueId, existingIssue.id));
    if (normalizedLabelIds.length > 0) {
      await db.insert(issueLabel).values(
        normalizedLabelIds.map((labelId) => ({
          issueId: existingIssue.id,
          labelId,
        })),
      );
    }
  }

  if (updated[0] && changedFields.length > 0) {
    await insertIssueHistoryEvent(
      db,
      { settings: existingIssue.teamSettings },
      {
        issueId: existingIssue.id,
        actorId: session.user.id,
        actorName: session.user.name ?? null,
        actorEmail: session.user.email ?? null,
        eventType: "updated",
        metadata: {
          changedFields,
          identifier: existingIssue.identifier,
        },
      },
    );
  }

  if (
    body.stateId !== undefined &&
    body.stateId !== existingIssue.stateId &&
    updated[0]
  ) {
    await insertNotifications(
      buildNotificationValues({
        type: "status_change",
        actorId: session.user.id,
        issueId: existingIssue.id,
        userIds: [existingIssue.assigneeId, existingIssue.creatorId],
      }),
    );
  }

  return NextResponse.json(updated[0]);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const workspaceId = await resolveRequestWorkspaceId(
    session.user.id,
    _request,
  );
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  if (headlessIssuesEnabled()) {
    const token = await mintInternalApiToken({
      userId: session.user.id,
      workspaceId,
    });
    const client = createHeadlessIssuesClient(token);
    const idempotencyKey = _request.headers.get("idempotency-key");
    const { data, error, response } = await client.DELETE("/issues/{id}", {
      params: { path: { id } },
      headers: idempotencyKey
        ? { "Idempotency-Key": idempotencyKey }
        : undefined,
    } as never);
    if (error) {
      return NextResponse.json(error, {
        status: (response as Response).status,
      });
    }
    return NextResponse.json(data, { status: (response as Response).status });
  }

  const existingIssue = await findIssueRecord(id, workspaceId);
  if (!existingIssue || existingIssue.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  // Delete the issue. Labels and comments should be handled by DB-level cascade if configured,
  // but we can also handle them explicitly here if needed.
  // Assuming cascade is set up in schema.
  await db.delete(issue).where(eq(issue.id, existingIssue.id));

  return NextResponse.json({ success: true });
}
