import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  comment,
  commentAttachment,
  issue,
  issueHistory,
  team,
} from "@/lib/db/schema";
import {
  buildNotificationValues,
  insertNotifications,
  resolveMentionedUserIds,
} from "@/lib/notifications";
import { buildKey, deleteFile, getDownloadUrl, uploadFile } from "@/lib/s3";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

async function findIssueRecord(id: string) {
  const issues = await db
    .select({
      id: issue.id,
      workspaceId: team.workspaceId,
      assigneeId: issue.assigneeId,
      creatorId: issue.creatorId,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(eq(issue.identifier, id))
    .limit(1);

  if (issues.length > 0) {
    return issues[0];
  }

  const byId = await db
    .select({
      id: issue.id,
      workspaceId: team.workspaceId,
      assigneeId: issue.assigneeId,
      creatorId: issue.creatorId,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(eq(issue.id, id))
    .limit(1);

  return byId[0] ?? null;
}

function sanitizeFilename(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "-");
}

function isFileLike(value: FormDataEntryValue): value is File {
  return value instanceof File;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const currentIssue = await findIssueRecord(id);
  if (!currentIssue || currentIssue.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let nextBody = "";
  let attachments: File[] = [];

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    nextBody = formData.get("body")?.toString().trim() ?? "";
    attachments = formData.getAll("attachments").filter(isFileLike);
  } else {
    const body = (await request.json()) as { body?: string };
    nextBody = body.body?.trim() ?? "";
  }

  if (!nextBody && attachments.length === 0) {
    return NextResponse.json(
      { error: "Comment body or attachments are required" },
      { status: 400 },
    );
  }

  const MAX_ATTACHMENTS = 5;
  const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

  if (attachments.length > MAX_ATTACHMENTS) {
    return NextResponse.json(
      { error: "You can attach up to 5 files per comment" },
      { status: 400 },
    );
  }

  for (const currentAttachment of attachments) {
    if (currentAttachment.size > MAX_ATTACHMENT_SIZE) {
      return NextResponse.json(
        { error: `${currentAttachment.name} exceeds the 10 MB limit` },
        { status: 400 },
      );
    }
  }

  const commentId = crypto.randomUUID();
  const uploadedKeys: string[] = [];
  const mentionedUserIds = await resolveMentionedUserIds({
    workspaceId: currentIssue.workspaceId,
    body: nextBody,
  });

  try {
    const attachmentRows = await Promise.all(
      attachments.map(async (currentAttachment) => {
        const storageKey = buildKey(
          "attachment",
          currentIssue.workspaceId,
          sanitizeFilename(currentAttachment.name),
        );
        const contentTypeValue =
          currentAttachment.type || "application/octet-stream";

        await uploadFile(
          storageKey,
          Buffer.from(await currentAttachment.arrayBuffer()),
          contentTypeValue,
        );
        uploadedKeys.push(storageKey);

        return {
          id: crypto.randomUUID(),
          commentId,
          fileName: currentAttachment.name,
          storageKey,
          contentType: contentTypeValue,
          size: currentAttachment.size,
        };
      }),
    );

    const createdComments = await db.transaction(async (tx) => {
      const insertedComment = await tx
        .insert(comment)
        .values({
          id: commentId,
          body: nextBody,
          issueId: currentIssue.id,
          userId: session.user.id,
        })
        .returning({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
        });

      if (attachmentRows.length > 0) {
        await tx.insert(commentAttachment).values(attachmentRows);
      }

      await tx.insert(issueHistory).values({
        issueId: currentIssue.id,
        actorId: session.user.id,
        actorName: session.user.name ?? null,
        actorEmail: session.user.email ?? null,
        eventType: "comment_created",
        metadata: {
          commentId,
          attachmentCount: attachmentRows.length,
        },
      });

      return insertedComment[0];
    });

    const responseAttachments = await Promise.all(
      attachmentRows.map(async (currentAttachment) => ({
        id: currentAttachment.id,
        fileName: currentAttachment.fileName,
        contentType: currentAttachment.contentType,
        size: currentAttachment.size,
        downloadUrl: await getDownloadUrl(currentAttachment.storageKey),
      })),
    );

    const mentionedSet = new Set(mentionedUserIds);
    const genericRecipients = [
      currentIssue.assigneeId,
      currentIssue.creatorId,
    ].filter((userId): userId is string => {
      if (!userId) {
        return false;
      }

      return !mentionedSet.has(userId);
    });

    await insertNotifications([
      ...buildNotificationValues({
        type: "mentioned",
        actorId: session.user.id,
        issueId: currentIssue.id,
        userIds: mentionedUserIds,
      }),
      ...buildNotificationValues({
        type: "comment",
        actorId: session.user.id,
        issueId: currentIssue.id,
        userIds: genericRecipients,
      }),
    ]);

    return NextResponse.json({
      id: createdComments.id,
      body: createdComments.body,
      createdAt: createdComments.createdAt,
      user: {
        name: session.user.name,
        image: session.user.image ?? null,
      },
      reactions: [],
      attachments: responseAttachments,
    });
  } catch (error) {
    await Promise.all(
      uploadedKeys.map(async (storageKey) => {
        try {
          await deleteFile(storageKey);
        } catch {
          return null;
        }

        return null;
      }),
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create comment",
      },
      { status: 500 },
    );
  }
}
