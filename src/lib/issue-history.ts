import { issueHistory, type team } from "@/lib/db/schema";

type TeamSettingsSource = Pick<typeof team.$inferSelect, "settings">;

type IssueHistoryEventType = "created" | "updated" | "comment_created";

type IssueHistoryValues = {
  issueId: string;
  actorId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  eventType: IssueHistoryEventType;
  metadata?: Record<string, unknown>;
};

type IssueHistoryWriter = {
  insert: (table: typeof issueHistory) => {
    values: (values: IssueHistoryValues) => Promise<unknown> | unknown;
  };
};

export function readDetailedHistoryEnabled(settings: unknown) {
  if (settings === null || typeof settings !== "object") {
    return true;
  }

  return (settings as Record<string, unknown>).detailedHistory !== false;
}

export function shouldRecordIssueHistoryEvent(
  eventType: IssueHistoryEventType,
  teamSettings: unknown,
) {
  if (eventType === "updated") {
    return readDetailedHistoryEnabled(teamSettings);
  }

  return true;
}

export async function insertIssueHistoryEvent(
  writer: IssueHistoryWriter,
  teamRecord: TeamSettingsSource,
  values: IssueHistoryValues,
) {
  if (!shouldRecordIssueHistoryEvent(values.eventType, teamRecord.settings)) {
    return false;
  }

  await writer.insert(issueHistory).values({
    ...values,
    metadata: values.metadata ?? {},
  });

  return true;
}
