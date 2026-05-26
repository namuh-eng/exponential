"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { ContextualInsights } from "@/components/contextual-insights";
import { CreateIssueModal } from "@/components/create-issue-modal";
import { CycleProgressBar } from "@/components/cycle-progress-bar";
import {
  DisplayOptionsPanel,
  type DisplayProperties,
} from "@/components/display-options-panel";
import { EmptyState } from "@/components/empty-state";
import {
  FilterBar,
  type FilterCondition,
  applyFilters,
} from "@/components/filter-bar";
import { IssueRow, priorityMap } from "@/components/issue-row";
import { IssuesGroupHeader } from "@/components/issues-group-header";
import { useDisplayOptions } from "@/hooks/use-display-options";
import { useFilters } from "@/hooks/use-filters";
import { formatCycleDate } from "@/lib/cycle-utils";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { useParams, useRouter } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

interface IssueData {
  id: string;
  number: number;
  identifier: string;
  title: string;
  priority: string;
  stateId: string;
  assigneeId: string | null;
  assignee: { name: string; image?: string | null } | null;
  creatorId?: string | null;
  labels: { id?: string; name: string; color: string }[];
  labelIds: string[];
  projectId: string | null;
  projectName?: string | null;
  cycleId?: string | null;
  cycleName?: string | null;
  estimate?: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt?: string;
  teamId?: string | null;
}

interface StateGroup {
  state: {
    id: string;
    name: string;
    category: string;
    color: string;
    position: number;
  };
  issues: IssueData[];
}

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

interface FilterOptions {
  statuses: { id: string; name: string; category: string; color: string }[];
  assignees: { id: string; name: string; image?: string | null }[];
  labels: { id: string; name: string; color: string }[];
  projects: { id: string; name: string }[];
  creators: { id: string; name: string }[];
  cycles: { id: string; name: string }[];
  estimates: { value: string; label: string }[];
  dueDates: { value: string; label: string }[];
  priorities: { value: string; label: string }[];
  teams?: { id: string; name: string }[];
}

interface CycleDetailResponse {
  team: { id: string; name: string; key: string };
  cycle: {
    id: string;
    name: string | null;
    number: number;
    startDate: string;
    endDate: string;
    autoRollover?: boolean | null;
    issueCount: number;
    completedIssueCount: number;
  };
  groups: StateGroup[];
  filterOptions?: FilterOptions;
}

function toDateInputValue(value: string): string {
  if (!value) return "";
  return value.includes("T") ? (value.split("T")[0] ?? value) : value;
}

function sortIssues(issues: IssueData[], orderBy: string): IssueData[] {
  return [...issues].sort((a, b) => {
    if (orderBy === "priority") {
      return (priorityMap[b.priority] ?? 0) - (priorityMap[a.priority] ?? 0);
    }
    if (orderBy === "updated") {
      return (
        Date.parse(b.updatedAt ?? b.createdAt) -
        Date.parse(a.updatedAt ?? a.createdAt)
      );
    }
    if (orderBy === "created") {
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    }
    return a.number - b.number;
  });
}

function makeSyntheticGroup(name: string, issues: IssueData[]): StateGroup {
  return {
    state: {
      id: name,
      name,
      category: "backlog",
      color: "var(--color-text-tertiary)",
      position: 0,
    },
    issues,
  };
}

function regroupIssues(groups: StateGroup[], groupBy: string): StateGroup[] {
  if (groupBy === "status") return groups;

  const issues = groups.flatMap((group) => group.issues);
  if (groupBy === "none") return [makeSyntheticGroup("Issues", issues)];

  const buckets = new Map<string, IssueData[]>();
  for (const issue of issues) {
    const names =
      groupBy === "priority"
        ? [issue.priority === "none" ? "No priority" : issue.priority]
        : groupBy === "assignee"
          ? [issue.assignee?.name ?? "Unassigned"]
          : groupBy === "project"
            ? [issue.projectName ?? "No project"]
            : groupBy === "label"
              ? issue.labels.length > 0
                ? issue.labels.map((label) => label.name)
                : ["No label"]
              : ["Issues"];

    for (const name of names) {
      buckets.set(name, [...(buckets.get(name) ?? []), issue]);
    }
  }

  return [...buckets.entries()].map(([name, bucket]) =>
    makeSyntheticGroup(name, bucket),
  );
}

function ScopeStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <div className="text-[11px] text-[var(--color-text-secondary)]">
        {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">
        {value}
      </div>
    </div>
  );
}

function EditCycleDialog({
  cycle,
  onClose,
  onSaved,
  teamKey,
}: {
  cycle: CycleDetailResponse["cycle"];
  teamKey: string;
  onClose: () => void;
  onSaved: (cycle: CycleDetailResponse["cycle"]) => void;
}) {
  const [name, setName] = useState(cycle.name ?? `Cycle ${cycle.number}`);
  const [startDate, setStartDate] = useState(toDateInputValue(cycle.startDate));
  const [endDate, setEndDate] = useState(toDateInputValue(cycle.endDate));
  const [autoRollover, setAutoRollover] = useState(cycle.autoRollover ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/teams/${teamKey}/cycles/${cycle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, startDate, endDate, autoRollover }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Failed to update cycle");
      }

      const updated = (await response.json()) as CycleDetailResponse["cycle"];
      onSaved({ ...cycle, ...updated });
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to update cycle",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[16vh]">
      <button
        type="button"
        aria-label="Close edit cycle dialog"
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
      />
      <form
        aria-label="Edit cycle"
        onSubmit={(event) => void handleSubmit(event)}
        className="relative z-10 w-full max-w-[420px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">
          Edit cycle
        </h2>
        <label className="mt-4 block text-[12px] text-[var(--color-text-secondary)]">
          Name
          <input
            aria-label="Cycle name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-[12px] text-[var(--color-text-secondary)]">
            Start date
            <input
              aria-label="Cycle start date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
            />
          </label>
          <label className="block text-[12px] text-[var(--color-text-secondary)]">
            End date
            <input
              aria-label="Cycle end date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)]"
            />
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-text-primary)]">
          <input
            aria-label="Auto rollover"
            type="checkbox"
            checked={autoRollover}
            onChange={(event) => setAutoRollover(event.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          Auto-roll unfinished work into the next cycle
        </label>
        {error && <p className="mt-3 text-[12px] text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CycleDetailPage() {
  const params = useParams<{
    key: string;
    cycleId: string;
    workspaceSlug?: string;
  }>();
  const router = useRouter();
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
  const [data, setData] = useState<CycleDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateIssue, setShowCreateIssue] = useState(false);
  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showEditCycle, setShowEditCycle] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { options, updateOptions, saveAsDefault, reset } = useDisplayOptions(
    params.key,
    "list",
  );
  const { filters, updateFilters } = useFilters(
    `team:${params.key}:cycle:${params.cycleId}`,
  );

  const fetchCycleDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/teams/${params.key}/cycles/${params.cycleId}`,
      );
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        setData(null);
      }
    } finally {
      setLoading(false);
    }
  }, [params.key, params.cycleId]);

  useEffect(() => {
    void fetchCycleDetail();
  }, [fetchCycleDetail]);

  const handlePropertyToggle = useCallback(
    (key: keyof DisplayProperties) => {
      updateOptions({
        displayProperties: {
          ...options.displayProperties,
          [key]: !options.displayProperties[key],
        },
      });
    },
    [options.displayProperties, updateOptions],
  );

  async function handleDeleteCycle() {
    if (
      !data ||
      !window.confirm(
        "Delete this cycle? Issues will be removed from the cycle.",
      )
    ) {
      return;
    }

    setDeleting(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/teams/${params.key}/cycles/${params.cycleId}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Failed to delete cycle");
      }
      router.push(
        withWorkspaceSlug(`/team/${params.key}/cycles`, workspaceSlug),
      );
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete cycle",
      );
    } finally {
      setDeleting(false);
    }
  }

  const safeGroups = data?.groups ?? [];
  const safeCycle = data?.cycle;
  const cycleName =
    safeCycle?.name ?? (safeCycle ? `Cycle ${safeCycle.number}` : "Cycle");
  const allIssues = safeGroups.flatMap((group) => group.issues);
  const completedCount = safeCycle?.completedIssueCount ?? 0;
  const startedCount = allIssues.filter((issue) => {
    const state = safeGroups.find(
      (group) => group.state.id === issue.stateId,
    )?.state;
    return state?.category === "started";
  }).length;
  const unstartedCount = allIssues.filter((issue) => {
    const state = safeGroups.find(
      (group) => group.state.id === issue.stateId,
    )?.state;
    return state?.category === "unstarted" || state?.category === "backlog";
  }).length;

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const scoped = safeGroups.map((group) => ({
      ...group,
      issues: sortIssues(
        applyFilters(group.issues, filters).filter((issue) =>
          query
            ? `${issue.identifier} ${issue.title}`.toLowerCase().includes(query)
            : true,
        ),
        options.orderBy,
      ),
    }));

    return regroupIssues(scoped, options.groupBy).filter(
      (group) => options.showEmptyColumns || group.issues.length > 0,
    );
  }, [
    safeGroups,
    filters,
    options.groupBy,
    options.orderBy,
    options.showEmptyColumns,
    search,
  ]);

  const visibleIssueCount = filteredGroups.reduce(
    (sum, group) => sum + group.issues.length,
    0,
  );
  const scopedIssueIds = filteredGroups.flatMap((group) =>
    group.issues.map((issue) => issue.id),
  );
  const filterOptions = data?.filterOptions;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        title="Cycle not found"
        description="This cycle may have been deleted."
      />
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-2">
        <button
          type="button"
          onClick={() =>
            router.push(
              withWorkspaceSlug(`/team/${params.key}/cycles`, workspaceSlug),
            )
          }
          className="flex items-center gap-1 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Cycles
        </button>
        <span className="text-[var(--color-text-tertiary)]">/</span>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-medium text-[var(--color-text-primary)]">
            {cycleName}
          </h1>
          <div className="text-[12px] text-[var(--color-text-secondary)]">
            {formatCycleDate(data.cycle.startDate)} —{" "}
            {formatCycleDate(data.cycle.endDate)}
          </div>
        </div>
        <CycleProgressBar
          completed={completedCount}
          total={data.cycle.issueCount}
        />
        <div className="flex-1" />
        <ContextualInsights
          teamKey={data.team.key}
          scopedIssueIds={scopedIssueIds}
          contextLabel={cycleName}
        />
        <button
          type="button"
          onClick={() => setShowCreateIssue(true)}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          Add issue
        </button>
        <div className="relative">
          <button
            type="button"
            aria-label="Cycle actions"
            onClick={() => setShowActions((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            ⋯
          </button>
          {showActions && (
            <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] py-1 shadow-xl">
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                onClick={() => {
                  setShowActions(false);
                  setShowEditCycle(true);
                }}
              >
                Edit cycle
              </button>
              <button
                type="button"
                disabled={deleting}
                className="w-full px-3 py-1.5 text-left text-[13px] text-red-400 hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                onClick={() => void handleDeleteCycle()}
              >
                {deleting ? "Deleting..." : "Delete cycle"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <ScopeStat label="Completed" value={completedCount} />
          <ScopeStat label="Started" value={startedCount} />
          <ScopeStat label="Unstarted" value={unstartedCount} />
          <ScopeStat label="Total scope" value={data.cycle.issueCount} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search cycle issues</span>
            <input
              aria-label="Search cycle issues"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search cycle issues..."
              className="w-[220px] rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]"
            />
          </label>
          {filterOptions && (
            <FilterBar
              filters={filters as FilterCondition[]}
              onFiltersChange={updateFilters}
              availableStatuses={filterOptions.statuses}
              availableLabels={filterOptions.labels}
              availableAssignees={filterOptions.assignees}
              availableProjects={filterOptions.projects}
              availableCreators={filterOptions.creators}
              availableCycles={filterOptions.cycles}
              availableEstimates={filterOptions.estimates}
              availableDueDates={filterOptions.dueDates}
              availableTeams={filterOptions.teams ?? []}
              availablePriorities={filterOptions.priorities}
            />
          )}
          <div className="flex-1" />
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {visibleIssueCount} shown
          </span>
          <div className="relative">
            <button
              type="button"
              aria-label="Display options"
              onClick={() => setShowDisplayOptions(!showDisplayOptions)}
              className="rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              Display
            </button>
            <DisplayOptionsPanel
              open={showDisplayOptions}
              onClose={() => setShowDisplayOptions(false)}
              layout={options.layout}
              onLayoutChange={(layout) => updateOptions({ layout })}
              groupBy={options.groupBy}
              onGroupByChange={(groupBy) => updateOptions({ groupBy })}
              subGroupBy={options.subGroupBy}
              onSubGroupByChange={(subGroupBy) => updateOptions({ subGroupBy })}
              orderBy={options.orderBy}
              onOrderByChange={(orderBy) => updateOptions({ orderBy })}
              displayProperties={options.displayProperties}
              onDisplayPropertyToggle={handlePropertyToggle}
              showSubIssues={options.showSubIssues}
              onShowSubIssuesToggle={() =>
                updateOptions({ showSubIssues: !options.showSubIssues })
              }
              showTriageIssues={options.showTriageIssues}
              onShowTriageIssuesToggle={() =>
                updateOptions({ showTriageIssues: !options.showTriageIssues })
              }
              showEmptyColumns={options.showEmptyColumns}
              onShowEmptyColumnsToggle={() =>
                updateOptions({ showEmptyColumns: !options.showEmptyColumns })
              }
              onReset={reset}
              onSaveAsDefault={saveAsDefault}
            />
          </div>
        </div>
        {actionError && (
          <p className="mt-2 text-[12px] text-red-400">{actionError}</p>
        )}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {data.cycle.issueCount === 0 ? (
          <EmptyState
            title="No issues in this cycle"
            description="Add issues to this cycle to track progress."
            action={{
              label: "Add issue",
              onClick: () => setShowCreateIssue(true),
            }}
          />
        ) : visibleIssueCount === 0 ? (
          <EmptyState
            title="No matching issues"
            description="Adjust your search, filters, or display options."
          />
        ) : (
          filteredGroups.map((group) => (
            <div key={group.state.id} className="group">
              <IssuesGroupHeader
                name={group.state.name}
                count={group.issues.length}
                statusCategory={group.state.category as StatusCategory}
                statusColor={group.state.color}
                onAddIssue={() => setShowCreateIssue(true)}
              />
              {group.issues.map((iss) => (
                <IssueRow
                  key={`${group.state.id}-${iss.id}`}
                  href={withWorkspaceSlug(
                    `/team/${params.key}/issue/${iss.identifier}`,
                    workspaceSlug,
                  )}
                  identifier={iss.identifier}
                  title={iss.title}
                  priority={priorityMap[iss.priority] ?? 0}
                  statusCategory={
                    (data.groups.find((item) => item.state.id === iss.stateId)
                      ?.state.category ??
                      group.state.category) as StatusCategory
                  }
                  statusColor={
                    data.groups.find((item) => item.state.id === iss.stateId)
                      ?.state.color ?? group.state.color
                  }
                  assigneeName={iss.assignee?.name}
                  assigneeImage={iss.assignee?.image ?? undefined}
                  labels={iss.labels}
                  projectName={iss.projectName ?? undefined}
                  dueDate={iss.dueDate}
                  createdAt={iss.createdAt}
                  displayProperties={options.displayProperties}
                />
              ))}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center border-t border-[var(--color-border)] px-4 py-1.5 text-[12px] text-[var(--color-text-secondary)]">
        {visibleIssueCount} of {data.cycle.issueCount} issues
      </div>

      <CreateIssueModal
        open={showCreateIssue}
        onClose={() => setShowCreateIssue(false)}
        onCreated={fetchCycleDetail}
        teamKey={data.team.key}
        teamName={data.team.name}
        teamId={data.team.id}
        defaultCycleId={data.cycle.id}
        defaultCycleName={cycleName}
      />
      {showEditCycle && (
        <EditCycleDialog
          teamKey={data.team.key}
          cycle={data.cycle}
          onClose={() => setShowEditCycle(false)}
          onSaved={(updatedCycle) =>
            setData((current) =>
              current
                ? { ...current, cycle: { ...current.cycle, ...updatedCycle } }
                : current,
            )
          }
        />
      )}
    </div>
  );
}
