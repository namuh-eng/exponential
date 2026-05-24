import {
  type AccountNotificationEventKey,
  type AccountNotificationSettings,
  readAccountNotificationsFromUserSettings,
} from "@/lib/account-notifications";
import { db } from "@/lib/db";
import { member, notification, user } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

type NotificationType = (typeof notification.$inferInsert)["type"];

interface MentionCandidate {
  userId: string;
  email: string | null;
  name: string | null;
}

interface NotificationInput {
  actorId: string;
  issueId: string;
  type: NotificationType;
  userId: string;
}

const NOTIFICATION_TYPE_EVENT_KEY: Partial<
  Record<NotificationType, AccountNotificationEventKey>
> = {
  assigned: "assignments",
  status_change: "statusChanges",
  mentioned: "mentions",
  comment: "comments",
  duplicate: "relations",
};

export const ACCOUNT_NOTIFICATION_DELIVERY_EVENT_KEYS = [
  "assignments",
  "statusChanges",
  "mentions",
  "comments",
  "dueDates",
  "projectUpdates",
  "teamUpdates",
  "workspaceAdmin",
] as const satisfies readonly AccountNotificationEventKey[];

const mentionPattern = /(^|\s)@([a-z0-9][\w.-]*)/gi;
const canonicalMentionPattern = /@\[[^\]]+]\(user:([^)]+)\)/g;

function normalizeMentionToken(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function getMentionAliases(candidate: MentionCandidate) {
  const aliases = new Set<string>();
  const trimmedName = candidate.name?.trim() ?? "";

  if (trimmedName) {
    aliases.add(normalizeMentionToken(trimmedName));

    for (const part of trimmedName.split(/\s+/)) {
      const normalizedPart = normalizeMentionToken(part);
      if (normalizedPart) {
        aliases.add(normalizedPart);
      }
    }
  }

  const emailLocalPart = candidate.email?.split("@")[0] ?? "";
  const normalizedEmailLocalPart = normalizeMentionToken(emailLocalPart);
  if (normalizedEmailLocalPart) {
    aliases.add(normalizedEmailLocalPart);
  }

  return aliases;
}

export function extractCanonicalMentionUserIds(value: string) {
  const userIds = new Set<string>();

  for (const match of value.matchAll(canonicalMentionPattern)) {
    const userId = match[1]?.trim();
    if (userId) {
      userIds.add(userId);
    }
  }

  return [...userIds];
}

export function extractMentionTokens(value: string) {
  const matches = value.matchAll(mentionPattern);
  const tokens = new Set<string>();

  for (const match of matches) {
    const token = normalizeMentionToken(match[2] ?? "");
    if (token) {
      tokens.add(token);
    }
  }

  return [...tokens];
}

export const extractMentionHandles = extractMentionTokens;

export function resolveMentionedUserIdsFromCandidates(
  body: string,
  candidates: MentionCandidate[],
  canonicalUserIds: string[] = [],
) {
  const candidateUserIds = new Set(
    candidates.map((candidate) => candidate.userId),
  );
  const mentionedUserIds = new Set<string>();

  for (const userId of [
    ...canonicalUserIds,
    ...extractCanonicalMentionUserIds(body),
  ]) {
    if (candidateUserIds.has(userId)) {
      mentionedUserIds.add(userId);
    }
  }

  const tokens = extractMentionTokens(body);
  if (tokens.length === 0) {
    return [...mentionedUserIds];
  }

  const remaining = new Set(tokens);

  for (const candidate of candidates) {
    const aliases = getMentionAliases(candidate);
    for (const token of remaining) {
      if (!aliases.has(token)) {
        continue;
      }

      mentionedUserIds.add(candidate.userId);
      remaining.delete(token);
    }

    if (remaining.size === 0) {
      break;
    }
  }

  return [...mentionedUserIds];
}

export function buildNotificationValues(input: {
  actorId: string;
  issueId: string;
  type: NotificationType;
  userIds: Array<string | null | undefined>;
}) {
  const userIds = new Set(
    input.userIds.filter(
      (value): value is string => Boolean(value) && value !== input.actorId,
    ),
  );

  return [...userIds].map((userId) => ({
    actorId: input.actorId,
    issueId: input.issueId,
    type: input.type,
    userId,
  }));
}

export function shouldDeliverAccountNotificationEventForSettings(
  eventKey: AccountNotificationEventKey,
  settings: AccountNotificationSettings,
) {
  switch (eventKey) {
    case "assignments":
      return (
        settings.inbox.assignedToMe ||
        settings.email.issueActivity ||
        settings.slack.assignedToMe
      );
    case "mentions":
    case "comments":
      return (
        settings.inbox.mentionsAndReplies ||
        settings.email.mentionsAndReplies ||
        settings.desktop.mentionsAndReplies ||
        settings.slack.mentionsAndReplies
      );
    case "dueDates":
      return settings.desktop.reminders || settings.email.dailyDigest;
    case "projectUpdates":
      return settings.email.weeklyDigest || settings.slack.projectUpdates;
    case "teamUpdates":
      return settings.inbox.teamUpdates;
    case "statusChanges":
    case "relations":
      return (
        settings.inbox.subscribedIssues ||
        settings.email.issueActivity ||
        settings.desktop.issueActivity
      );
    case "workspaceAdmin":
      return settings.email.workspaceInvites;
    default:
      return true;
  }
}

export function shouldDeliverNotificationForSettings(
  type: NotificationType,
  settings: AccountNotificationSettings,
) {
  const eventKey = NOTIFICATION_TYPE_EVENT_KEY[type];

  if (!eventKey) {
    return true;
  }

  return shouldDeliverAccountNotificationEventForSettings(eventKey, settings);
}

export async function filterNotificationInputsByAccountSettings(
  inputs: NotificationInput[],
) {
  if (inputs.length === 0) {
    return [];
  }

  const userIds = [...new Set(inputs.map((input) => input.userId))];
  const rows = await db
    .select({ id: user.id, settings: user.settings })
    .from(user)
    .where(inArray(user.id, userIds));
  const settingsByUserId = new Map(
    rows.map((row) => [
      row.id,
      readAccountNotificationsFromUserSettings(row.settings),
    ]),
  );

  return inputs.filter((input) => {
    if (input.userId === input.actorId) {
      return false;
    }

    const settings = settingsByUserId.get(input.userId);
    if (!settings) {
      return true;
    }

    return shouldDeliverNotificationForSettings(input.type, settings);
  });
}

export async function insertNotifications(inputs: NotificationInput[]) {
  const deliverableInputs =
    await filterNotificationInputsByAccountSettings(inputs);

  if (deliverableInputs.length === 0) {
    return;
  }

  await db.insert(notification).values(
    deliverableInputs.map((input) => ({
      actorId: input.actorId,
      issueId: input.issueId,
      type: input.type,
      userId: input.userId,
    })),
  );
}

async function getMentionCandidates(workspaceId: string) {
  return db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.workspaceId, workspaceId));
}

export async function resolveMentionedUserIds(input: {
  body: string;
  workspaceId: string;
  userIds?: string[];
}) {
  const candidates = await getMentionCandidates(input.workspaceId);
  return resolveMentionedUserIdsFromCandidates(
    input.body,
    candidates,
    input.userIds,
  );
}

export async function createAssignmentNotification(input: {
  actorId: string;
  assigneeId: string | null;
  issueId: string;
}) {
  if (!input.assigneeId) {
    return;
  }

  await insertNotifications([
    {
      actorId: input.actorId,
      issueId: input.issueId,
      type: "assigned",
      userId: input.assigneeId,
    },
  ]);
}

export async function createStatusChangeNotifications(input: {
  actorId: string;
  assigneeId: string | null;
  creatorId: string;
  issueId: string;
}) {
  const recipientIds = new Set(
    [input.assigneeId, input.creatorId].filter((value): value is string =>
      Boolean(value),
    ),
  );

  await insertNotifications(
    [...recipientIds].map((userId) => ({
      actorId: input.actorId,
      issueId: input.issueId,
      type: "status_change" as const,
      userId,
    })),
  );
}

export async function createCommentNotifications(input: {
  actorId: string;
  assigneeId: string | null;
  body: string;
  creatorId: string;
  issueId: string;
  workspaceId: string;
}) {
  const candidates = await getMentionCandidates(input.workspaceId);
  const mentionedUserIds = new Set(
    resolveMentionedUserIdsFromCandidates(input.body, candidates),
  );
  const recipientIds = new Set(
    [input.assigneeId, input.creatorId, ...mentionedUserIds].filter(
      (value): value is string => Boolean(value),
    ),
  );

  await insertNotifications(
    [...recipientIds].map((userId) => ({
      actorId: input.actorId,
      issueId: input.issueId,
      type: mentionedUserIds.has(userId) ? ("mentioned" as const) : "comment",
      userId,
    })),
  );
}
