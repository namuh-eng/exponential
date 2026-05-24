import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import { requireApiSession } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { issue, notification, user } from "@/lib/db/schema";
import {
  createHeadlessNotificationsClient,
  headlessNotificationsEnabled,
  mintInternalApiToken,
} from "@/lib/headless-api";
import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

function activeInboxPredicate(userId: string) {
  return sql`${notification.userId} = ${userId}
    AND ${notification.readAt} IS NULL
    AND (
      ${notification.snoozedUntilAt} IS NULL
      OR ${notification.snoozedUntilAt} <= now()
      OR (${notification.unsnoozedAt} IS NOT NULL AND ${notification.unsnoozedAt} >= ${notification.snoozedUntilAt})
    )`;
}

export async function GET() {
  const { response: authResponse, session } = await requireApiSession();
  if (authResponse) {
    return authResponse;
  }

  if (headlessNotificationsEnabled()) {
    const workspaceId = await resolveActiveWorkspaceId(session.user.id);
    if (workspaceId) {
      const token = await mintInternalApiToken({
        userId: session.user.id,
        workspaceId,
      });
      const client = createHeadlessNotificationsClient(token);
      const { data, error, response } = await client.GET("/notifications");
      if (error)
        return NextResponse.json(error, {
          status: (response as Response).status,
        });
      return NextResponse.json(data, { status: (response as Response).status });
    }
  }

  const userId = session.user.id;

  // Alias for actor user
  const actor = user;

  const notifications = await db
    .select({
      id: notification.id,
      type: notification.type,
      readAt: notification.readAt,
      snoozedUntilAt: notification.snoozedUntilAt,
      unsnoozedAt: notification.unsnoozedAt,
      createdAt: notification.createdAt,
      actorName: actor.name,
      actorImage: actor.image,
      issueId: notification.issueId,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      issuePriority: issue.priority,
    })
    .from(notification)
    .leftJoin(actor, eq(notification.actorId, actor.id))
    .leftJoin(issue, eq(notification.issueId, issue.id))
    .where(eq(notification.userId, userId))
    .orderBy(desc(notification.createdAt))
    .limit(100);

  const unreadCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notification)
    .where(activeInboxPredicate(userId));

  return NextResponse.json({
    notifications: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      actorName: n.actorName ?? "Unknown",
      actorImage: n.actorImage ?? null,
      issueIdentifier: n.issueIdentifier ?? "",
      issueTitle: n.issueTitle ?? "",
      issuePriority: n.issuePriority ?? "none",
      issueId: n.issueId,
      readAt: n.readAt?.toISOString() ?? null,
      snoozedUntilAt: n.snoozedUntilAt?.toISOString() ?? null,
      unsnoozedAt: n.unsnoozedAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount: unreadCount[0]?.count ?? 0,
  });
}
