"use client";

import { CreateIssueModal } from "@/components/create-issue-modal";
import { EmptyState } from "@/components/empty-state";
import {
  FilterBar,
  type FilterCondition,
  applyFilters,
} from "@/components/filter-bar";
import { TeamRouteErrorState } from "@/components/team-route-error-state";
import { TriageHeader } from "@/components/triage-header";
import { TriageRow } from "@/components/triage-row";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const PRIORITY_OPTIONS = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "No priority" },
] as const;

interface TriageIssue {
  id: string;
  identifier: string;
  title: string;
  priority: string;
  stateId: string;
  stateName: string;
  stateColor: string;
  creatorId: string | null;
  creatorName: string;
  creatorImage: string | null;
  createdAt: string;
  labelIds: string[];
  labels: { id: string; name: string; color: string }[];
  assigneeId: string | null;
  projectId: string | null;
}

interface TriageResponse {
  team: { id: string; name: string; key: string };
  issues: TriageIssue[];
  count: number;
  createStateId: string | null;
  createStateName: string | null;
  triageEnabled?: boolean;
}

export default function TeamTriagePage() {
  const params = useParams<{ key: string }>();
  const [data, setData] = useState<TriageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadState, setLoadState] = useState<"ready" | "not-found" | "error">(
    "ready",
  );
  const [showCreateIssue, setShowCreateIssue] = useState(false);
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [sortOrder, setSortOrder] = useState<"created-desc" | "created-asc">(
    "created-desc",
  );

  const fetchTriage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/teams/${params.key}/triage`);
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
    fetchTriage();
  }, [fetchTriage]);

  useEffect(() => {
    function handleIssueCreated(event: Event) {
      const detail = (event as CustomEvent<{ teamKey?: string }>).detail;
      if (detail?.teamKey && detail.teamKey !== params.key) {
        return;
      }

      void fetchTriage();
    }

    window.addEventListener("issue-created", handleIssueCreated);
    return () =>
      window.removeEventListener("issue-created", handleIssueCreated);
  }, [fetchTriage, params.key]);

  const handleAccept = useCallback(
    async (issueId: string) => {
      const res = await fetch(`/api/teams/${params.key}/triage/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      if (res.ok) {
        void fetchTriage();
      }
    },
    [params.key, fetchTriage],
  );

  const handleDecline = useCallback(
    async (issueId: string) => {
      const res = await fetch(`/api/teams/${params.key}/triage/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      });
      if (res.ok) {
        void fetchTriage();
      }
    },
    [params.key, fetchTriage],
  );

  const filteredIssues = useMemo(() => {
    const issues = applyFilters(data?.issues ?? [], filters);

    return [...issues].sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      return sortOrder === "created-desc"
        ? rightTime - leftTime
        : leftTime - rightTime;
    });
  }, [data?.issues, filters, sortOrder]);

  const filterOptions = useMemo(() => {
    const statuses = new Map<
      string,
      { id: string; name: string; category: string; color: string }
    >();
    const labels = new Map<
      string,
      { id: string; name: string; color: string }
    >();
    const creators = new Map<string, { id: string; name: string }>();

    for (const currentIssue of data?.issues ?? []) {
      statuses.set(currentIssue.stateId, {
        id: currentIssue.stateId,
        name: currentIssue.stateName,
        category: "triage",
        color: currentIssue.stateColor,
      });

      if (currentIssue.creatorId) {
        creators.set(currentIssue.creatorId, {
          id: currentIssue.creatorId,
          name: currentIssue.creatorName,
        });
      }

      for (const currentLabel of currentIssue.labels) {
        labels.set(currentLabel.id, currentLabel);
      }
    }

    return {
      statuses: [...statuses.values()],
      labels: [...labels.values()],
      creators: [...creators.values()],
    };
  }, [data?.issues]);

  const openCreateIssue = useCallback(() => {
    setShowCreateIssue(true);
  }, []);

  const sortControl = (
    <label className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
      <span>Sort</span>
      <select
        aria-label="Sort triage issues"
        value={sortOrder}
        onChange={(event) =>
          setSortOrder(event.target.value as "created-desc" | "created-asc")
        }
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-2 py-1 text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
      >
        <option value="created-desc">Newest</option>
        <option value="created-asc">Oldest</option>
      </select>
    </label>
  );

  const createIssueButton = (
    <button
      type="button"
      onClick={openCreateIssue}
      className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90"
    >
      Create triage issue
    </button>
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
        onRetry={loadState === "error" ? fetchTriage : undefined}
      />
    );
  }

  if (!data) {
    return (
      <TeamRouteErrorState
        teamKey={params.key}
        variant="error"
        onRetry={fetchTriage}
      />
    );
  }

  if (data.triageEnabled === false) {
    return (
      <div className="flex h-full flex-col">
        <TriageHeader count={0} />
        <EmptyState
          title="Triage is disabled"
          description="Incoming issues go directly to the team backlog. Enable triage in team settings to review issues here first."
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
              aria-label="Triage disabled"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              <path d="M4 4l16 16" />
            </svg>
          }
          action={{
            label: "Open triage settings",
            href: `/settings/teams/${encodeURIComponent(params.key)}/triage`,
          }}
        />
      </div>
    );
  }

  if (data.issues.length === 0) {
    return (
      <>
        <div className="flex h-full flex-col">
          <TriageHeader count={0}>{sortControl}</TriageHeader>
          <EmptyState
            title="No issues to triage"
            description="When new issues are created, they'll appear here for review. Accept them into your workflow or decline."
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
                aria-label="Triage"
              >
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            }
            action={{
              label: "Create triage issue",
              onClick: openCreateIssue,
            }}
          />
        </div>
        <CreateIssueModal
          open={showCreateIssue}
          onClose={() => setShowCreateIssue(false)}
          onCreated={fetchTriage}
          teamKey={data?.team?.key ?? params.key}
          teamName={data?.team?.name ?? params.key}
          teamId={data?.team?.id ?? ""}
          defaultStateId={data?.createStateId ?? undefined}
          defaultStateName={data?.createStateName ?? "Triage"}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex h-full flex-col">
        <TriageHeader count={data.count}>
          <FilterBar
            filters={filters}
            onFiltersChange={setFilters}
            availableStatuses={filterOptions.statuses}
            availableLabels={filterOptions.labels}
            availableAssignees={[]}
            availablePriorities={[...PRIORITY_OPTIONS]}
            availableCreators={filterOptions.creators}
          />
          {sortControl}
          {createIssueButton}
        </TriageHeader>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto lg:max-w-[480px] lg:border-r lg:border-[var(--color-border)]">
            {filteredIssues.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-[14px] font-medium text-[var(--color-text-primary)]">
                  No issues match the current filters
                </p>
                <button
                  type="button"
                  onClick={() => setFilters([])}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              filteredIssues.map((issue) => (
                <TriageRow
                  key={issue.id}
                  issue={issue}
                  onAccept={handleAccept}
                  onDecline={handleDecline}
                />
              ))
            )}
          </div>

          <div className="hidden flex-1 items-center justify-center lg:flex">
            <div className="flex max-w-[260px] flex-col items-center gap-4 text-center">
              <svg
                width="64"
                height="64"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-text-tertiary)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              <p className="text-[14px] font-medium text-[var(--color-text-primary)]">
                {data.count} {data.count === 1 ? "issue" : "issues"} to triage
              </p>
              <button
                type="button"
                onClick={openCreateIssue}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                Create triage issue
              </button>
            </div>
          </div>
        </div>
      </div>

      <CreateIssueModal
        open={showCreateIssue}
        onClose={() => setShowCreateIssue(false)}
        onCreated={fetchTriage}
        teamKey={data.team.key}
        teamName={data.team.name}
        teamId={data.team.id}
        defaultStateId={data.createStateId ?? undefined}
        defaultStateName={data.createStateName ?? "Triage"}
      />
    </>
  );
}
