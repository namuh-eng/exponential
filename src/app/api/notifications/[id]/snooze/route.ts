import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { notification } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

async function unreadCountFor(userId: string) {
  if (typeof db.select !== "function") return undefined;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(
      sql`${notification.userId} = ${userId}
        AND ${notification.readAt} IS NULL
        AND (
          ${notification.snoozedUntilAt} IS NULL
          OR ${notification.snoozedUntilAt} <= now()
          OR (${notification.unsnoozedAt} IS NOT NULL AND ${notification.unsnoozedAt} >= ${notification.snoozedUntilAt})
        )`,
    );
  return row?.count ?? 0;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const body = (await request.json().catch(() => null)) as {
    snoozedUntilAt?: string | null;
  } | null;
  const nextSnoozedUntilAt = body?.snoozedUntilAt ?? null;
  const snoozeDate = nextSnoozedUntilAt ? new Date(nextSnoozedUntilAt) : null;

  if (snoozeDate && Number.isNaN(snoozeDate.getTime())) {
    return NextResponse.json(
      { error: "snoozedUntilAt must be a valid ISO date or null" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const updated = await db
    .update(notification)
    .set({
      snoozedUntilAt: snoozeDate,
      unsnoozedAt: snoozeDate ? null : new Date(),
    })
    .where(
      and(eq(notification.id, id), eq(notification.userId, session.user.id)),
    )
    .returning({
      id: notification.id,
      snoozedUntilAt: notification.snoozedUntilAt,
      unsnoozedAt: notification.unsnoozedAt,
    });

  if (updated.length === 0) {
    return NextResponse.json(
      { error: "Notification not found" },
      { status: 404 },
    );
  }

  const unreadCount = await unreadCountFor(session.user.id);

  return NextResponse.json({
    success: true,
    notification: {
      id: updated[0].id,
      snoozedUntilAt: updated[0].snoozedUntilAt?.toISOString() ?? null,
      unsnoozedAt: updated[0].unsnoozedAt?.toISOString() ?? null,
    },
    ...(unreadCount !== undefined ? { unreadCount } : {}),
  });
}
