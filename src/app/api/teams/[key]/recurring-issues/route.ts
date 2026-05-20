import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { recurringIssue } from "@/lib/db/schema";
import {
  formatCadence,
  normalizeRecurringIssueInput,
} from "@/lib/recurring-issues";
import { findAccessibleTeam } from "@/lib/teams";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

type RecurringIssueRecord = typeof recurringIssue.$inferSelect;

export function serializeRecurringIssue(record: RecurringIssueRecord) {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    teamId: record.teamId,
    stateId: record.stateId,
    assigneeId: record.assigneeId,
    priority: record.priority,
    labelIds: record.labelIds,
    projectId: record.projectId,
    cadenceConfig: record.cadenceConfig,
    cadenceLabel: formatCadence(record.cadenceConfig),
    timezone: record.timezone,
    nextRunAt: record.nextRunAt,
    enabled: record.enabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function getTeamOrResponse(
  request: Request,
  key: string,
  userId: string,
) {
  const teamRecord = await findAccessibleTeam(key, userId, { request });
  if (!teamRecord) {
    return {
      response: NextResponse.json({ error: "Team not found" }, { status: 404 }),
      teamRecord: null,
    };
  }
  return { response: null, teamRecord };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const { response, teamRecord } = await getTeamOrResponse(
    request,
    key,
    session.user.id,
  );
  if (response) return response;

  const issues = await db
    .select()
    .from(recurringIssue)
    .where(
      and(
        eq(recurringIssue.workspaceId, teamRecord.workspaceId),
        eq(recurringIssue.teamId, teamRecord.id),
      ),
    )
    .orderBy(desc(recurringIssue.createdAt));

  return NextResponse.json({
    team: { id: teamRecord.id, name: teamRecord.name, key: teamRecord.key },
    recurringIssues: issues.map(serializeRecurringIssue),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const { response, teamRecord } = await getTeamOrResponse(
    request,
    key,
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

  const [created] = await db
    .insert(recurringIssue)
    .values({
      workspaceId: teamRecord.workspaceId,
      teamId: teamRecord.id,
      creatorId: session.user.id,
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
    })
    .returning();

  return NextResponse.json(
    { recurringIssue: serializeRecurringIssue(created) },
    { status: 201 },
  );
}
