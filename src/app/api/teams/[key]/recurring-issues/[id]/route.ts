import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { recurringIssue } from "@/lib/db/schema";
import {
  type RecurringIssueCadenceConfig,
  computeNextRunAt,
  formatCadence,
  normalizeCadenceConfig,
  parseDateTimeInput,
} from "@/lib/recurring-issues";
import { findAccessibleTeam } from "@/lib/teams";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const validPriorities = new Set(["none", "urgent", "high", "medium", "low"]);

type UpdateInput = {
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

async function findScopedRecurringIssue(
  request: Request,
  key: string,
  id: string,
  userId: string,
) {
  const teamRecord = await findAccessibleTeam(key, userId, { request });
  if (!teamRecord) return { teamRecord: null, record: null };

  const [record] = await db
    .select()
    .from(recurringIssue)
    .where(
      and(eq(recurringIssue.id, id), eq(recurringIssue.teamId, teamRecord.id)),
    )
    .limit(1);

  return { teamRecord, record: record ?? null };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string; id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key, id } = await params;
  const { record } = await findScopedRecurringIssue(
    request,
    key,
    id,
    session.user.id,
  );
  if (!record) {
    return NextResponse.json(
      { error: "Recurring issue not found" },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as UpdateInput;
  const updates: Partial<typeof recurringIssue.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    updates.title = title;
  }

  if (body.description !== undefined) {
    updates.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  }

  if (body.enabled !== undefined) {
    updates.enabled = body.enabled === true;
  }

  if (body.timezone !== undefined) {
    updates.timezone =
      typeof body.timezone === "string" && body.timezone.trim()
        ? body.timezone.trim().slice(0, 100)
        : "UTC";
  }

  if (body.priority !== undefined) {
    const priority = typeof body.priority === "string" ? body.priority : "none";
    if (!validPriorities.has(priority)) {
      return NextResponse.json(
        { error: "Choose a valid priority" },
        { status: 400 },
      );
    }
    updates.priority = priority as
      | "none"
      | "urgent"
      | "high"
      | "medium"
      | "low";
  }

  if (body.stateId !== undefined) {
    updates.stateId =
      typeof body.stateId === "string" && body.stateId.trim()
        ? body.stateId.trim()
        : null;
  }

  if (body.assigneeId !== undefined) {
    updates.assigneeId =
      typeof body.assigneeId === "string" && body.assigneeId.trim()
        ? body.assigneeId.trim()
        : null;
  }

  if (body.labelIds !== undefined) {
    updates.labelIds = Array.isArray(body.labelIds)
      ? body.labelIds.filter((v): v is string => typeof v === "string")
      : [];
  }

  if (body.projectId !== undefined) {
    updates.projectId =
      typeof body.projectId === "string" && body.projectId.trim()
        ? body.projectId.trim()
        : null;
  }

  let cadenceConfig = record.cadenceConfig as Parameters<
    typeof computeNextRunAt
  >[0];
  if (body.cadenceConfig !== undefined) {
    const cadence = normalizeCadenceConfig(body.cadenceConfig);
    if (cadence.error || !cadence.config) {
      return NextResponse.json(
        { error: cadence.error ?? "Choose a valid cadence" },
        { status: 400 },
      );
    }
    cadenceConfig = cadence.config;
    updates.cadenceConfig = cadence.config;
  }

  let startAt = record.startAt ?? new Date();
  if (body.startAt !== undefined) {
    const parsedStart = parseDateTimeInput(body.startAt);
    if (!parsedStart) {
      return NextResponse.json(
        { error: "Start date/time is required" },
        { status: 400 },
      );
    }
    startAt = parsedStart;
    updates.startAt = parsedStart;
  }

  if (body.cadenceConfig !== undefined || body.startAt !== undefined) {
    updates.nextRunAt = computeNextRunAt(cadenceConfig, startAt);
  }

  const [updated] = await db
    .update(recurringIssue)
    .set(updates)
    .where(
      and(eq(recurringIssue.id, id), eq(recurringIssue.teamId, record.teamId)),
    )
    .returning();

  return NextResponse.json(serializeRecurringIssue(updated));
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string; id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { key, id } = await params;
  const { record } = await findScopedRecurringIssue(
    request,
    key,
    id,
    session.user.id,
  );
  if (!record) {
    return NextResponse.json(
      { error: "Recurring issue not found" },
      { status: 404 },
    );
  }

  await db
    .delete(recurringIssue)
    .where(
      and(eq(recurringIssue.id, id), eq(recurringIssue.teamId, record.teamId)),
    );

  return new NextResponse(null, { status: 204 });
}
