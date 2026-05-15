export const ANALYTICS_MEASURES = [
  "issue_count",
  "effort",
  "cycle_time",
  "lead_time",
  "triage_time",
  "issue_age",
] as const;

export const ANALYTICS_SLICES = [
  "status",
  "project",
  "cycle",
  "label",
  "created_week",
] as const;

export const ANALYTICS_SEGMENTS = [
  "none",
  "status",
  "project",
  "label",
] as const;
export const ANALYTICS_RANGES = ["30d", "90d", "180d", "all"] as const;

export type AnalyticsMeasure = (typeof ANALYTICS_MEASURES)[number];
export type AnalyticsSlice = (typeof ANALYTICS_SLICES)[number];
export type AnalyticsSegment = (typeof ANALYTICS_SEGMENTS)[number];
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export interface AnalyticsQuery {
  measure: AnalyticsMeasure;
  slice: AnalyticsSlice;
  segment: AnalyticsSegment;
  range: AnalyticsRange;
  status?: string;
  project?: string;
  team?: string;
  label?: string;
  createdAfter?: string;
  completedAfter?: string;
  issueIds?: string[];
}

export interface AnalyticsIssueRow {
  id: string;
  identifier: string;
  title: string;
  estimate: number | null;
  createdAt: Date | string;
  completedAt: Date | string | null;
  updatedAt: Date | string;
  statusName: string | null;
  statusCategory: string | null;
  projectId: string | null;
  projectName: string | null;
  cycleId: string | null;
  cycleName: string | null;
  cycleNumber: number | null;
  labels: string[];
}

export interface CycleAnalyticsSource {
  id: string;
  name: string;
  total: number;
  completed: number;
  startDate: Date | string;
  endDate: Date | string;
}

export interface ChartPoint {
  key: string;
  label: string;
  value: number;
  segment?: string;
  issueIds: string[];
  drilldown: DrilldownPayload;
}

export interface DrilldownPayload {
  label: string;
  issueIds: string[];
  analyticsKey: string;
}

export interface MetricCard {
  id: string;
  label: string;
  value: number;
  helper: string;
  delta: number;
  deltaLabel: string;
  issueIds: string[];
  drilldown: DrilldownPayload;
}

export interface TrendPoint {
  key: string;
  label: string;
  created: number;
  completed: number;
  active: number;
  issueIds: string[];
  drilldown: DrilldownPayload;
}

export interface TableRow extends ChartPoint {
  count: number;
  completed: number;
  effort: number;
}

export interface CycleBurndownPoint {
  label: string;
  scope: number;
  target: number;
  started: number;
  completed: number;
}

export interface CycleMetric {
  id: string;
  name: string;
  total: number;
  completed: number;
  percentage: number;
  burndown: CycleBurndownPoint[];
}

const measureLabels: Record<AnalyticsMeasure, string> = {
  issue_count: "Issue count",
  effort: "Effort",
  cycle_time: "Cycle time",
  lead_time: "Lead time",
  triage_time: "Triage time",
  issue_age: "Issue age",
};

const sliceLabels: Record<AnalyticsSlice, string> = {
  status: "Status",
  project: "Project",
  cycle: "Cycle",
  label: "Label",
  created_week: "Created week",
};

function firstValid<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function normalizeAnalyticsQuery(
  searchParams: URLSearchParams,
): AnalyticsQuery {
  return {
    measure: firstValid(
      searchParams.get("measure"),
      ANALYTICS_MEASURES,
      "issue_count",
    ),
    slice: firstValid(searchParams.get("slice"), ANALYTICS_SLICES, "status"),
    segment: firstValid(
      searchParams.get("segment"),
      ANALYTICS_SEGMENTS,
      "none",
    ),
    range: firstValid(searchParams.get("range"), ANALYTICS_RANGES, "90d"),
    status: searchParams.get("status") || undefined,
    project: searchParams.get("project") || undefined,
    team: searchParams.get("team") || undefined,
    label: searchParams.get("label") || undefined,
    createdAfter: searchParams.get("createdAfter") || undefined,
    completedAfter: searchParams.get("completedAfter") || undefined,
    issueIds: searchParams
      .get("issueIds")
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function dateValue(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function daysBetween(start: Date | string | null, end: Date | string | null) {
  const startDate = dateValue(start);
  const endDate = dateValue(end) ?? new Date();
  if (!startDate) return 0;
  return Math.max(
    0,
    Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000),
  );
}

function weekLabel(value: Date | string) {
  const date = dateValue(value) ?? new Date();
  const week = new Date(date);
  week.setDate(date.getDate() - date.getDay());
  return week.toISOString().slice(0, 10);
}

function sliceIssue(issue: AnalyticsIssueRow, slice: AnalyticsSlice) {
  if (slice === "status") return issue.statusName ?? "No status";
  if (slice === "project") return issue.projectName ?? "No project";
  if (slice === "cycle")
    return (
      issue.cycleName ??
      (issue.cycleNumber ? `Cycle ${issue.cycleNumber}` : "No cycle")
    );
  if (slice === "label") return issue.labels[0] ?? "No label";
  return weekLabel(issue.createdAt);
}

function segmentIssue(issue: AnalyticsIssueRow, segment: AnalyticsSegment) {
  if (segment === "none") return undefined;
  if (segment === "status") return issue.statusName ?? "No status";
  if (segment === "project") return issue.projectName ?? "No project";
  return issue.labels[0] ?? "No label";
}

function measureIssue(issue: AnalyticsIssueRow, measure: AnalyticsMeasure) {
  if (measure === "effort") return issue.estimate ?? 0;
  if (measure === "cycle_time")
    return issue.completedAt
      ? daysBetween(issue.updatedAt, issue.completedAt)
      : 0;
  if (measure === "lead_time")
    return issue.completedAt
      ? daysBetween(issue.createdAt, issue.completedAt)
      : 0;
  if (measure === "triage_time")
    return Math.min(daysBetween(issue.createdAt, issue.updatedAt), 14);
  if (measure === "issue_age")
    return issue.completedAt ? 0 : daysBetween(issue.createdAt, null);
  return 1;
}

function rangeDays(range: AnalyticsRange) {
  if (range === "all") return null;
  return range === "30d" ? 30 : range === "180d" ? 180 : 90;
}

function rangeStart(range: AnalyticsRange) {
  const days = rangeDays(range);
  if (!days) return null;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function shortDateLabel(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function drilldown(
  label: string,
  analyticsKey: string,
  issueIds: string[],
): DrilldownPayload {
  return { label, analyticsKey, issueIds };
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
    ) / 10
  );
}

function buildMetricCards(
  issues: AnalyticsIssueRow[],
  query: AnalyticsQuery,
): MetricCard[] {
  const days = rangeDays(query.range);
  const now = new Date();
  const currentStart = rangeStart(query.range);
  const previousStart = days && currentStart ? new Date(currentStart) : null;
  if (previousStart && days)
    previousStart.setDate(previousStart.getDate() - days);

  const completed = issues.filter((issue) => issue.completedAt);
  const completedCurrent = completed.filter((issue) => {
    const completedAt = dateValue(issue.completedAt);
    return !currentStart || (completedAt && completedAt >= currentStart);
  });
  const completedPrevious = completed.filter((issue) => {
    const completedAt = dateValue(issue.completedAt);
    return Boolean(
      previousStart &&
        currentStart &&
        completedAt &&
        completedAt >= previousStart &&
        completedAt < currentStart,
    );
  });
  const active = issues.filter((issue) =>
    ["started", "unstarted"].includes(issue.statusCategory ?? ""),
  );
  const backlog = issues.filter((issue) => issue.statusCategory === "backlog");
  const cycleTimes = completedCurrent.map((issue) =>
    daysBetween(issue.updatedAt, issue.completedAt),
  );
  const previousCycleTimes = completedPrevious.map((issue) =>
    daysBetween(issue.updatedAt, issue.completedAt),
  );
  const completionRate =
    issues.length > 0
      ? Math.round((completedCurrent.length / issues.length) * 100)
      : 0;
  const previousCompletionRate =
    issues.length > 0
      ? Math.round((completedPrevious.length / issues.length) * 100)
      : 0;

  return [
    {
      id: "throughput",
      label: "Throughput",
      value: completedCurrent.length,
      helper: `completed in ${query.range === "all" ? "all time" : `last ${query.range.replace("d", " days")}`}`,
      delta: completedCurrent.length - completedPrevious.length,
      deltaLabel: "vs previous period",
      issueIds: completedCurrent.map((issue) => issue.id),
      drilldown: drilldown(
        "Completed throughput",
        "metric:throughput",
        completedCurrent.map((issue) => issue.id),
      ),
    },
    {
      id: "cycle_time",
      label: "Cycle time",
      value: average(cycleTimes),
      helper: "avg days from start to done",
      delta:
        Math.round((average(cycleTimes) - average(previousCycleTimes)) * 10) /
        10,
      deltaLabel: "days vs previous",
      issueIds: completedCurrent.map((issue) => issue.id),
      drilldown: drilldown(
        "Cycle time issues",
        "metric:cycle_time",
        completedCurrent.map((issue) => issue.id),
      ),
    },
    {
      id: "workload",
      label: "Workload",
      value: active.length,
      helper: "started or unstarted issues",
      delta: active.length - backlog.length,
      deltaLabel: "active minus backlog",
      issueIds: active.map((issue) => issue.id),
      drilldown: drilldown(
        "Active workload",
        "metric:workload",
        active.map((issue) => issue.id),
      ),
    },
    {
      id: "completion_rate",
      label: "Completion rate",
      value: completionRate,
      helper: "% of matching issues completed",
      delta: completionRate - previousCompletionRate,
      deltaLabel: "points vs previous",
      issueIds: completedCurrent.map((issue) => issue.id),
      drilldown: drilldown(
        "Completion rate",
        "metric:completion_rate",
        completedCurrent.map((issue) => issue.id),
      ),
    },
  ];
}

function buildTrendPoints(
  issues: AnalyticsIssueRow[],
  query: AnalyticsQuery,
): TrendPoint[] {
  const days = rangeDays(query.range) ?? 180;
  const bucketCount =
    query.range === "30d" ? 6 : query.range === "90d" ? 9 : 12;
  const bucketDays = Math.max(1, Math.ceil(days / bucketCount));
  const start =
    rangeStart(query.range) ??
    (() => {
      const oldest = issues
        .map((issue) => dateValue(issue.createdAt))
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => a.getTime() - b.getTime())[0];
      return oldest ?? new Date();
    })();
  const points: TrendPoint[] = [];

  for (let index = 0; index < bucketCount; index += 1) {
    const bucketStart = new Date(start);
    bucketStart.setDate(start.getDate() + index * bucketDays);
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setDate(bucketStart.getDate() + bucketDays);
    const bucketIssues = issues.filter((issue) => {
      const createdAt = dateValue(issue.createdAt);
      const completedAt = dateValue(issue.completedAt);
      return Boolean(
        (createdAt && createdAt >= bucketStart && createdAt < bucketEnd) ||
          (completedAt &&
            completedAt >= bucketStart &&
            completedAt < bucketEnd),
      );
    });
    points.push({
      key: bucketStart.toISOString().slice(0, 10),
      label: shortDateLabel(bucketStart),
      created: bucketIssues.filter((issue) => {
        const createdAt = dateValue(issue.createdAt);
        return Boolean(
          createdAt && createdAt >= bucketStart && createdAt < bucketEnd,
        );
      }).length,
      completed: bucketIssues.filter((issue) => {
        const completedAt = dateValue(issue.completedAt);
        return Boolean(
          completedAt && completedAt >= bucketStart && completedAt < bucketEnd,
        );
      }).length,
      active: issues.filter((issue) => {
        const createdAt = dateValue(issue.createdAt);
        const completedAt = dateValue(issue.completedAt);
        return Boolean(
          createdAt &&
            createdAt < bucketEnd &&
            (!completedAt || completedAt >= bucketStart),
        );
      }).length,
      issueIds: bucketIssues.map((issue) => issue.id),
      drilldown: drilldown(
        `Trend bucket ${shortDateLabel(bucketStart)}`,
        `trend:${bucketStart.toISOString().slice(0, 10)}`,
        bucketIssues.map((issue) => issue.id),
      ),
    });
  }

  const now = new Date();
  return points.filter((point) => new Date(point.key) <= now);
}

export function filterAnalyticsIssues(
  issues: AnalyticsIssueRow[],
  query: AnalyticsQuery,
) {
  const start = rangeStart(query.range);
  const createdAfter = query.createdAfter
    ? dateValue(query.createdAfter)
    : null;
  const completedAfter = query.completedAfter
    ? dateValue(query.completedAfter)
    : null;
  return issues.filter((issue) => {
    if (query.issueIds?.length && !query.issueIds.includes(issue.id))
      return false;
    const createdAt = dateValue(issue.createdAt);
    const completedAt = dateValue(issue.completedAt);
    if (
      start &&
      createdAt &&
      createdAt < start &&
      (!completedAt || completedAt < start)
    )
      return false;
    if (createdAfter && createdAt && createdAt < createdAfter) return false;
    if (completedAfter && (!completedAt || completedAt < completedAfter))
      return false;
    if (
      query.status &&
      issue.statusCategory !== query.status &&
      issue.statusName !== query.status
    )
      return false;
    if (
      query.project &&
      issue.projectId !== query.project &&
      issue.projectName !== query.project
    )
      return false;
    if (query.label && !issue.labels.includes(query.label)) return false;
    return true;
  });
}

export function buildCycleMetrics(
  cycles: CycleAnalyticsSource[],
): CycleMetric[] {
  return cycles.map((cycle) => {
    const percentage =
      cycle.total > 0 ? Math.round((cycle.completed / cycle.total) * 100) : 0;
    const targetStep = cycle.total / 3;
    return {
      id: cycle.id,
      name: cycle.name,
      total: cycle.total,
      completed: cycle.completed,
      percentage,
      burndown: [
        {
          label: "Start",
          scope: cycle.total,
          target: cycle.total,
          started: 0,
          completed: 0,
        },
        {
          label: "Mid",
          scope: cycle.total,
          target: Math.max(0, Math.round(cycle.total - targetStep)),
          started: Math.max(0, cycle.total - cycle.completed),
          completed: Math.round(cycle.completed / 2),
        },
        {
          label: "Now",
          scope: cycle.total,
          target: 0,
          started: Math.max(0, cycle.total - cycle.completed),
          completed: cycle.completed,
        },
      ],
    };
  });
}

export function buildAnalyticsResponse(input: {
  team: { id: string; name: string; key?: string };
  query: AnalyticsQuery;
  issues: AnalyticsIssueRow[];
  cycles: CycleAnalyticsSource[];
}) {
  const filteredIssues = filterAnalyticsIssues(input.issues, input.query);
  const buckets = new Map<string, TableRow>();

  for (const issue of filteredIssues) {
    const label = sliceIssue(issue, input.query.slice);
    const segment = segmentIssue(issue, input.query.segment);
    const key = segment ? `${label}::${segment}` : label;
    const existing = buckets.get(key) ?? {
      key,
      label,
      segment,
      value: 0,
      issueIds: [],
      drilldown: drilldown(
        `${label}${segment ? ` / ${segment}` : ""}`,
        `bucket:${key}`,
        [],
      ),
      count: 0,
      completed: 0,
      effort: 0,
    };
    const value = measureIssue(issue, input.query.measure);
    existing.value += value;
    existing.count += 1;
    existing.completed += issue.completedAt ? 1 : 0;
    existing.effort += issue.estimate ?? 0;
    existing.issueIds.push(issue.id);
    existing.drilldown = drilldown(
      `${label}${segment ? ` / ${segment}` : ""}`,
      `bucket:${key}`,
      existing.issueIds,
    );
    buckets.set(key, existing);
  }

  const tableRows = [...buckets.values()]
    .map((row) => ({
      ...row,
      value: Math.round(row.value * 10) / 10,
      effort: Math.round(row.effort * 10) / 10,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const completedLast28Days = filteredIssues.filter((issue) => {
    const completedAt = dateValue(issue.completedAt);
    if (!completedAt) return false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 28);
    return completedAt >= cutoff;
  }).length;

  const cycleMetrics = buildCycleMetrics(input.cycles);

  return {
    team: input.team,
    query: input.query,
    controls: {
      measures: ANALYTICS_MEASURES.map((value) => ({
        value,
        label: measureLabels[value],
      })),
      slices: ANALYTICS_SLICES.map((value) => ({
        value,
        label: sliceLabels[value],
      })),
      segments: ANALYTICS_SEGMENTS.map((value) => ({
        value,
        label: value === "none" ? "No segment" : sliceLabels[value],
      })),
      ranges: [
        { value: "30d", label: "Last 30 days" },
        { value: "90d", label: "Last 90 days" },
        { value: "180d", label: "Last 180 days" },
        { value: "all", label: "All time" },
      ],
    },
    filters: {
      statuses: [
        ...new Set(
          input.issues.map((issue) => issue.statusCategory).filter(Boolean),
        ),
      ],
      projects: [
        ...new Map(
          input.issues
            .filter((issue) => issue.projectId)
            .map((issue) => [
              issue.projectId,
              {
                id: issue.projectId,
                name: issue.projectName ?? "Unnamed project",
              },
            ]),
        ).values(),
      ],
      teams: [
        { id: input.team.id, key: input.team.key, name: input.team.name },
      ],
      labels: [...new Set(input.issues.flatMap((issue) => issue.labels))],
    },
    summary: {
      issueCount: filteredIssues.length,
      completedCount: filteredIssues.filter((issue) => issue.completedAt)
        .length,
      effort:
        Math.round(
          filteredIssues.reduce(
            (sum, issue) => sum + (issue.estimate ?? 0),
            0,
          ) * 10,
        ) / 10,
      velocity: Math.round(completedLast28Days / 4),
      period:
        input.query.range === "all"
          ? "All time"
          : `Last ${input.query.range.replace("d", " days")}`,
    },
    chart: {
      title: `${measureLabels[input.query.measure]} by ${sliceLabels[input.query.slice]}`,
      points: tableRows.map(
        ({
          key,
          label,
          value,
          segment,
          issueIds,
          drilldown: rowDrilldown,
        }) => ({
          key,
          label,
          value,
          segment,
          issueIds,
          drilldown: rowDrilldown,
        }),
      ),
    },
    metricCards: buildMetricCards(filteredIssues, input.query),
    trend: {
      title: "Created, completed, and active issues over time",
      points: buildTrendPoints(filteredIssues, input.query),
    },
    tableRows,
    cycleMetrics,
    emptyState:
      filteredIssues.length === 0
        ? "No issues match these analytics filters. Broaden the date, status, project, or label filters to build an Insights chart."
        : null,
    actions: {
      csv: { enabled: true, label: "Export CSV" },
      share: { enabled: true, label: "Copy share link" },
      fullscreen: { enabled: true, label: "Full screen" },
    },
  };
}
