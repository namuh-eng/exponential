import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { comment, commentAttachment } from "@/lib/db/schema";
import { markIssueDiscussionSummaryStale } from "@/lib/discussion-summary-store";
import {
  createHeadlessCommentsClient,
  headlessCommentsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { deleteFile } from "@/lib/s3";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const { id } = await params;
  const body = await request.json();

  if (headlessCommentsEnabled()) {
    const workspaceId = await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessCommentsClient(token);
      const { data, error, response } = await client.PATCH("/comments/{id}", {
        params: { path: { id } },
        body: body as never,
      });
      if (error)
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const nextBody = typeof body.body === "string" ? body.body.trim() : "";

  if (!nextBody) {
    return NextResponse.json(
      { error: "Comment body is required" },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(comment)
    .set({ body: nextBody, updatedAt: new Date() })
    .where(and(eq(comment.id, id), eq(comment.userId, session.user.id)))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: "Comment not found or unauthorized" },
      { status: 404 },
    );
  }

  await markIssueDiscussionSummaryStale(updated.issueId);

  return NextResponse.json(updated);
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

  if (headlessCommentsEnabled()) {
    const workspaceId = await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessCommentsClient(token);
      const { data, error, response } = await client.DELETE("/comments/{id}", {
        params: { path: { id } },
      });
      if (error)
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  // Find comment to check ownership and get attachments
  const [existingComment] = await db
    .select()
    .from(comment)
    .where(and(eq(comment.id, id), eq(comment.userId, session.user.id)))
    .limit(1);

  if (!existingComment) {
    return NextResponse.json(
      { error: "Comment not found or unauthorized" },
      { status: 404 },
    );
  }

  // Get attachments to delete from S3
  const attachments = await db
    .select({ storageKey: commentAttachment.storageKey })
    .from(commentAttachment)
    .where(eq(commentAttachment.commentId, id));

  await db.transaction(async (tx) => {
    // Delete attachments from DB
    await tx
      .delete(commentAttachment)
      .where(eq(commentAttachment.commentId, id));
    // Delete comment
    await tx.delete(comment).where(eq(comment.id, id));
    await markIssueDiscussionSummaryStale(existingComment.issueId);
  });

  // Delete files from S3
  await Promise.all(
    attachments.map(async (currentAttachment) => {
      try {
        await deleteFile(currentAttachment.storageKey);
      } catch {
        // Ignore S3 deletion errors
      }
    }),
  );

  return NextResponse.json({ success: true });
}
