import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { recurringIssue, workflowState } from "@/lib/db/schema";
import {
  type RecurringIssueCadenceConfig,
  computeNextRunAt,
  formatCadence,
  normalizeCadenceConfig,
  parseDateTimeInput,
} from "@/lib/recurring-issues";
import { findAccessibleTeam } from "@/lib/teams";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const TITLE_MAX_LENGTH = 500;

type RecurringIssueInput = {
  title?: unknown;
  description?: unknown;
  cadenceConfig?: unknown;
  startAt?: unknown;
  timezone?: unknown;
  enabled?: unknown;
  stateId?: unknown;
  assigneeId?: unknown;
  priority?: unknown;
  labelIds?: unknown;
  projectId?: unknown;
};

const validPriorities = new Set(["none", "urgent", "high", "medium", "low"]);

function serializeRecurringIssue(record: typeof recurringIssue.$inferSelect) {
  return {
    ...record,
    startAt: record.startAt?.toISOString() ?? null,
    nextRunAt: record.nextRunAt.toISOString(),
    lastRunAt: record.lastRunAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    cadenceLabel: formatCadence(
      record.cadenceConfig as RecurringIssueCadenceConfig,
    ),
  };
}

async function getDefaultStateId(teamId: string) {
  const [state] = await db
    .select({ id: workflowState.id })
    .from(workflowState)
    .where(
      and(eq(workflowState.teamId, teamId), eq(workflowState.isDefault, true)),
    )
    .limit(1);

  if (state) return state.id;

  const [fallbackState] = await db
    .select({ id: workflowState.id })
    .from(workflowState)
    .where(eq(workflowState.teamId, teamId))
    .limit(1);

  return fallbackState?.id ?? null;
}

function validateBody(body: RecurringIssueInput) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return { error: "Title is required", status: 400 as const };
  }
  if (title.length > TITLE_MAX_LENGTH) {
    return {
      error: "Title must be 500 characters or fewer",
      status: 400 as const,
    };
  }

  const cadence = normalizeCadenceConfig(body.cadenceConfig);
  if (cadence.error || !cadence.config) {
    return {
      error: cadence.error ?? "Choose a valid cadence",
      status: 400 as const,
    };
  }

  const startAt = parseDateTimeInput(body.startAt);
  if (!startAt) {
    return { error: "Start date/time is required", status: 400 as const };
  }

  const timezone =
    typeof body.timezone === "string" && body.timezone.trim()
      ? body.timezone.trim().slice(0, 100)
      : "UTC";

  const priority = typeof body.priority === "string" ? body.priority : "none";
  if (!validPriorities.has(priority)) {
    return { error: "Choose a valid priority", status: 400 as const };
  }

  const labelIds = Array.isArray(body.labelIds)
    ? body.labelIds.filter((v): v is string => typeof v === "string")
    : [];

  return {
    value: {
      title,
      description:
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null,
      cadenceConfig: cadence.config,
      startAt,
      timezone,
      enabled: body.enabled !== false,
      assigneeId:
        typeof body.assigneeId === "string" && body.assigneeId.trim()
          ? body.assigneeId.trim()
          : null,
      stateId:
        typeof body.stateId === "string" && body.stateId.trim()
          ? body.stateId.trim()
          : null,
      priority: priority as "none" | "urgent" | "high" | "medium" | "low",
      labelIds,
      projectId:
        typeof body.projectId === "string" && body.projectId.trim()
          ? body.projectId.trim()
          : null,
    },
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const records = await db
    .select()
    .from(recurringIssue)
    .where(eq(recurringIssue.teamId, teamRecord.id))
    .orderBy(desc(recurringIssue.createdAt));

  return NextResponse.json({
    team: {
      id: teamRecord.id,
      name: teamRecord.name,
      key: teamRecord.key,
    },
    recurringIssues: records.map(serializeRecurringIssue),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key } = await params;
  const teamRecord = await findAccessibleTeam(key, session.user.id, {
    request,
  });
  if (!teamRecord) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as RecurringIssueInput;
  const validation = validateBody(body);
  if ("error" in validation) {
    return NextResponse.json(
      { error: validation.error },
      { status: validation.status },
    );
  }

  const defaultStateId = await getDefaultStateId(teamRecord.id);
  const stateId = validation.value.stateId ?? defaultStateId;
  const nextRunAt = computeNextRunAt(
    validation.value.cadenceConfig,
    validation.value.startAt,
  );

  const [created] = await db
    .insert(recurringIssue)
    .values({
      workspaceId: teamRecord.workspaceId,
      teamId: teamRecord.id,
      creatorId: session.user.id,
      title: validation.value.title,
      description: validation.value.description,
      stateId,
      assigneeId: validation.value.assigneeId,
      priority: validation.value.priority,
      labelIds: validation.value.labelIds,
      projectId: validation.value.projectId,
      cadenceConfig: validation.value.cadenceConfig,
      timezone: validation.value.timezone,
      startAt: validation.value.startAt,
      nextRunAt,
      enabled: validation.value.enabled,
    })
    .returning();

  return NextResponse.json(serializeRecurringIssue(created), { status: 201 });
}
