interface CategorizedCycles<T> {
  current: T | null;
  upcoming: T[];
  past: T[];
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}

function buildDateValue(parts: {
  year: number;
  month: number;
  day: number;
}): string {
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}`;
}

export function getUtcDateValue(date: Date | string): string {
  const resolved = typeof date === "string" ? new Date(date) : date;
  return buildDateValue({
    year: resolved.getUTCFullYear(),
    month: resolved.getUTCMonth() + 1,
    day: resolved.getUTCDate(),
  });
}

export function getDateInputValue(
  date: Date = new Date(),
  timeZone?: string,
): string {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const lookup = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    ) as { year: number; month: number; day: number };

    return buildDateValue(lookup);
  }

  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
}

export function parseCycleDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function cycleRangesOverlap(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  return (
    startA.getTime() <= endB.getTime() && startB.getTime() <= endA.getTime()
  );
}

export function categorizeCycles<
  T extends { id: string; startDate: string; endDate: string },
>(
  cycles: T[],
  now: Date = new Date(),
  timeZone?: string,
): CategorizedCycles<T> {
  let current: T | null = null;
  const upcoming: T[] = [];
  const past: T[] = [];
  const today = getDateInputValue(now, timeZone);

  for (const cycle of cycles) {
    const start = getUtcDateValue(cycle.startDate);
    const end = getUtcDateValue(cycle.endDate);

    if (today >= start && today <= end) {
      current = cycle;
    } else if (start > today) {
      upcoming.push(cycle);
    } else {
      past.push(cycle);
    }
  }

  // Sort upcoming by start date ascending
  upcoming.sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );

  // Sort past by end date descending (most recent first)
  past.sort(
    (a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime(),
  );

  return { current, upcoming, past };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatCycleDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}
