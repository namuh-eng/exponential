import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { notification } from "@/lib/db/schema";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

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

export async function PATCH() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const updated = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.userId, session.user.id),
        isNull(notification.readAt),
        ne(notification.type, "comment"),
      ),
    )
    .returning({ id: notification.id });

  const unreadCount = await unreadCountFor(session.user.id);

  return NextResponse.json({
    success: true,
    updatedCount: updated.length,
    ...(unreadCount !== undefined ? { unreadCount } : {}),
  });
}
