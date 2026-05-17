"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
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
import { useFilters } from "@/hooks/use-filters";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import { useParams, useRouter } from "next/navigation";
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
  labels: { name: string; color: string }[];
  labelIds: string[];
  projectId: string | null;
  projectName?: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt?: string;
  displayAt?: string;
  teamKey?: string;
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
  priorities: { value: string; label: string }[];
}

interface MyIssuesResponse {
  groups: StateGroup[];
  totalCount: number;
  filterOptions: FilterOptions;
}

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

const tabs = [
  { id: "assigned", label: "Assigned" },
  { id: "created", label: "Created" },
  { id: "subscribed", label: "Subscribed" },
  { id: "activity", label: "Activity" },
];

const defaultDisplayProps: DisplayProperties = {
  id: true,
  status: true,
  assignee: true,
  priority: true,
  project: true,
  dueDate: false,
  milestone: false,
  labels: true,
  links: false,
  timeInStatus: false,
  created: true,
  updated: false,
  pullRequests: false,
};

export default function MyIssuesTabPage() {
  const params = useParams<{ tab: string }>();
  const router = useRouter();
  const workspaceSlug = useAppShellContext()?.workspaceSlug;
  const activeTab = params.tab ?? "assigned";

  const [data, setData] = useState<MyIssuesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  const [displayProperties, setDisplayProperties] =
    useState<DisplayProperties>(defaultDisplayProps);

  const { filters, updateFilters } = useFilters(`my-issues:${activeTab}`);

  useEffect(() => {
    setLoading(true);
    async function fetchMyIssues() {
      try {
        const res = await fetch(`/api/my-issues?tab=${activeTab}`);
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchMyIssues();
  }, [activeTab]);

  const handlePropertyToggle = useCallback((key: keyof DisplayProperties) => {
    setDisplayProperties((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const filteredGroups = useMemo(() => {
    if (!data) return [];
    return data.groups
      .map((g) => ({
        ...g,
        issues: applyFilters(g.issues, filters),
      }))
      .filter((g) => g.issues.length > 0);
  }, [data, filters]);

  const visibleCount = filteredGroups.reduce(
    (sum, g) => sum + g.issues.length,
    0,
  );
  const totalCount = data?.totalCount ?? 0;
  const hiddenCount = totalCount - visibleCount;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (!data || totalCount === 0) {
    const emptyMessages: Record<string, { title: string; desc: string }> = {
      assigned: {
        title: "No issues assigned",
        desc: "Issues assigned to you will appear here.",
      },
      created: {
        title: "No issues created",
        desc: "Issues you've created will appear here.",
      },
      subscribed: {
        title: "No subscribed issues",
        desc: "Issues you've commented on or subscribed to will appear here.",
      },
      activity: {
        title: "No recent activity",
        desc: "Your recent issue activity will appear here.",
      },
    };
    const msg = emptyMessages[activeTab] ?? emptyMessages.assigned;

    return (
      <div className="flex h-full flex-col">
        <MyIssuesHeader
          activeTab={activeTab}
          router={router}
          workspaceSlug={workspaceSlug}
        />
        <div className="flex-1">
          <EmptyState
            title={msg.title}
            description={msg.desc}
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
                aria-label="My Issues"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" x2="19" y1="8" y2="14" />
                <line x1="22" x2="16" y1="11" y2="11" />
              </svg>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-4 py-2">
        <h1 className="mr-4 text-[15px] font-medium text-[var(--color-text-primary)]">
          My Issues
        </h1>
        {/* Tabs */}
        <div className="flex items-center gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() =>
                router.push(
                  withWorkspaceSlug(`/my-issues/${tab.id}`, workspaceSlug),
                )
              }
              className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                activeTab === tab.id
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
          {visibleCount} issues
          {hiddenCount > 0 && ` (${hiddenCount} hidden)`}
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
          {showDisplayOptions && (
            <div className="absolute right-0 z-50 mt-1 w-[280px] rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
                  Display Properties
                </span>
                <button
                  type="button"
                  onClick={() => setShowDisplayOptions(false)}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
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
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  Object.keys(displayProperties) as (keyof DisplayProperties)[]
                ).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handlePropertyToggle(key)}
                    className={`rounded-md border px-2 py-0.5 text-[12px] transition-colors ${
                      displayProperties[key]
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-text-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {formatPropertyLabel(key)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Issues list grouped by workflow state */}
      <div className="flex-1 overflow-y-auto">
        {filteredGroups.map((group) => (
          <div key={group.state.id}>
            <IssuesGroupHeader
              name={group.state.name}
              count={group.issues.length}
              statusCategory={group.state.category as StatusCategory}
              statusColor={group.state.color}
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
                createdAt={iss.displayAt ?? iss.createdAt}
                displayProperties={displayProperties}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center border-t border-[var(--color-border)] px-4 py-1.5 text-[12px] text-[var(--color-text-secondary)]">
        {visibleCount} issues
        {hiddenCount > 0 && (
          <span className="ml-1 text-[var(--color-text-tertiary)]">
            ({hiddenCount} hidden by filters)
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Header subcomponent (reused for empty state) ───────────────────

function MyIssuesHeader({
  activeTab,
  router,
  workspaceSlug,
}: {
  activeTab: string;
  router: ReturnType<typeof useRouter>;
  workspaceSlug?: string;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-4 py-2">
      <h1 className="mr-4 text-[15px] font-medium text-[var(--color-text-primary)]">
        My Issues
      </h1>
      <div className="flex items-center gap-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() =>
              router.push(
                withWorkspaceSlug(`/my-issues/${tab.id}`, workspaceSlug),
              )
            }
            className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
              activeTab === tab.id
                ? "bg-[var(--color-surface-active)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatPropertyLabel(key: string): string {
  const labels: Record<string, string> = {
    id: "ID",
    status: "Status",
    assignee: "Assignee",
    priority: "Priority",
    project: "Project",
    dueDate: "Due date",
    milestone: "Milestone",
    labels: "Labels",
    links: "Links",
    timeInStatus: "Time in status",
    created: "Created",
    updated: "Updated",
    pullRequests: "PRs",
  };
  return labels[key] ?? key;
}
