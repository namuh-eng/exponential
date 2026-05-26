export const RECURRING_CADENCES = ["daily", "weekly", "monthly"] as const;

export type RecurringCadence = (typeof RECURRING_CADENCES)[number];
export type RecurringIssueCadence = RecurringCadence;

export type RecurringIssuePriority =
  | "none"
  | "urgent"
  | "high"
  | "medium"
  | "low";

export type RecurringIssueCadenceConfig = {
  cadence: RecurringCadence;
  interval: number;
};

const VALID_CADENCES = new Set<RecurringCadence>([
  "daily",
  "weekly",
  "monthly",
]);

export function parseDateTimeInput(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function normalizeCadenceConfig(
  input: unknown,
):
  | { config: RecurringIssueCadenceConfig; error: null }
  | { config: null; error: string } {
  const raw = input as { cadence?: unknown; interval?: unknown } | null;
  const cadence = raw?.cadence;
  if (
    typeof cadence !== "string" ||
    !VALID_CADENCES.has(cadence as RecurringCadence)
  ) {
    return { config: null, error: "Choose a valid cadence" };
  }

  const interval = Number(raw?.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) {
    return { config: null, error: "Cadence interval must be between 1 and 52" };
  }

  return {
    config: { cadence: cadence as RecurringCadence, interval },
    error: null,
  };
}

export function computeNextRunAt(
  config: RecurringIssueCadenceConfig,
  startAt: Date,
  now = new Date(),
): Date {
  const next = new Date(startAt);
  if (Number.isNaN(next.getTime())) {
    throw new Error("Invalid start date");
  }

  while (next.getTime() < now.getTime()) {
    if (config.cadence === "daily") {
      next.setDate(next.getDate() + config.interval);
    } else if (config.cadence === "weekly") {
      next.setDate(next.getDate() + config.interval * 7);
    } else {
      next.setMonth(next.getMonth() + config.interval);
    }
  }

  return next;
}

export function formatCadence(config: RecurringIssueCadenceConfig) {
  const unit = config.cadence.slice(0, -2);
  if (config.interval === 1) {
    if (config.cadence === "daily") return "Daily";
    if (config.cadence === "weekly") return "Weekly";
    return "Monthly";
  }

  return `Every ${config.interval} ${config.cadence === "daily" ? "days" : `${unit}s`}`;
}
