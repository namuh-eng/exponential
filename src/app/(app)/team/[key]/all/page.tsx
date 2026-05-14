"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-4 py-2">
        <h1 className="mr-4 text-[15px] font-medium text-[var(--color-text-primary)]">
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
              className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                routeTab === tab.id
                  ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
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
      <div className="flex-1 overflow-y-auto">
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
                dueDate={iss.dueDate}
                createdAt={iss.createdAt}
                href={withWorkspaceSlug(
                  `/team/${data.team.key}/issue/${iss.id}`,
                  workspaceSlug,
                )}
                displayProperties={options.displayProperties}
              />
            ))}
          </div>
        ))}
      </div>

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
