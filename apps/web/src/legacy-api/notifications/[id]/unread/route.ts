import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { notification } from "@/lib/db/schema";
import {
  createHeadlessNotificationsClient,
  headlessNotificationsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) return authResponse;

  const { id } = await params;
  if (headlessNotificationsEnabled()) {
    const workspaceId = await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessNotificationsClient(token);
      const { data, error, response } = await client.PATCH(
        "/notifications/{id}/unread",
        {
          params: { path: { id } },
        },
      );
      if (error)
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }
  const updated = await db
    .update(notification)
    .set({ readAt: null })
    .where(
      and(eq(notification.id, id), eq(notification.userId, session.user.id)),
    )
    .returning({ id: notification.id });

  if (updated.length === 0) {
    return NextResponse.json(
      { error: "Notification not found" },
      { status: 404 },
    );
  }

  const unreadCount = await unreadCountFor(session.user.id);

  return NextResponse.json({
    success: true,
    ...(unreadCount !== undefined ? { unreadCount } : {}),
  });
}
