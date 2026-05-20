export const RECURRING_CADENCES = ["daily", "weekly", "monthly"] as const;

export type RecurringCadence = (typeof RECURRING_CADENCES)[number];
export type RecurringIssuePriority =
  | "none"
  | "urgent"
  | "high"
  | "medium"
  | "low";

export type RecurringIssueCadenceConfig = {
  cadence: RecurringCadence;
  interval: number;
  startDate: string;
  time: string;
  weekday?: number | null;
  monthDay?: number | null;
};

export type RecurringIssueInput = {
  title?: unknown;
  description?: unknown;
  cadence?: unknown;
  interval?: unknown;
  startDate?: unknown;
  time?: unknown;
  timezone?: unknown;
  enabled?: unknown;
  stateId?: unknown;
  assigneeId?: unknown;
  priority?: unknown;
  labelIds?: unknown;
  projectId?: unknown;
};

const PRIORITIES = new Set<RecurringIssuePriority>([
  "none",
  "urgent",
  "high",
  "medium",
  "low",
]);

function isCadence(value: unknown): value is RecurringCadence {
  return (
    typeof value === "string" &&
    RECURRING_CADENCES.includes(value as RecurringCadence)
  );
}

function isPriority(value: unknown): value is RecurringIssuePriority {
  return (
    typeof value === "string" && PRIORITIES.has(value as RecurringIssuePriority)
  );
}

function normalizeOptionalString(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeInterval(value: unknown) {
  const parsed = Number(value ?? 1);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    throw new Error("Interval must be between 1 and 12");
  }
  return parsed;
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Start date is required");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Start date is invalid");
  }
  return value;
}

function normalizeTime(value: unknown) {
  if (value === undefined || value === null || value === "") return "09:00";
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    throw new Error("Start time is invalid");
  }
  const [hour, minute] = value.split(":").map(Number);
  if (hour > 23 || minute > 59) {
    throw new Error("Start time is invalid");
  }
  return value;
}

function normalizeTimezone(value: unknown) {
  const timezone = typeof value === "string" ? value.trim() : "UTC";
  if (!timezone) return "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new Error("Timezone is invalid");
  }
  return timezone;
}

function combineDateAndTime(startDate: string, time: string) {
  return new Date(`${startDate}T${time}:00.000Z`);
}

function addCadence(date: Date, cadence: RecurringCadence, interval: number) {
  const next = new Date(date);
  if (cadence === "daily") next.setUTCDate(next.getUTCDate() + interval);
  if (cadence === "weekly") next.setUTCDate(next.getUTCDate() + interval * 7);
  if (cadence === "monthly") next.setUTCMonth(next.getUTCMonth() + interval);
  return next;
}

export function computeNextRunAt(
  config: RecurringIssueCadenceConfig,
  from: Date = new Date(),
) {
  let next = combineDateAndTime(config.startDate, config.time);
  while (next.getTime() <= from.getTime()) {
    next = addCadence(next, config.cadence, config.interval);
  }
  return next;
}

export function normalizeRecurringIssueInput(body: RecurringIssueInput) {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) throw new Error("Title is required");

  if (!isCadence(body.cadence)) {
    throw new Error("Cadence is required");
  }

  const interval = normalizeInterval(body.interval);
  const startDate = normalizeDate(body.startDate);
  const time = normalizeTime(body.time);
  const timezone = normalizeTimezone(body.timezone);
  const priority = body.priority ?? "none";
  if (!isPriority(priority)) throw new Error("Priority is invalid");

  const cadenceConfig: RecurringIssueCadenceConfig = {
    cadence: body.cadence,
    interval,
    startDate,
    time,
  };

  if (body.cadence === "weekly") {
    cadenceConfig.weekday = combineDateAndTime(startDate, time).getUTCDay();
  }
  if (body.cadence === "monthly") {
    cadenceConfig.monthDay = combineDateAndTime(startDate, time).getUTCDate();
  }

  const labelIds = Array.isArray(body.labelIds)
    ? body.labelIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  return {
    title,
    description: typeof body.description === "string" ? body.description : "",
    cadenceConfig,
    timezone,
    enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    nextRunAt: computeNextRunAt(cadenceConfig),
    stateId: normalizeOptionalString(body.stateId),
    assigneeId: normalizeOptionalString(body.assigneeId),
    priority,
    labelIds,
    projectId: normalizeOptionalString(body.projectId),
  };
}

export function formatCadence(config: unknown) {
  if (!config || typeof config !== "object") return "Unknown cadence";
  const cadence = (config as { cadence?: unknown }).cadence;
  const interval = (config as { interval?: unknown }).interval;
  if (!isCadence(cadence)) return "Unknown cadence";
  const numericInterval = typeof interval === "number" ? interval : 1;
  if (numericInterval <= 1) return cadence[0].toUpperCase() + cadence.slice(1);
  return `Every ${numericInterval} ${cadence === "daily" ? "days" : cadence === "weekly" ? "weeks" : "months"}`;
}
