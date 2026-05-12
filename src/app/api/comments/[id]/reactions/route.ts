import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { comment, reaction } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function summarizeReactions(
  reactionRows: { emoji: string; userId: string }[],
  currentUserId: string,
) {
  const grouped = new Map<string, { count: number; reacted: boolean }>();

  for (const currentReaction of reactionRows) {
    const existing = grouped.get(currentReaction.emoji) ?? {
      count: 0,
      reacted: false,
    };

    grouped.set(currentReaction.emoji, {
      count: existing.count + 1,
      reacted: existing.reacted || currentReaction.userId === currentUserId,
    });
  }

  return Array.from(grouped.entries()).map(([emoji, data]) => ({
    emoji,
    count: data.count,
    reacted: data.reacted,
  }));
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
  const body = (await request.json()) as { emoji?: string };
  const emoji = body.emoji?.trim();

  if (!emoji) {
    return NextResponse.json({ error: "Emoji is required" }, { status: 400 });
  }

  const comments = await db
    .select({ id: comment.id })
    .from(comment)
    .where(eq(comment.id, id))
    .limit(1);

  if (comments.length === 0) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const existingReactions = await db
    .select({ id: reaction.id })
    .from(reaction)
    .where(
      and(
        eq(reaction.commentId, id),
        eq(reaction.userId, session.user.id),
        eq(reaction.emoji, emoji),
      ),
    )
    .limit(1);

  if (existingReactions.length > 0) {
    await db.delete(reaction).where(eq(reaction.id, existingReactions[0].id));
  } else {
    await db.insert(reaction).values({
      commentId: id,
      userId: session.user.id,
      emoji,
    });
  }

  const nextReactions = await db
    .select({ emoji: reaction.emoji, userId: reaction.userId })
    .from(reaction)
    .where(eq(reaction.commentId, id));

  return NextResponse.json(summarizeReactions(nextReactions, session.user.id));
}
