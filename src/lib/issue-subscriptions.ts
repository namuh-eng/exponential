import { db } from "@/lib/db";
import { issueSubscription } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

type DbClient = typeof db;

export async function getIssueSubscriptionSummary(input: {
  issueId: string;
  userId: string;
  client?: DbClient;
}) {
  const client = input.client ?? db;
  const rows = await client
    .select({
      userId: issueSubscription.userId,
      subscribed: issueSubscription.subscribed,
    })
    .from(issueSubscription)
    .where(eq(issueSubscription.issueId, input.issueId));

  const subscribedRows = rows.filter((row) => row.subscribed);
  const viewerRow = rows.find((row) => row.userId === input.userId);

  return {
    subscribed: viewerRow?.subscribed ?? false,
    watcherCount: subscribedRows.length,
  };
}

export async function setIssueSubscription(input: {
  issueId: string;
  userId: string;
  subscribed: boolean;
  client?: DbClient;
}) {
  const client = input.client ?? db;
  const now = new Date();

  await client
    .insert(issueSubscription)
    .values({
      issueId: input.issueId,
      userId: input.userId,
      subscribed: input.subscribed,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [issueSubscription.issueId, issueSubscription.userId],
      set: { subscribed: input.subscribed, updatedAt: now },
    });

  return getIssueSubscriptionSummary({
    issueId: input.issueId,
    userId: input.userId,
    client,
  });
}

export async function getIssueNotificationRecipients(input: {
  issueId: string;
  baseUserIds: Array<string | null | undefined>;
  mentionedUserIds?: string[];
  actorId: string;
  client?: DbClient;
}) {
  const client = input.client ?? db;
  const mentionedUserIds = input.mentionedUserIds ?? [];
  const candidateIds = new Set(
    [...input.baseUserIds, ...mentionedUserIds].filter(
      (value): value is string => Boolean(value) && value !== input.actorId,
    ),
  );

  const rows = await client
    .select({
      userId: issueSubscription.userId,
      subscribed: issueSubscription.subscribed,
    })
    .from(issueSubscription)
    .where(eq(issueSubscription.issueId, input.issueId));

  for (const row of rows) {
    if (row.subscribed && row.userId !== input.actorId) {
      candidateIds.add(row.userId);
    }
  }

  const explicitUnsubscribedIds = rows
    .filter((row) => !row.subscribed)
    .map((row) => row.userId);

  if (explicitUnsubscribedIds.length > 0) {
    const mentionedSet = new Set(mentionedUserIds);
    for (const unsubscribedUserId of explicitUnsubscribedIds) {
      if (!mentionedSet.has(unsubscribedUserId)) {
        candidateIds.delete(unsubscribedUserId);
      }
    }
  }

  return [...candidateIds];
}
