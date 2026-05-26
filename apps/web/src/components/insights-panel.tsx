"use client";

import type {
  AnalyticsMeasure,
  AnalyticsRange,
  AnalyticsSegment,
  AnalyticsSlice,
} from "@/lib/team-analytics";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

interface ControlOption {
  value: string;
  label: string;
}

interface DrilldownPayload {
  label: string;
  issueIds: string[];
  analyticsKey: string;
}

interface ChartPoint {
  key: string;
  label: string;
  value: number;
  segment?: string;
  issueIds: string[];
  drilldown: DrilldownPayload;
}

interface MetricCardData {
  id: string;
  label: string;
  value: number;
  helper: string;
  delta: number;
  deltaLabel: string;
  issueIds: string[];
  drilldown: DrilldownPayload;
}

interface TrendPoint {
  key: string;
  label: string;
  created: number;
  completed: number;
  active: number;
  issueIds: string[];
  drilldown: DrilldownPayload;
}

interface TableRow extends ChartPoint {
  count: number;
  completed: number;
  effort: number;
}

interface CycleMetric {
  id: string;
  name: string;
  total: number;
  completed: number;
  percentage: number;
  burndown: Array<{
    label: string;
    scope: number;
    target: number;
    started: number;
    completed: number;
  }>;
}

interface AnalyticsData {
  team: { id: string; key?: string; name: string };
  query: {
    measure: AnalyticsMeasure;
    slice: AnalyticsSlice;
    segment: AnalyticsSegment;
    range: AnalyticsRange;
    status?: string;
    project?: string;
    team?: string;
    label?: string;
  };
  controls: {
    measures: ControlOption[];
    slices: ControlOption[];
    segments: ControlOption[];
    ranges: ControlOption[];
  };
  filters: {
    statuses: string[];
    projects: Array<{ id: string; name: string }>;
    teams: Array<{ id: string; key?: string; name: string }>;
    labels: string[];
  };
  summary: {
    issueCount: number;
    completedCount: number;
    effort: number;
    velocity: number;
    period: string;
  };
  chart: { title: string; points: ChartPoint[] };
  metricCards: MetricCardData[];
  trend: { title: string; points: TrendPoint[] };
  tableRows: TableRow[];
  cycleMetrics: CycleMetric[];
  emptyState: string | null;
  actions: {
    csv: { enabled: boolean; label: string };
    share: { enabled: boolean; label: string };
    fullscreen: { enabled: boolean; label: string };
  };
}

const selectClass =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]";

export interface InsightsPanelProps {
  teamKey: string;
  mode?: "page" | "drawer";
  open?: boolean;
  onClose?: () => void;
  scopedIssueIds?: string[];
  contextLabel?: string;
}

export function InsightsPanel({
  teamKey,
  mode = "page",
  open = true,
  onClose,
  scopedIssueIds = [],
  contextLabel,
}: InsightsPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [measure, setMeasure] = useState<AnalyticsMeasure>(
    (searchParams.get("measure") as AnalyticsMeasure) || "issue_count",
  );
  const [slice, setSlice] = useState<AnalyticsSlice>(
    (searchParams.get("slice") as AnalyticsSlice) || "status",
  );
  const [segment, setSegment] = useState<AnalyticsSegment>(
    (searchParams.get("segment") as AnalyticsSegment) || "none",
  );
  const [range, setRange] = useState<AnalyticsRange>(
    (searchParams.get("range") as AnalyticsRange) || "90d",
  );
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [project, setProject] = useState(searchParams.get("project") || "");
  const [label, setLabel] = useState(searchParams.get("label") || "");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const [selectedPoint, setSelectedPoint] = useState<ChartPoint | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [actionMessage, setActionMessage] = useState("");

  const queryString = useMemo(() => {
    const query = new URLSearchParams({
      measure,
      slice,
      segment,
      range,
      team: teamKey,
    });
    if (status) query.set("status", status);
    if (project) query.set("project", project);
    if (label) query.set("label", label);
    if (scopedIssueIds.length > 0) {
      query.set("issueIds", scopedIssueIds.join(","));
    } else if (mode === "drawer") {
      query.set("issueIds", "__empty_view__");
    }
    return query.toString();
  }, [
    label,
    measure,
    project,
    range,
    scopedIssueIds,
    mode,
    segment,
    slice,
    status,
    teamKey,
  ]);

  useEffect(() => {
    if (!open || mode !== "page") return;
    const current = searchParams.toString();
    if (current !== queryString) {
      router.replace(`${pathname}?${queryString}`, { scroll: false });
    }
  }, [mode, open, pathname, queryString, router, searchParams]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (!hasLoadedRef.current) setLoading(true);
    fetch(`/api/teams/${teamKey}/analytics?${queryString}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load analytics");
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) {
          hasLoadedRef.current = true;
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, queryString, teamKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "i"
      ) {
        event.preventDefault();
        const builder = document.getElementById("team-insights-builder");
        if (typeof builder?.scrollIntoView === "function") {
          builder.scrollIntoView({ behavior: "smooth" });
        }
        setActionMessage("Insights panel opened for the current team view.");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) return null;

  const maxValue = Math.max(
    1,
    ...(data?.chart.points.map((point) => point.value) ?? [1]),
  );
  const maxTrendValue = Math.max(
    1,
    ...(data?.trend.points.flatMap((point) => [
      point.created,
      point.completed,
      point.active,
    ]) ?? [1]),
  );

  function drilldownUrl(drilldown: DrilldownPayload) {
    const basePath = pathname.replace(/\/(analytics|insights)\/?$/, "");
    const query = new URLSearchParams();
    query.set("insight", drilldown.analyticsKey);
    query.set("insightLabel", drilldown.label);
    if (drilldown.issueIds.length > 0) {
      query.set("issueIds", drilldown.issueIds.join(","));
    }
    if (status) query.set("status", status);
    if (project) query.set("project", project);
    if (label) query.set("label", label);
    return `${basePath}/all?${query.toString()}`;
  }

  function openDrilldown(drilldown: DrilldownPayload) {
    const url = drilldownUrl(drilldown);
    if (mode === "page") {
      router.push(url);
    } else {
      setActionMessage(
        `Drilldown ready: ${drilldown.label} (${drilldown.issueIds.length} issues).`,
      );
    }
  }

  function exportCsv() {
    if (!data) return;
    const rows = [
      ["Slice", "Segment", "Value", "Issues", "Completed", "Effort"],
      ...data.tableRows.map((row) => [
        row.label,
        row.segment ?? "",
        String(row.value),
        String(row.count),
        String(row.completed),
        String(row.effort),
      ]),
    ];
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    link.download = `${teamKey}-insights.csv`;
    if (navigator.userAgent && !navigator.userAgent.includes("jsdom")) {
      link.click();
    }
    setActionMessage("Exported Insights CSV for the current filters.");
  }

  async function shareLink() {
    const url = `${window.location.pathname}?${queryString}`;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        setActionMessage(
          "Copied share link with the current Insights controls.",
        );
        return;
      } catch {
        // Browser automation and hardened workspaces can deny clipboard writes.
      }
    }
    setActionMessage(
      "Share link is ready in the address bar for this filtered Insights view.",
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading analytics...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Team not found or analytics could not be loaded.
      </div>
    );
  }

  return (
    <div
      className={
        fullScreen
          ? "fixed inset-0 z-50 overflow-auto bg-[var(--color-bg)] p-8"
          : mode === "drawer"
            ? "fixed inset-y-0 right-0 z-40 w-full max-w-[980px] overflow-auto border-l border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-2xl"
            : "p-8 max-w-[1180px] mx-auto"
      }
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
            Linear Insights
          </p>
          <h1 className="text-[24px] font-semibold text-[var(--color-text-primary)]">
            {data.team.name} Analytics
          </h1>
          <p className="mt-2 max-w-[720px] text-[13px] text-[var(--color-text-secondary)]">
            {contextLabel
              ? `Review Linear-style analytics for the current ${contextLabel} issue set with trend cards, workload flow, shareable controls, and drilldowns into backing issues.`
              : "Review team throughput, cycle time, workload, completion trends, saved/shareable controls, and drilldowns into the backing issue set."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mode === "drawer" && (
            <button
              aria-label="Close Insights"
              className="rounded-md border border-[var(--color-border)] px-3 py-2 text-[13px]"
              onClick={onClose}
              type="button"
            >
              Close
            </button>
          )}
          <button
            className="rounded-md border border-[var(--color-border)] px-3 py-2 text-[13px]"
            onClick={exportCsv}
            type="button"
          >
            {data.actions.csv.label}
          </button>
          <button
            className="rounded-md border border-[var(--color-border)] px-3 py-2 text-[13px]"
            onClick={shareLink}
            type="button"
          >
            {data.actions.share.label}
          </button>
          <button
            className="rounded-md border border-[var(--color-border)] px-3 py-2 text-[13px]"
            onClick={() => setFullScreen((value) => !value)}
            type="button"
          >
            {fullScreen ? "Exit full screen" : data.actions.fullscreen.label}
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
          {actionMessage}
        </div>
      )}

      <section
        className="mb-6 grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4"
        id="team-insights-builder"
      >
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Measure
            <select
              className={selectClass}
              onChange={(event) =>
                setMeasure(event.target.value as AnalyticsMeasure)
              }
              value={measure}
            >
              {data.controls.measures.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Slice
            <select
              className={selectClass}
              onChange={(event) =>
                setSlice(event.target.value as AnalyticsSlice)
              }
              value={slice}
            >
              {data.controls.slices.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Segment
            <select
              className={selectClass}
              onChange={(event) =>
                setSegment(event.target.value as AnalyticsSegment)
              }
              value={segment}
            >
              {data.controls.segments.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Date range
            <select
              className={selectClass}
              onChange={(event) =>
                setRange(event.target.value as AnalyticsRange)
              }
              value={range}
            >
              {data.controls.ranges.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Status type
            <select
              className={selectClass}
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="">Any status</option>
              {data.filters.statuses.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Project
            <select
              className={selectClass}
              onChange={(event) => setProject(event.target.value)}
              value={project}
            >
              <option value="">Any project</option>
              {data.filters.projects.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Team
            <select className={selectClass} disabled value={data.team.id}>
              {data.filters.teams.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Label
            <select
              className={selectClass}
              onChange={(event) => setLabel(event.target.value)}
              value={label}
            >
              <option value="">Any label</option>
              {data.filters.labels.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section
        className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Insights metric cards"
      >
        {data.metricCards.map((card) => (
          <MetricCard
            data={card}
            key={card.id}
            onOpen={() => openDrilldown(card.drilldown)}
          />
        ))}
      </section>

      <section
        className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6"
        aria-label="Insights trend chart"
      >
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
              {data.trend.title}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Click a time bucket to open the exact issue set behind the
              created, completed, and active work signals.
            </p>
          </div>
          <div className="flex gap-3 text-[12px] text-[var(--color-text-secondary)]">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[#5E6AD2]" /> Created
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[#22C55E]" /> Completed
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-[#F59E0B]" /> Active
            </span>
          </div>
        </div>
        {data.emptyState ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-[13px] text-[var(--color-text-secondary)]">
            {data.emptyState} Create or complete issues to populate throughput
            and workload trend lines.
          </div>
        ) : (
          <div className="grid min-h-[220px] grid-cols-[repeat(auto-fit,minmax(72px,1fr))] items-end gap-3">
            {data.trend.points.map((point) => (
              <button
                aria-label={`Open drilldown for ${point.label}`}
                className="group flex h-full min-h-[190px] flex-col justify-end gap-2 rounded-lg border border-transparent p-2 text-left hover:border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                key={point.key}
                onClick={() => openDrilldown(point.drilldown)}
                type="button"
              >
                <div className="flex h-36 items-end gap-1">
                  <span
                    className="w-3 rounded-t bg-[#5E6AD2]"
                    style={{
                      height: `${Math.max(5, (point.created / maxTrendValue) * 100)}%`,
                    }}
                  />
                  <span
                    className="w-3 rounded-t bg-[#22C55E]"
                    style={{
                      height: `${Math.max(5, (point.completed / maxTrendValue) * 100)}%`,
                    }}
                  />
                  <span
                    className="w-3 rounded-t bg-[#F59E0B]"
                    style={{
                      height: `${Math.max(5, (point.active / maxTrendValue) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-[12px] font-medium text-[var(--color-text-primary)]">
                  {point.label}
                </span>
                <span className="text-[11px] text-[var(--color-text-secondary)]">
                  {point.issueIds.length} issues
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6">
          <h2 className="mb-1 text-[16px] font-semibold text-[var(--color-text-primary)]">
            {data.chart.title}
          </h2>
          <p className="mb-6 text-[13px] text-[var(--color-text-secondary)]">
            Select a bar to open the backing issue drilldown with the current
            Insights filters preserved.
          </p>
          {data.emptyState ? (
            <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-[13px] text-[var(--color-text-secondary)]">
              {mode === "drawer"
                ? "No chart buckets match this issue set. Broaden the current view filters to build an Insights chart."
                : data.emptyState}
            </div>
          ) : (
            <div className="space-y-3" aria-label="Insights chart">
              {data.chart.points.map((point) => (
                <button
                  className="grid w-full grid-cols-[120px_1fr_64px] items-center gap-3 text-left text-[13px]"
                  key={point.key}
                  onClick={() => openDrilldown(point.drilldown)}
                  type="button"
                >
                  <span className="truncate text-[var(--color-text-secondary)]">
                    {point.label}
                    {point.segment ? ` / ${point.segment}` : ""}
                  </span>
                  <span className="h-7 overflow-hidden rounded-full bg-[var(--color-border)]">
                    <span
                      className="block h-full rounded-full bg-[var(--color-accent)]"
                      style={{
                        width: `${Math.max(4, (point.value / maxValue) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="font-medium text-[var(--color-text-primary)]">
                    {point.value}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6">
          <h2 className="mb-4 text-[16px] font-semibold text-[var(--color-text-primary)]">
            Cycle graph / burndown
          </h2>
          <div className="space-y-5">
            {data.cycleMetrics.map((metric) => (
              <div key={metric.id}>
                <div className="mb-2 flex justify-between text-[13px]">
                  <span className="font-medium text-[var(--color-text-primary)]">
                    {metric.name}
                  </span>
                  <span className="text-[var(--color-text-secondary)]">
                    {metric.completed} / {metric.total} ({metric.percentage}%)
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {metric.burndown.map((point) => (
                    <div
                      className="rounded-md border border-[var(--color-border)] p-2 text-[11px] text-[var(--color-text-secondary)]"
                      key={point.label}
                    >
                      <div className="font-medium text-[var(--color-text-primary)]">
                        {point.label}
                      </div>
                      <div>Scope {point.scope}</div>
                      <div>Target {point.target}</div>
                      <div>Started {point.started}</div>
                      <div>Completed {point.completed}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {data.cycleMetrics.length === 0 && (
              <p className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-center text-[13px] text-[var(--color-text-secondary)]">
                No cycle data is available yet. Enable cycles or assign issues
                to a cycle to populate scope, target, started, and completed
                burndown lines.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
            Backing table
          </h2>
          {selectedPoint && (
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Highlighted {selectedPoint.issueIds.length} issues for{" "}
              {selectedPoint.label}.
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[12px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
              <tr>
                <th className="py-2">Slice</th>
                <th>Segment</th>
                <th>Value</th>
                <th>Issues</th>
                <th>Completed</th>
                <th>Effort</th>
              </tr>
            </thead>
            <tbody>
              {data.tableRows.map((row) => (
                <tr
                  className={
                    selectedPoint?.key === row.key
                      ? "bg-[var(--color-selected-bg)]"
                      : ""
                  }
                  key={row.key}
                >
                  <td className="border-t border-[var(--color-border)] py-2">
                    <button
                      className="font-medium text-[#5E6AD2] hover:text-[#7a84dd]"
                      onClick={() => openDrilldown(row.drilldown)}
                      type="button"
                    >
                      {row.label}
                    </button>
                  </td>
                  <td className="border-t border-[var(--color-border)]">
                    {row.segment ?? "—"}
                  </td>
                  <td className="border-t border-[var(--color-border)]">
                    {row.value}
                  </td>
                  <td className="border-t border-[var(--color-border)]">
                    {row.count}
                  </td>
                  <td className="border-t border-[var(--color-border)]">
                    {row.completed}
                  </td>
                  <td className="border-t border-[var(--color-border)]">
                    {row.effort}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  data,
  onOpen,
}: { data: MetricCardData; onOpen: () => void }) {
  const deltaPrefix = data.delta > 0 ? "+" : "";
  return (
    <button
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4 text-left transition hover:border-[#5E6AD2] hover:bg-[var(--color-surface-hover)]"
      onClick={onOpen}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[12px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
          {data.label}
        </h2>
        <span className="rounded-full bg-[var(--color-surface-hover)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
          Drilldown
        </span>
      </div>
      <div className="mt-2 text-[30px] font-bold text-[var(--color-text-primary)]">
        {data.value}
      </div>
      <p className="text-[12px] text-[var(--color-text-secondary)]">
        {data.helper}
      </p>
      <p className="mt-3 text-[12px] text-[var(--color-text-secondary)]">
        <span
          className={
            data.delta >= 0
              ? "font-medium text-[#22C55E]"
              : "font-medium text-[#EF4444]"
          }
        >
          {deltaPrefix}
          {data.delta}
        </span>{" "}
        {data.deltaLabel}
      </p>
    </button>
  );
}
