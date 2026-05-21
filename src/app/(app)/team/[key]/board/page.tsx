"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import { BoardColumn } from "@/components/board-column";
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
import { IssueCard } from "@/components/issue-card";
import { priorityMap } from "@/components/issue-row";
import { TeamRouteErrorState } from "@/components/team-route-error-state";
import { useDisplayOptions } from "@/hooks/use-display-options";
import { useFilters } from "@/hooks/use-filters";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

interface IssueData {
  id: string;
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
  projectName?: string | null;
  cycleId: string | null;
  cycleName: string | null;
  estimate: number | null;
  dueDate?: string | null;
  createdAt: string;
  teamId?: string | null;
}

interface StateGroup {
  state: {
    id: string;
    name: string;
    category: string;
    color: string;
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

function moveIssueBetweenGroups(
  groups: StateGroup[],
  issueId: string,
  destinationStateId: string,
): StateGroup[] {
  let movedIssue: IssueData | null = null;

  const groupsWithoutIssue = groups.map((group) => {
    const nextIssues = group.issues.filter((issue) => {
      if (issue.id !== issueId) {
        return true;
      }

      movedIssue = { ...issue, stateId: destinationStateId };
      return false;
    });

    return nextIssues === group.issues
      ? group
      : { ...group, issues: nextIssues };
  });

  if (!movedIssue) {
    return groups;
  }

  return groupsWithoutIssue.map((group) =>
    group.state.id === destinationStateId
      ? {
          ...group,
          issues: [...group.issues, movedIssue as IssueData],
        }
      : group,
  );
}

export default function TeamBoardPage() {
  const params = useParams<{ key: string }>();
  const router = useRouter();
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
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
  const [draggedIssue, setDraggedIssue] = useState<{
    issueId: string;
    fromStateId: string;
  } | null>(null);
  const [dropTargetStateId, setDropTargetStateId] = useState<string | null>(
    null,
  );

  const { options, updateOptions, saveAsDefault, reset } = useDisplayOptions(
    params.key,
    "board",
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
      if (layout === "list") {
        router.push(
          withWorkspaceSlug(`/team/${params.key}/all`, workspaceSlug),
        );
      }
      updateOptions({ layout });
    },
    [router, params.key, workspaceSlug, updateOptions],
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

  const openCreateIssue = useCallback(
    (defaults?: { stateId?: string; stateName: string }) => {
      setCreateIssueDefaults(defaults ?? { stateName: "Backlog" });
      setShowCreateIssue(true);
    },
    [],
  );

  const handleIssueDragStart = useCallback(
    (issueId: string, fromStateId: string) =>
      (event: React.DragEvent<HTMLDivElement>) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", issueId);
        setDraggedIssue({ issueId, fromStateId });
        setDropTargetStateId(null);
      },
    [],
  );

  const handleIssueDragEnd = useCallback(() => {
    setDraggedIssue(null);
    setDropTargetStateId(null);
  }, []);

  const handleColumnDragOver = useCallback(
    (stateId: string) => (event: React.DragEvent<HTMLDivElement>) => {
      if (!draggedIssue) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTargetStateId(stateId);
    },
    [draggedIssue],
  );

  const handleColumnDragLeave = useCallback(
    (stateId: string) => (event: React.DragEvent<HTMLDivElement>) => {
      if (dropTargetStateId !== stateId) {
        return;
      }

      const relatedTarget = event.relatedTarget;
      if (
        relatedTarget instanceof Node &&
        event.currentTarget.contains(relatedTarget)
      ) {
        return;
      }

      setDropTargetStateId(null);
    },
    [dropTargetStateId],
  );

  const handleColumnDrop = useCallback(
    (stateId: string) => async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      if (!draggedIssue || draggedIssue.fromStateId === stateId || !data) {
        setDropTargetStateId(null);
        return;
      }

      const previousGroups = data.groups;
      setData((current) =>
        current
          ? {
              ...current,
              groups: moveIssueBetweenGroups(
                current.groups,
                draggedIssue.issueId,
                stateId,
              ),
            }
          : current,
      );
      setDraggedIssue(null);
      setDropTargetStateId(null);

      const response = await fetch(`/api/issues/${draggedIssue.issueId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ stateId }),
      });

      if (!response.ok) {
        setData((current) =>
          current ? { ...current, groups: previousGroups } : current,
        );
        return;
      }

      window.dispatchEvent(new CustomEvent("notifications:changed"));
      await fetchIssues();
    },
    [data, draggedIssue, fetchIssues],
  );

  // Apply filters and filter out empty columns for completed/canceled unless showEmptyColumns is on
  const visibleGroups = useMemo(() => {
    return (data?.groups ?? [])
      .map((g) => ({
        ...g,
        issues: applyFilters(g.issues, filters),
      }))
      .filter(
        (g) =>
          g.issues.length > 0 ||
          options.showEmptyColumns ||
          (g.state.category !== "completed" && g.state.category !== "canceled"),
      );
  }, [data?.groups, filters, options.showEmptyColumns]);

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
          description="Create issues to see them on the board, organized by status."
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
              aria-label="Board"
            >
              <rect width="6" height="14" x="4" y="5" rx="1" />
              <rect width="6" height="10" x="14" y="7" rx="1" />
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
      <div className="flex items-center border-b border-[var(--color-border)] px-4 py-2">
        <h1 className="mr-4 text-[15px] font-medium text-[var(--color-text-primary)]">
          {data.team.name}
        </h1>
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
          {totalIssues} issues
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

      {/* Board */}
      <div className="flex flex-1 gap-0 overflow-x-auto p-2">
        {visibleGroups.map((group) => (
          <BoardColumn
            key={group.state.id}
            name={group.state.name}
            count={group.issues.length}
            statusCategory={group.state.category as StatusCategory}
            statusColor={group.state.color}
            testId={`board-column-${group.state.id}`}
            isDropTarget={dropTargetStateId === group.state.id}
            onDragOver={handleColumnDragOver(group.state.id)}
            onDrop={handleColumnDrop(group.state.id)}
            onDragLeave={handleColumnDragLeave(group.state.id)}
            onAddIssue={() =>
              openCreateIssue({
                stateId: group.state.id,
                stateName: group.state.name,
              })
            }
          >
            {group.issues.map((iss) => (
              <IssueCard
                key={iss.id}
                issueId={iss.id}
                identifier={iss.identifier}
                title={iss.title}
                priority={priorityMap[iss.priority] ?? 0}
                statusCategory={group.state.category as StatusCategory}
                statusColor={group.state.color}
                assigneeName={iss.assignee?.name}
                assigneeImage={iss.assignee?.image ?? undefined}
                labels={iss.labels}
                projectName={iss.projectName}
                cycleName={iss.cycleName}
                estimate={iss.estimate}
                dueDate={iss.dueDate}
                createdAt={iss.createdAt}
                href={withWorkspaceSlug(
                  `/team/${data.team.key}/issue/${iss.identifier}`,
                  workspaceSlug,
                )}
                displayProperties={options.displayProperties}
                draggable
                isDragging={draggedIssue?.issueId === iss.id}
                onDragStart={handleIssueDragStart(iss.id, group.state.id)}
                onDragEnd={handleIssueDragEnd}
              />
            ))}
          </BoardColumn>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center border-t border-[var(--color-border)] px-4 py-1.5 text-[12px] text-[var(--color-text-secondary)]">
        {totalIssues} issues
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
