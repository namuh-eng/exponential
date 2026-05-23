import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, issueReaction, team } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function summarizeIssueReactions(
  reactionRows: { emoji: string; userId: string }[],
  currentUserId: string,
) {
  const grouped = new Map<string, { count: number; reactedByMe: boolean }>();

  for (const currentReaction of reactionRows) {
    const existing = grouped.get(currentReaction.emoji) ?? {
      count: 0,
      reactedByMe: false,
    };

    grouped.set(currentReaction.emoji, {
      count: existing.count + 1,
      reactedByMe:
        existing.reactedByMe || currentReaction.userId === currentUserId,
    });
  }

  return Array.from(grouped.entries()).map(([emoji, data]) => ({
    emoji,
    count: data.count,
    reactedByMe: data.reactedByMe,
  }));
}

async function findIssueId(id: string, workspaceId: string) {
  const byIdentifier = await db
    .select({ id: issue.id })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.identifier, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  if (byIdentifier[0]) {
    return byIdentifier[0].id;
  }

  if (!isUuidLike(id)) {
    return null;
  }

  const byId = await db
    .select({ id: issue.id })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.id, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  return byId[0]?.id ?? null;
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
  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const body = (await request.json()) as { emoji?: string };
  const emoji = body.emoji?.trim();

  if (!emoji) {
    return NextResponse.json({ error: "Emoji is required" }, { status: 400 });
  }

  const issueId = await findIssueId(id, workspaceId);
  if (!issueId) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const existingReactions = await db
    .select({ id: issueReaction.id })
    .from(issueReaction)
    .where(
      and(
        eq(issueReaction.issueId, issueId),
        eq(issueReaction.userId, session.user.id),
        eq(issueReaction.emoji, emoji),
      ),
    )
    .limit(1);

  if (existingReactions.length > 0) {
    await db
      .delete(issueReaction)
      .where(eq(issueReaction.id, existingReactions[0].id));
  } else {
    await db.insert(issueReaction).values({
      issueId,
      userId: session.user.id,
      emoji,
    });
  }

  const nextReactions = await db
    .select({ emoji: issueReaction.emoji, userId: issueReaction.userId })
    .from(issueReaction)
    .where(eq(issueReaction.issueId, issueId));

  return NextResponse.json(
    summarizeIssueReactions(nextReactions, session.user.id),
  );
}

export async function DELETE(
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

  const body = (await request.json()) as { emoji?: string };
  const emoji = body.emoji?.trim();

  if (!emoji) {
    return NextResponse.json({ error: "Emoji is required" }, { status: 400 });
  }

  const issueId = await findIssueId(id, workspaceId);
  if (!issueId) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  await db
    .delete(issueReaction)
    .where(
      and(
        eq(issueReaction.issueId, issueId),
        eq(issueReaction.userId, session.user.id),
        eq(issueReaction.emoji, emoji),
      ),
    );

  const nextReactions = await db
    .select({ emoji: issueReaction.emoji, userId: issueReaction.userId })
    .from(issueReaction)
    .where(eq(issueReaction.issueId, issueId));

  return NextResponse.json(
    summarizeIssueReactions(nextReactions, session.user.id),
  );
}
