import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { recurringIssue } from "@/lib/db/schema";
import { normalizeRecurringIssueInput } from "@/lib/recurring-issues";
import { findAccessibleTeam } from "@/lib/teams";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { serializeRecurringIssue } from "../route";

async function getScopedRecurringIssue(
  request: Request,
  key: string,
  id: string,
  userId: string,
) {
  const teamRecord = await findAccessibleTeam(key, userId, { request });
  if (!teamRecord) {
    return {
      response: NextResponse.json({ error: "Team not found" }, { status: 404 }),
      teamRecord: null,
      recurringIssueRecord: null,
    };
  }

  const [record] = await db
    .select()
    .from(recurringIssue)
    .where(
      and(
        eq(recurringIssue.id, id),
        eq(recurringIssue.workspaceId, teamRecord.workspaceId),
        eq(recurringIssue.teamId, teamRecord.id),
      ),
    )
    .limit(1);

  if (!record) {
    return {
      response: NextResponse.json(
        { error: "Recurring issue not found" },
        { status: 404 },
      ),
      teamRecord: null,
      recurringIssueRecord: null,
    };
  }

  return { response: null, teamRecord, recurringIssueRecord: record };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string; id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key, id } = await params;
  const { response } = await getScopedRecurringIssue(
    request,
    key,
    id,
    session.user.id,
  );
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let input: ReturnType<typeof normalizeRecurringIssueInput>;
  try {
    input = normalizeRecurringIssueInput(
      body && typeof body === "object" ? body : {},
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Invalid recurring issue",
      },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(recurringIssue)
    .set({
      title: input.title,
      description: input.description,
      stateId: input.stateId,
      assigneeId: input.assigneeId,
      priority: input.priority,
      labelIds: input.labelIds,
      projectId: input.projectId,
      cadenceConfig: input.cadenceConfig,
      timezone: input.timezone,
      nextRunAt: input.nextRunAt,
      enabled: input.enabled,
      updatedAt: new Date(),
    })
    .where(eq(recurringIssue.id, id))
    .returning();

  return NextResponse.json({
    recurringIssue: serializeRecurringIssue(updated),
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string; id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key, id } = await params;
  const { response } = await getScopedRecurringIssue(
    request,
    key,
    id,
    session.user.id,
  );
  if (response) return response;

  await db.delete(recurringIssue).where(eq(recurringIssue.id, id));
  return NextResponse.json({ success: true });
}
