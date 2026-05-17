import type {
  issuePriority,
  projectPriority,
  projectStatus,
} from "@/lib/db/schema";

export type ProjectTemplateSettings = {
  defaults: {
    status: (typeof projectStatus.enumValues)[number];
    priority: (typeof projectPriority.enumValues)[number];
    icon?: string | null;
    startDateOffsetDays?: number | null;
    targetDateOffsetDays?: number | null;
  };
  milestones: { name: string; sortOrder: number }[];
  starterIssues: {
    title: string;
    description?: string | null;
    priority: (typeof issuePriority.enumValues)[number];
    estimate?: number | null;
    milestoneName?: string | null;
  }[];
  metadata: Record<string, unknown>;
  archived?: boolean;
};

const PROJECT_STATUSES = [
  "planned",
  "started",
  "paused",
  "completed",
  "canceled",
] as const;
const PROJECT_PRIORITIES = ["none", "urgent", "high", "medium", "low"] as const;
const ISSUE_PRIORITIES = PROJECT_PRIORITIES;

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function offsetDate(days: number | null | undefined): Date | null {
  if (days === null || days === undefined) return null;
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function readProjectTemplateSettings(
  value: unknown,
): ProjectTemplateSettings {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const defaultsSource =
    source.defaults && typeof source.defaults === "object"
      ? (source.defaults as Record<string, unknown>)
      : {};
  const milestonesSource = Array.isArray(source.milestones)
    ? source.milestones
    : [];
  const issuesSource = Array.isArray(source.starterIssues)
    ? source.starterIssues
    : [];
  const metadata =
    source.metadata &&
    typeof source.metadata === "object" &&
    !Array.isArray(source.metadata)
      ? (source.metadata as Record<string, unknown>)
      : {};

  return {
    defaults: {
      status: enumValue(defaultsSource.status, PROJECT_STATUSES, "planned"),
      priority: enumValue(defaultsSource.priority, PROJECT_PRIORITIES, "none"),
      icon:
        typeof defaultsSource.icon === "string" && defaultsSource.icon.trim()
          ? defaultsSource.icon.trim().slice(0, 10)
          : null,
      startDateOffsetDays: nullableInteger(defaultsSource.startDateOffsetDays),
      targetDateOffsetDays: nullableInteger(
        defaultsSource.targetDateOffsetDays,
      ),
    },
    milestones: milestonesSource
      .map((item, index) => {
        const row =
          item && typeof item === "object"
            ? (item as Record<string, unknown>)
            : {};
        const name = typeof row.name === "string" ? row.name.trim() : "";
        return name
          ? {
              name: name.slice(0, 255),
              sortOrder: Number(row.sortOrder ?? index) || index,
            }
          : null;
      })
      .filter((item): item is { name: string; sortOrder: number } =>
        Boolean(item),
      ),
    starterIssues: issuesSource
      .map((item) => {
        const row =
          item && typeof item === "object"
            ? (item as Record<string, unknown>)
            : {};
        const title = typeof row.title === "string" ? row.title.trim() : "";
        if (!title) return null;
        const normalized: ProjectTemplateSettings["starterIssues"][number] = {
          title: title.slice(0, 500),
          description:
            typeof row.description === "string" && row.description.trim()
              ? row.description.trim()
              : null,
          priority: enumValue(row.priority, ISSUE_PRIORITIES, "none"),
          estimate:
            row.estimate === null ||
            row.estimate === undefined ||
            row.estimate === ""
              ? null
              : Number(row.estimate),
          milestoneName:
            typeof row.milestoneName === "string" && row.milestoneName.trim()
              ? row.milestoneName.trim().slice(0, 255)
              : null,
        };
        return normalized;
      })
      .filter(
        (item): item is ProjectTemplateSettings["starterIssues"][number] =>
          Boolean(item),
      ),
    metadata,
    archived: source.archived === true,
  };
}

export function normalizeProjectTemplateSettings(value: unknown) {
  return readProjectTemplateSettings(value);
}

export function projectDatesFromTemplate(settings: ProjectTemplateSettings) {
  return {
    startDate: offsetDate(settings.defaults.startDateOffsetDays),
    targetDate: offsetDate(settings.defaults.targetDateOffsetDays),
  };
}
