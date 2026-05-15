import { resolveRequestWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  comment,
  issue,
  issueDiscussionSummary,
  team,
  user,
} from "@/lib/db/schema";
import {
  type DiscussionSummaryStatus,
  buildDiscussionSummaryState,
  generateDiscussionSummary,
} from "@/lib/discussion-summary";
import { readTeamSettings } from "@/lib/team-settings";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(
    value,
  );
}

async function findIssueRecord(id: string, workspaceId: string) {
  const byIdentifier = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      teamId: issue.teamId,
      workspaceId: team.workspaceId,
      teamSettings: team.settings,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.identifier, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  if (byIdentifier.length > 0) {
    return byIdentifier[0];
  }

  if (!isUuidLike(id)) {
    return null;
  }

  const byId = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      teamId: issue.teamId,
      workspaceId: team.workspaceId,
      teamSettings: team.settings,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .where(and(eq(issue.id, id), eq(team.workspaceId, workspaceId)))
    .limit(1);

  return byId[0] ?? null;
}

async function loadComments(issueId: string) {
  return db
    .select({
      body: comment.body,
      userName: user.name,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    })
    .from(comment)
    .leftJoin(user, eq(comment.userId, user.id))
    .where(eq(comment.issueId, issueId))
    .orderBy(asc(comment.createdAt));
}

async function loadPersistedSummary(issueId: string) {
  const rows = await db
    .select()
    .from(issueDiscussionSummary)
    .where(eq(issueDiscussionSummary.issueId, issueId))
    .limit(1);

  return rows[0] ?? null;
}

function responseFromState(
  state: ReturnType<typeof buildDiscussionSummaryState>,
) {
  return NextResponse.json(state);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const { id } = await params;
  const currentIssue = await findIssueRecord(id, workspaceId);
  if (!currentIssue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const comments = await loadComments(currentIssue.id);
  const persisted = await loadPersistedSummary(currentIssue.id);

  return responseFromState(
    buildDiscussionSummaryState({
      enabled: readTeamSettings(currentIssue.teamSettings)
        .discussionSummariesEnabled,
      comments,
      persisted: persisted
        ? {
            status: persisted.status as DiscussionSummaryStatus,
            summary: persisted.summary,
            generatedAt: persisted.generatedAt,
            generatedBy: persisted.generatedBy,
            sourceCommentCount: persisted.sourceCommentCount,
            sourceCommentVersion: persisted.sourceCommentVersion,
            error: persisted.error,
            staleAt: persisted.staleAt,
          }
        : null,
    }),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  const workspaceId = await resolveRequestWorkspaceId(session.user.id, request);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace found" }, { status: 400 });
  }

  const { id } = await params;
  const currentIssue = await findIssueRecord(id, workspaceId);
  if (!currentIssue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  if (!readTeamSettings(currentIssue.teamSettings).discussionSummariesEnabled) {
    return NextResponse.json(
      { error: "Discussion summaries are disabled for this team" },
      { status: 403 },
    );
  }

  const comments = await loadComments(currentIssue.id);
  const now = new Date();

  await db
    .insert(issueDiscussionSummary)
    .values({
      issueId: currentIssue.id,
      teamId: currentIssue.teamId,
      workspaceId: currentIssue.workspaceId,
      status: "generating",
      summary: null,
      sourceCommentCount: comments.length,
      sourceCommentVersion: null,
      generatedBy: session.user.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: issueDiscussionSummary.issueId,
      set: {
        status: "generating",
        error: null,
        generatedBy: session.user.id,
        updatedAt: now,
      },
    });

  try {
    const generated = await generateDiscussionSummary({
      issueTitle: currentIssue.title,
      issueIdentifier: currentIssue.identifier,
      comments,
    });
    const generatedAt = new Date();
    const [stored] = await db
      .insert(issueDiscussionSummary)
      .values({
        issueId: currentIssue.id,
        teamId: currentIssue.teamId,
        workspaceId: currentIssue.workspaceId,
        status: "generated",
        summary: generated.text,
        sourceCommentCount: generated.source.sourceCommentCount,
        sourceCommentVersion: generated.source.sourceCommentVersion,
        generatedAt,
        generatedBy: session.user.id,
        staleAt: null,
        error: null,
        updatedAt: generatedAt,
      })
      .onConflictDoUpdate({
        target: issueDiscussionSummary.issueId,
        set: {
          status: "generated",
          summary: generated.text,
          sourceCommentCount: generated.source.sourceCommentCount,
          sourceCommentVersion: generated.source.sourceCommentVersion,
          generatedAt,
          generatedBy: session.user.id,
          staleAt: null,
          error: null,
          updatedAt: generatedAt,
        },
      })
      .returning();

    return responseFromState(
      buildDiscussionSummaryState({
        enabled: true,
        comments,
        persisted: {
          status: stored.status as DiscussionSummaryStatus,
          summary: stored.summary,
          generatedAt: stored.generatedAt,
          generatedBy: stored.generatedBy,
          sourceCommentCount: stored.sourceCommentCount,
          sourceCommentVersion: stored.sourceCommentVersion,
          error: stored.error,
          staleAt: stored.staleAt,
        },
      }),
    );
  } catch (error) {
    const failedAt = new Date();
    const message =
      error instanceof Error
        ? error.message
        : "Discussion summary generation failed";

    const [stored] = await db
      .update(issueDiscussionSummary)
      .set({
        status: "failed",
        error: message,
        generatedBy: session.user.id,
        updatedAt: failedAt,
      })
      .where(eq(issueDiscussionSummary.issueId, currentIssue.id))
      .returning();

    return NextResponse.json(
      buildDiscussionSummaryState({
        enabled: true,
        comments,
        persisted: stored
          ? {
              status: stored.status as DiscussionSummaryStatus,
              summary: stored.summary,
              generatedAt: stored.generatedAt,
              generatedBy: stored.generatedBy,
              sourceCommentCount: stored.sourceCommentCount,
              sourceCommentVersion: stored.sourceCommentVersion,
              error: stored.error,
              staleAt: stored.staleAt,
            }
          : null,
      }),
      { status: 500 },
    );
  }
}
