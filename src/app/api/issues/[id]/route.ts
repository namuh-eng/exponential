import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  comment,
  commentAttachment,
  cycle,
  issue,
  issueHistory,
  issueLabel,
  issueRelation,
  label,
  project,
  reaction,
  team,
  user,
  workflowState,
} from "@/lib/db/schema";
import { normalizeIssueDescriptionHtml } from "@/lib/issue-description";
import {
  buildNotificationValues,
  insertNotifications,
} from "@/lib/notifications";
import { getDownloadUrl } from "@/lib/s3";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
      parentIssueId: issue.parentIssueId,
      cycleId: issue.cycleId,
      dueDate: issue.dueDate,
      estimate: issue.estimate,
      sortOrder: issue.sortOrder,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      teamId: issue.teamId,
      workspaceId: team.workspaceId,
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
      parentIssueId: issue.parentIssueId,
      cycleId: issue.cycleId,
      dueDate: issue.dueDate,
      estimate: issue.estimate,
      sortOrder: issue.sortOrder,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      teamId: issue.teamId,
      workspaceId: team.workspaceId,
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
      .select({ labelName: label.name, labelColor: label.color })
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
    labels: labelRows.map((l) => ({ name: l.labelName, color: l.labelColor })),
    comments: commentRows.map((c) => ({
      id: c.id,
      body: c.body,
      user: { name: c.userName ?? "Unknown user", image: c.userImage },
      createdAt: c.createdAt,
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

  const body = (await request.json()) as {
    title?: string;
    description?: string | null;
    stateId?: string;
    sortOrder?: number;
    archive?: boolean;
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
    });

  if (updated[0] && changedFields.length > 0) {
    await db.insert(issueHistory).values({
      issueId: existingIssue.id,
      actorId: session.user.id,
      actorName: session.user.name ?? null,
      actorEmail: session.user.email ?? null,
      eventType: "updated",
      metadata: {
        changedFields,
        identifier: existingIssue.identifier,
      },
    });
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
