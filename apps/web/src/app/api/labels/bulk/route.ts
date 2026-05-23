import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issueLabel, label, team } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

function uniqueStrings(values: unknown): string[] {
  return Array.isArray(values)
    ? [...new Set(values.filter((value): value is string => Boolean(value)))]
    : [];
}

async function validateTeamScope(workspaceId: string, teamId: unknown) {
  if (teamId === null || teamId === undefined || teamId === "") return null;
  if (typeof teamId !== "string") return undefined;
  const [teamRecord] = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.workspaceId, workspaceId)))
    .limit(1);
  return teamRecord?.id;
}

export async function POST(request: Request) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const workspaceId = await resolveActiveWorkspaceId(session.user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  }

  const body = (await request.json()) as {
    action?: string;
    labelIds?: unknown;
    destinationLabelId?: unknown;
    teamId?: unknown;
  };
  const action = body.action;
  const labelIds = uniqueStrings(body.labelIds);

  if (!action) {
    return NextResponse.json({ error: "Action is required" }, { status: 400 });
  }
  if (labelIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one label" },
      { status: 400 },
    );
  }

  const existing = await db
    .select({ id: label.id })
    .from(label)
    .where(
      and(inArray(label.id, labelIds), eq(label.workspaceId, workspaceId)),
    );
  if (existing.length !== labelIds.length) {
    return NextResponse.json(
      { error: "One or more labels were not found" },
      { status: 404 },
    );
  }

  if (action === "archive" || action === "unarchive") {
    await db
      .update(label)
      .set({
        archivedAt: action === "archive" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(inArray(label.id, labelIds), eq(label.workspaceId, workspaceId)),
      );
    return NextResponse.json({ success: true, updatedCount: labelIds.length });
  }

  if (action === "delete") {
    await db.transaction(async (tx) => {
      await tx.delete(issueLabel).where(inArray(issueLabel.labelId, labelIds));
      await tx
        .delete(label)
        .where(
          and(inArray(label.id, labelIds), eq(label.workspaceId, workspaceId)),
        );
    });
    return NextResponse.json({ success: true, updatedCount: labelIds.length });
  }

  if (action === "convertToGroup") {
    await db
      .update(label)
      .set({ parentLabelId: null, color: "#6b6f76", updatedAt: new Date() })
      .where(
        and(inArray(label.id, labelIds), eq(label.workspaceId, workspaceId)),
      );
    return NextResponse.json({ success: true, updatedCount: labelIds.length });
  }

  if (action === "rescope") {
    const nextTeamId = await validateTeamScope(workspaceId, body.teamId);
    if (nextTeamId === undefined) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    await db
      .update(label)
      .set({ teamId: nextTeamId, updatedAt: new Date() })
      .where(
        and(inArray(label.id, labelIds), eq(label.workspaceId, workspaceId)),
      );
    return NextResponse.json({ success: true, updatedCount: labelIds.length });
  }

  if (action === "merge") {
    if (typeof body.destinationLabelId !== "string") {
      return NextResponse.json(
        { error: "destinationLabelId is required" },
        { status: 400 },
      );
    }
    const destinationLabelId = body.destinationLabelId;
    const sourceIds = labelIds.filter((id) => id !== destinationLabelId);
    if (sourceIds.length === 0) {
      return NextResponse.json(
        { error: "Choose at least one source label" },
        { status: 400 },
      );
    }

    const [destination] = await db
      .select({ id: label.id })
      .from(label)
      .where(
        and(
          eq(label.id, destinationLabelId),
          eq(label.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!destination) {
      return NextResponse.json(
        { error: "Destination label not found" },
        { status: 404 },
      );
    }

    await db.transaction(async (tx) => {
      const sourceJoins = await tx
        .select({ id: issueLabel.id, issueId: issueLabel.issueId })
        .from(issueLabel)
        .where(inArray(issueLabel.labelId, sourceIds));
      const destinationJoins = await tx
        .select({ issueId: issueLabel.issueId })
        .from(issueLabel)
        .where(eq(issueLabel.labelId, destinationLabelId));
      const issueIdsAlreadyOnDestination = new Set(
        destinationJoins.map((row) => row.issueId),
      );
      const duplicateJoinIds = sourceJoins
        .filter((row) => issueIdsAlreadyOnDestination.has(row.issueId))
        .map((row) => row.id);
      const joinIdsToMove = sourceJoins
        .filter((row) => !issueIdsAlreadyOnDestination.has(row.issueId))
        .map((row) => row.id);

      if (duplicateJoinIds.length > 0) {
        await tx
          .delete(issueLabel)
          .where(inArray(issueLabel.id, duplicateJoinIds));
      }
      if (joinIdsToMove.length > 0) {
        await tx
          .update(issueLabel)
          .set({ labelId: destinationLabelId })
          .where(inArray(issueLabel.id, joinIdsToMove));
      }
      await tx.delete(label).where(inArray(label.id, sourceIds));
      await tx
        .update(label)
        .set({ updatedAt: new Date() })
        .where(eq(label.id, destinationLabelId));
    });

    return NextResponse.json({
      success: true,
      destinationLabelId,
      mergedCount: sourceIds.length,
    });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
