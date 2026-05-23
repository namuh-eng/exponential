"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { ContextualInsights } from "@/components/contextual-insights";
import { CreateIssueModal } from "@/components/create-issue-modal";
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
import { TeamRouteErrorState } from "@/components/team-route-error-state";
import { useDisplayOptions } from "@/hooks/use-display-options";
import { useFilters } from "@/hooks/use-filters";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type BulkUpdatePayload = {
  stateId?: string | null;
  assigneeId?: string | null;
  priority?: string | null;
  labelIds?: string[];
  projectId?: string | null;
  cycleId?: string | null;
  dueDate?: string | null;
  archive?: boolean;
  delete?: boolean;
};

interface IssueData {
  id: string;
  number: number;
  identifier: string;
  title: string;
  priority: string;
  stateId: string;
  assigneeId: string | null;
  assignee: { name: string; image?: string } | null;
  creatorId: string | null;
  creatorName: string | null;
  labels: { name: string; color: string }[];
  labelIds: string[];
  projectId: string | null;
  projectName: string | null;
  cycleId: string | null;
  cycleName: string | null;
  estimate: number | null;
  dueDate: string | null;
  createdAt: string;
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

interface IssuesResponse {
  team: { id: string; name: string; key: string };
  groups: StateGroup[];
  filterOptions: FilterOptions;
}

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

type IssueListTab = "all" | "active" | "backlog";

function getIssueTabFromPath(pathname: string, teamKey: string): IssueListTab {
  const escapedTeamKey = teamKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = pathname.match(
    new RegExp(`/team/${escapedTeamKey}/(all|active|backlog)(?:/)?$`),
  );

  return (match?.[1] as IssueListTab | undefined) ?? "all";
}

export default function TeamIssuesPage() {
  const params = useParams<{ key: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeTab = getIssueTabFromPath(pathname, params.key);
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
  const teamPath = useCallback(
    (suffix: string) =>
      withWorkspaceSlug(`/team/${params.key}/${suffix}`, workspaceSlug),
    [params.key, workspaceSlug],
  );
  const [data, setData] = useState<IssuesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadState, setLoadState] = useState<"ready" | "not-found" | "error">(
    "ready",
  );
  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const [showCreateIssue, setShowCreateIssue] = useState(false);
  const [createIssueDefaults, setCreateIssueDefaults] = useState<{
    stateId?: string;
    stateName: string;
  }>({ stateName: "Backlog" });
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [lastSelectedIssueId, setLastSelectedIssueId] = useState<string | null>(
    null,
  );
  const [bulkActionError, setBulkActionError] = useState<string | null>(null);
  const [bulkActionBusy, setBulkActionBusy] = useState(false);

  const { options, updateOptions, saveAsDefault, reset } = useDisplayOptions(
    params.key,
    "list",
  );
  const { filters, updateFilters } = useFilters(`team:${params.key}`);

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/teams/${params.key}/issues`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLoadState("ready");
        return;
      }

      setData(null);
      setLoadState(res.status === 404 ? "not-found" : "error");
    } catch {
      setData(null);
      setLoadState("error");
    } finally {
      setLoading(false);
    }
  }, [params.key]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  useEffect(() => {
    const selectionScope = `${params.key}:${routeTab}`;
    if (!selectionScope) return;
    setSelectedIssueIds(new Set());
    setLastSelectedIssueId(null);
    setBulkActionError(null);
  }, [params.key, routeTab]);

  useEffect(() => {
    function handleIssueCreated(event: Event) {
      const detail = (event as CustomEvent<{ teamKey?: string }>).detail;
      if (detail?.teamKey && detail.teamKey !== params.key) {
        return;
      }

      void fetchIssues();
    }

    window.addEventListener("issue-created", handleIssueCreated);
    return () =>
      window.removeEventListener("issue-created", handleIssueCreated);
  }, [fetchIssues, params.key]);

  const handleLayoutChange = useCallback(
    (layout: "list" | "board") => {
      if (layout === "board") {
        router.push(teamPath("board"));
      }
      updateOptions({ layout });
    },
    [router, teamPath, updateOptions],
  );

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

  const totalIssues = (data?.groups ?? []).reduce(
    (sum, g) => sum + g.issues.length,
    0,
  );

  // Filter groups based on URL-selected tab and active filters
  const filteredGroups = useMemo(() => {
    return (data?.groups ?? [])
      .filter((g) => {
        if (routeTab === "all") return true;
        if (routeTab === "active")
          return (
            g.state.category === "started" || g.state.category === "unstarted"
          );
        if (routeTab === "backlog") return g.state.category === "backlog";
        return true;
      })
      .map((g) => ({
        ...g,
        issues: applyFilters(g.issues, filters),
      }));
  }, [data?.groups, routeTab, filters]);

  const visibleIssueCount = filteredGroups.reduce(
    (sum, g) => sum + g.issues.length,
    0,
  );
  const visibleIssueIds = useMemo(
    () =>
      filteredGroups.flatMap((group) => group.issues.map((issue) => issue.id)),
    [filteredGroups],
  );
  const visibleIssues = useMemo(
    () => filteredGroups.flatMap((group) => group.issues),
    [filteredGroups],
  );
  const selectedIssues = useMemo(
    () => visibleIssues.filter((issue) => selectedIssueIds.has(issue.id)),
    [selectedIssueIds, visibleIssues],
  );
  const selectedCount = selectedIssueIds.size;

  const tabs = [
    { id: "all", label: "All issues" },
    { id: "active", label: "Active" },
    { id: "backlog", label: "Backlog" },
  ];

  const openCreateIssue = useCallback(
    (defaults?: { stateId?: string; stateName: string }) => {
      setCreateIssueDefaults(defaults ?? { stateName: "Backlog" });
      setShowCreateIssue(true);
    },
    [],
  );

  const toggleIssueSelection = useCallback(
    (issueId: string, shiftKey: boolean) => {
      setSelectedIssueIds((current) => {
        const next = new Set(current);
        const currentIndex = visibleIssueIds.indexOf(issueId);
        const lastIndex = lastSelectedIssueId
          ? visibleIssueIds.indexOf(lastSelectedIssueId)
          : -1;

        if (shiftKey && currentIndex >= 0 && lastIndex >= 0) {
          const [start, end] =
            currentIndex < lastIndex
              ? [currentIndex, lastIndex]
              : [lastIndex, currentIndex];
          for (const id of visibleIssueIds.slice(start, end + 1)) {
            next.add(id);
          }
        } else if (next.has(issueId)) {
          next.delete(issueId);
        } else {
          next.add(issueId);
        }

        return next;
      });
      setLastSelectedIssueId(issueId);
      setBulkActionError(null);
    },
    [lastSelectedIssueId, visibleIssueIds],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && selectedIssueIds.size > 0) {
        setSelectedIssueIds(new Set());
        setLastSelectedIssueId(null);
        setBulkActionError(null);
      }

      if (
        event.key.toLowerCase() === "a" &&
        (event.metaKey || event.ctrlKey) &&
        visibleIssueIds.length > 0
      ) {
        const target = event.target as HTMLElement | null;
        if (
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.isContentEditable
        ) {
          return;
        }
        event.preventDefault();
        setSelectedIssueIds(new Set(visibleIssueIds));
        setLastSelectedIssueId(visibleIssueIds.at(-1) ?? null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIssueIds.size, visibleIssueIds]);

  const applyBulkUpdate = useCallback(
    async (updates: BulkUpdatePayload) => {
      if (selectedIssueIds.size === 0) return;

      setBulkActionBusy(true);
      setBulkActionError(null);
      try {
        const res = await fetch("/api/issues/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueIds: Array.from(selectedIssueIds),
            updates,
          }),
        });

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error ?? "Bulk update failed");
        }

        await fetchIssues();
        if (updates.delete || updates.archive) {
          setSelectedIssueIds(new Set());
          setLastSelectedIssueId(null);
        }
      } catch (error) {
        setBulkActionError(
          error instanceof Error ? error.message : "Bulk update failed",
        );
      } finally {
        setBulkActionBusy(false);
      }
    },
    [fetchIssues, selectedIssueIds],
  );

  const copySelectedIssueLinks = useCallback(async () => {
    const lines = selectedIssues.map((issueRecord) => {
      const path = withWorkspaceSlug(
        `/team/${data?.team.key ?? params.key}/issue/${issueRecord.id}`,
        workspaceSlug,
      );
      return `${issueRecord.identifier} ${path}`;
    });

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setBulkActionError(null);
    } catch {
      setBulkActionError("Unable to copy issue links");
    }
  }, [data?.team.key, params.key, selectedIssues, workspaceSlug]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (loadState !== "ready") {
    return (
      <TeamRouteErrorState
        teamKey={params.key}
        variant={loadState}
        onRetry={loadState === "error" ? fetchIssues : undefined}
      />
    );
  }

  if (!data) {
    return (
      <TeamRouteErrorState
        teamKey={params.key}
        variant="error"
        onRetry={fetchIssues}
      />
    );
  }

  if (totalIssues === 0) {
    return (
      <>
        <EmptyState
          title="No issues"
          description="Create your first issue to start tracking work for your team."
          icon={
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#6b6f76"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              role="img"
              aria-label="Issues"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          }
          action={{
            label: "Create issue",
            onClick: () => openCreateIssue(),
          }}
        />
        <CreateIssueModal
          open={showCreateIssue}
          onClose={() => setShowCreateIssue(false)}
          onCreated={fetchIssues}
          teamKey={data?.team?.key ?? params.key}
          teamName={data?.team?.name ?? params.key}
          teamId={data?.team?.id ?? ""}
          defaultStateId={createIssueDefaults.stateId}
          defaultStateName={createIssueDefaults.stateName}
        />
      </>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex min-w-0 flex-wrap items-center gap-1 border-b border-[var(--color-border)] px-4 py-2">
        <h1 className="mr-4 text-[18px] font-semibold text-[var(--color-text-primary)]">
          {data.team.name}
        </h1>
        {/* Tabs */}
        <div className="flex items-center gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                const query = searchParams.toString();
                router.push(`${teamPath(tab.id)}${query ? `?${query}` : ""}`);
              }}
              data-editorial-control="true"
              className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors ${
                routeTab === tab.id
                  ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)] shadow-[inset_0_-1px_0_var(--color-surface-active-line)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="ml-2">
          <FilterBar
            filters={filters}
            onFiltersChange={updateFilters}
            availableStatuses={data.filterOptions?.statuses ?? []}
            availableLabels={data.filterOptions?.labels ?? []}
            availableAssignees={data.filterOptions?.assignees ?? []}
            availableProjects={data.filterOptions?.projects ?? []}
            availableCreators={data.filterOptions?.creators ?? []}
            availableCycles={data.filterOptions?.cycles ?? []}
            availableEstimates={data.filterOptions?.estimates ?? []}
            availableDueDates={data.filterOptions?.dueDates ?? []}
            availableTeams={data.filterOptions?.teams ?? []}
            availablePriorities={
              data.filterOptions?.priorities ?? [
                { value: "urgent", label: "Urgent" },
                { value: "high", label: "High" },
                { value: "medium", label: "Medium" },
                { value: "low", label: "Low" },
                { value: "none", label: "No priority" },
              ]
            }
          />
        </div>
        <div className="flex-1" />
        <span className="mr-2 text-[12px] text-[var(--color-text-secondary)]">
          {visibleIssueCount} issues
        </span>
        <ContextualInsights
          teamKey={data.team.key}
          scopedIssueIds={visibleIssueIds}
          contextLabel={`${routeTab} issues`}
        />
        {/* Display options trigger */}
        <div className="relative">
          <button
            type="button"
            aria-label="Display options"
            onClick={() => setShowDisplayOptions(!showDisplayOptions)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
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
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Display
          </button>
          <DisplayOptionsPanel
            open={showDisplayOptions}
            onClose={() => setShowDisplayOptions(false)}
            layout={options.layout}
            onLayoutChange={handleLayoutChange}
            groupBy={options.groupBy}
            onGroupByChange={(g) => updateOptions({ groupBy: g })}
            subGroupBy={options.subGroupBy}
            onSubGroupByChange={(s) => updateOptions({ subGroupBy: s })}
            orderBy={options.orderBy}
            onOrderByChange={(o) => updateOptions({ orderBy: o })}
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

      {/* Issues list */}
      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {filteredGroups.map((group) => (
          <div key={group.state.id} className="group">
            <IssuesGroupHeader
              name={group.state.name}
              count={group.issues.length}
              statusCategory={group.state.category as StatusCategory}
              statusColor={group.state.color}
              onAddIssue={() =>
                openCreateIssue({
                  stateId: group.state.id,
                  stateName: group.state.name,
                })
              }
            />
            {group.issues.map((iss) => (
              <IssueRow
                key={iss.id}
                identifier={iss.identifier}
                title={iss.title}
                priority={priorityMap[iss.priority] ?? 0}
                statusCategory={group.state.category as StatusCategory}
                statusColor={group.state.color}
                assigneeName={iss.assignee?.name}
                assigneeImage={iss.assignee?.image ?? undefined}
                labels={iss.labels}
                projectName={iss.projectName ?? undefined}
                cycleName={iss.cycleName}
                estimate={iss.estimate}
                dueDate={iss.dueDate}
                createdAt={iss.createdAt}
                href={withWorkspaceSlug(
                  `/team/${data.team.key}/issue/${iss.id}`,
                  workspaceSlug,
                )}
                selected={selectedIssueIds.has(iss.id)}
                selectionMode={selectedCount > 0}
                onToggleSelected={({ shiftKey }) =>
                  toggleIssueSelection(iss.id, shiftKey)
                }
                displayProperties={options.displayProperties}
              />
            ))}
          </div>
        ))}
      </div>

      {selectedCount > 0 && (
        <div
          data-testid="bulk-action-bar"
          className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[12px] text-[var(--color-text-primary)] shadow-lg"
        >
          <strong>{selectedCount} selected</strong>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            onClick={() => {
              setSelectedIssueIds(new Set());
              setLastSelectedIssueId(null);
            }}
          >
            Clear
          </button>
          <select
            aria-label="Bulk status"
            disabled={bulkActionBusy}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) {
                void applyBulkUpdate({ stateId: event.target.value });
                event.target.value = "";
              }
            }}
          >
            <option value="">Status</option>
            {data.filterOptions.statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Bulk assignee"
            disabled={bulkActionBusy}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value !== "") {
                void applyBulkUpdate({
                  assigneeId:
                    event.target.value === "__unassigned__"
                      ? null
                      : event.target.value,
                });
                event.target.value = "";
              }
            }}
          >
            <option value="">Assignee</option>
            <option value="__unassigned__">Unassigned</option>
            {data.filterOptions.assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Bulk priority"
            disabled={bulkActionBusy}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) {
                void applyBulkUpdate({ priority: event.target.value });
                event.target.value = "";
              }
            }}
          >
            <option value="">Priority</option>
            {data.filterOptions.priorities.map((priority) => (
              <option key={priority.value} value={priority.value}>
                {priority.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Bulk label"
            disabled={bulkActionBusy}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) {
                const labelIds = [
                  ...new Set([
                    ...selectedIssues.flatMap(
                      (issueRecord) => issueRecord.labelIds ?? [],
                    ),
                    event.target.value,
                  ]),
                ];
                void applyBulkUpdate({ labelIds });
                event.target.value = "";
              }
            }}
          >
            <option value="">Label</option>
            {data.filterOptions.labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Bulk project"
            disabled={bulkActionBusy}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value !== "") {
                void applyBulkUpdate({
                  projectId:
                    event.target.value === "__none__"
                      ? null
                      : event.target.value,
                });
                event.target.value = "";
              }
            }}
          >
            <option value="">Project</option>
            <option value="__none__">No project</option>
            {data.filterOptions.projects.map((projectOption) => (
              <option key={projectOption.id} value={projectOption.id}>
                {projectOption.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Bulk cycle"
            disabled={bulkActionBusy}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value !== "") {
                void applyBulkUpdate({
                  cycleId:
                    event.target.value === "__none__"
                      ? null
                      : event.target.value,
                });
                event.target.value = "";
              }
            }}
          >
            <option value="">Cycle</option>
            <option value="__none__">No cycle</option>
            {data.filterOptions.cycles.map((cycleOption) => (
              <option key={cycleOption.id} value={cycleOption.id}>
                {cycleOption.name}
              </option>
            ))}
          </select>
          <input
            aria-label="Bulk due date"
            type="date"
            disabled={bulkActionBusy}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
            onChange={(event) => {
              if (event.target.value) {
                void applyBulkUpdate({ dueDate: event.target.value });
                event.target.value = "";
              }
            }}
          />
          <button
            type="button"
            disabled={bulkActionBusy}
            className="rounded-md px-2 py-1 hover:bg-[var(--color-surface-hover)]"
            onClick={() => void applyBulkUpdate({ archive: true })}
          >
            Archive
          </button>
          <button
            type="button"
            disabled={bulkActionBusy}
            className="rounded-md px-2 py-1 text-red-400 hover:bg-[var(--color-surface-hover)]"
            onClick={() => void applyBulkUpdate({ delete: true })}
          >
            Delete
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 hover:bg-[var(--color-surface-hover)]"
            onClick={() => void copySelectedIssueLinks()}
          >
            Copy
          </button>
          {bulkActionError && (
            <span className="max-w-[220px] truncate text-red-400">
              {bulkActionError}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center border-t border-[var(--color-border)] px-4 py-1.5 text-[12px] text-[var(--color-text-secondary)]">
        {visibleIssueCount} issues
      </div>

      <CreateIssueModal
        open={showCreateIssue}
        onClose={() => setShowCreateIssue(false)}
        onCreated={fetchIssues}
        teamKey={data.team.key}
        teamName={data.team.name}
        teamId={data.team.id}
        defaultStateId={createIssueDefaults.stateId}
        defaultStateName={createIssueDefaults.stateName}
      />
    </div>
  );
}
