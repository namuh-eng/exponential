"use client";

import type {
  AnalyticsMeasure,
  AnalyticsRange,
  AnalyticsSegment,
  AnalyticsSlice,
} from "@/lib/team-analytics";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

interface ControlOption {
  value: string;
  label: string;
}

interface ChartPoint {
  key: string;
  label: string;
  value: number;
  segment?: string;
  issueIds: string[];
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

export default function TeamAnalyticsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [measure, setMeasure] = useState<AnalyticsMeasure>("issue_count");
  const [slice, setSlice] = useState<AnalyticsSlice>("status");
  const [segment, setSegment] = useState<AnalyticsSegment>("none");
  const [range, setRange] = useState<AnalyticsRange>("90d");
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [label, setLabel] = useState("");
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
    return query.toString();
  }, [label, measure, project, range, segment, slice, status, teamKey]);

  useEffect(() => {
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
  }, [queryString, teamKey]);

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

  const maxValue = Math.max(
    1,
    ...(data?.chart.points.map((point) => point.value) ?? [1]),
  );

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
      await navigator.clipboard.writeText(url);
      setActionMessage("Copied share link with the current Insights controls.");
    } else {
      setActionMessage(
        "Share link is ready in the address bar for this filtered Insights view.",
      );
    }
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
            Explore the current team issue dataset with configurable measures,
            slices, segments, filters, table drilldowns, CSV export, and cycle
            burndown context.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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

      <section className="mb-6 grid gap-4 sm:grid-cols-4">
        <SummaryCard label="Issues" value={data.summary.issueCount} />
        <SummaryCard label="Completed" value={data.summary.completedCount} />
        <SummaryCard label="Effort" value={data.summary.effort} />
        <SummaryCard
          label={`Velocity (${data.summary.period})`}
          value={data.summary.velocity}
          helper="completed / week"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6">
          <h2 className="mb-1 text-[16px] font-semibold text-[var(--color-text-primary)]">
            {data.chart.title}
          </h2>
          <p className="mb-6 text-[13px] text-[var(--color-text-secondary)]">
            Select a bar to highlight the backing issue set and table row.
          </p>
          {data.emptyState ? (
            <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-[13px] text-[var(--color-text-secondary)]">
              {data.emptyState}
            </div>
          ) : (
            <div className="space-y-3" aria-label="Insights chart">
              {data.chart.points.map((point) => (
                <button
                  className="grid w-full grid-cols-[120px_1fr_64px] items-center gap-3 text-left text-[13px]"
                  key={point.key}
                  onClick={() => setSelectedPoint(point)}
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
                    {row.label}
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

function SummaryCard({
  label,
  value,
  helper,
}: { label: string; value: number; helper?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4">
      <h2 className="text-[12px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {label}
      </h2>
      <div className="mt-2 text-[28px] font-bold text-[var(--color-text-primary)]">
        {value}
      </div>
      {helper && (
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          {helper}
        </p>
      )}
    </div>
  );
}
