"use client";

import { CreateIssueModal } from "@/components/create-issue-modal";
import { EmptyState } from "@/components/empty-state";
import {
  FilterBar,
  type FilterCondition,
  applyFilters,
} from "@/components/filter-bar";
import { IssueDetailView } from "@/components/issue-detail-view";
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
  description?: string | null;
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
  projectName?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
  updatedAt?: string;
  teamId?: string | null;
}

interface TriageDestinationState {
  id: string;
  name: string;
  category: string;
  color: string;
  position?: number;
  isDefault?: boolean | null;
}

interface TriageResponse {
  team: { id: string; name: string; key: string };
  issues: TriageIssue[];
  count: number;
  createStateId: string | null;
  createStateName: string | null;
  triageEnabled?: boolean;
  acceptDestinationStates?: TriageDestinationState[];
  declineDestinationStates?: TriageDestinationState[];
}

type TriageDecisionAction = "accept" | "decline";

interface PendingTriageDecision {
  action: TriageDecisionAction;
  issue: TriageIssue;
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
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] =
    useState<PendingTriageDecision | null>(null);
  const [decisionDestinationId, setDecisionDestinationId] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);

  const fetchTriage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/teams/${params.key}/triage`);
      if (res.ok) {
        const json = (await res.json()) as TriageResponse;
        setData(json);
        setLoadState("ready");
        setSelectedIssueId((currentSelectedIssueId) =>
          currentSelectedIssueId &&
          json.issues.some((issue) => issue.id === currentSelectedIssueId)
            ? currentSelectedIssueId
            : null,
        );
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

  const removeAcceptedOrDeclinedIssue = useCallback((issueId: string) => {
    setData((current) => {
      if (!current) {
        return current;
      }

      const nextIssues = current.issues.filter((issue) => issue.id !== issueId);
      return {
        ...current,
        issues: nextIssues,
        count: nextIssues.length,
      };
    });
    setSelectedIssueId((current) => (current === issueId ? null : current));
  }, []);

  const openDecision = useCallback(
    (action: TriageDecisionAction, issueId: string) => {
      const issue = data?.issues.find(
        (currentIssue) => currentIssue.id === issueId,
      );
      if (!issue) {
        return;
      }

      const destinationStates =
        action === "accept"
          ? (data?.acceptDestinationStates ?? [])
          : (data?.declineDestinationStates ?? []);
      const defaultDestination =
        destinationStates.find((state) => state.isDefault) ??
        destinationStates[0] ??
        null;

      setPendingDecision({ action, issue });
      setDecisionDestinationId(defaultDestination?.id ?? "");
      setDecisionReason("");
      setDecisionError(null);
    },
    [
      data?.acceptDestinationStates,
      data?.declineDestinationStates,
      data?.issues,
    ],
  );

  const handleAccept = useCallback(
    (issueId: string) => openDecision("accept", issueId),
    [openDecision],
  );

  const handleDecline = useCallback(
    (issueId: string) => openDecision("decline", issueId),
    [openDecision],
  );

  const closeDecision = useCallback(() => {
    if (decisionSubmitting) {
      return;
    }

    setPendingDecision(null);
    setDecisionError(null);
    setDecisionReason("");
    setDecisionDestinationId("");
  }, [decisionSubmitting]);

  const confirmDecision = useCallback(async () => {
    if (!pendingDecision) {
      return;
    }

    if (!decisionDestinationId) {
      setDecisionError("Choose a destination status before confirming.");
      return;
    }

    setDecisionSubmitting(true);
    setDecisionError(null);

    try {
      const res = await fetch(
        `/api/teams/${params.key}/triage/${pendingDecision.issue.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: pendingDecision.action,
            destinationStateId: decisionDestinationId,
            confirmed: true,
            reason: decisionReason.trim() || undefined,
          }),
        },
      );

      if (!res.ok) {
        let message = "The triage decision could not be saved.";
        try {
          const payload = (await res.json()) as { error?: string };
          message = payload.error ?? message;
        } catch {
          // Preserve the generic message when the API response is not JSON.
        }
        setDecisionError(message);
        return;
      }

      removeAcceptedOrDeclinedIssue(pendingDecision.issue.id);
      setPendingDecision(null);
      setDecisionReason("");
      setDecisionDestinationId("");
      void fetchTriage();
    } catch {
      setDecisionError("Network error while saving the triage decision.");
    } finally {
      setDecisionSubmitting(false);
    }
  }, [
    decisionDestinationId,
    decisionReason,
    fetchTriage,
    params.key,
    pendingDecision,
    removeAcceptedOrDeclinedIssue,
  ]);

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
    const teams = new Map<string, { id: string; name: string }>();

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

      if (currentIssue.teamId) {
        teams.set(currentIssue.teamId, {
          id: currentIssue.teamId,
          name: currentIssue.identifier.split("-")[0] ?? currentIssue.teamId,
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
      teams: [...teams.values()],
    };
  }, [data?.issues]);

  const openCreateIssue = useCallback(() => {
    setShowCreateIssue(true);
  }, []);

  const selectedIssue = useMemo(
    () => filteredIssues.find((issue) => issue.id === selectedIssueId) ?? null,
    [filteredIssues, selectedIssueId],
  );

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

  const decisionDestinationStates = pendingDecision
    ? pendingDecision.action === "accept"
      ? (data?.acceptDestinationStates ?? [])
      : (data?.declineDestinationStates ?? [])
    : [];

  const decisionTitle = pendingDecision
    ? pendingDecision.action === "accept"
      ? "Accept triage issue"
      : "Decline triage issue"
    : "Triage decision";

  const decisionButtonLabel = pendingDecision
    ? pendingDecision.action === "accept"
      ? "Accept issue"
      : "Decline issue"
    : "Confirm";

  const decisionModal = pendingDecision ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="presentation"
    >
      <dialog
        aria-labelledby="triage-decision-title"
        className="w-full max-w-[440px] rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] p-5 shadow-2xl"
        open
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              className="text-[15px] font-semibold text-[var(--color-text-primary)]"
              id="triage-decision-title"
            >
              {decisionTitle}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              {pendingDecision.issue.identifier}: {pendingDecision.issue.title}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close triage decision"
            disabled={decisionSubmitting}
            onClick={closeDecision}
            className="rounded p-1 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <p className="mb-4 text-[13px] text-[var(--color-text-secondary)]">
          {pendingDecision.action === "accept"
            ? "Confirm where this issue should enter the team workflow before it leaves triage."
            : "Confirm the rejection destination before this issue leaves triage."}
        </p>

        <label className="mb-4 block text-[12px] font-medium text-[var(--color-text-secondary)]">
          Destination status
          <select
            aria-label="Triage destination status"
            value={decisionDestinationId}
            disabled={
              decisionSubmitting || decisionDestinationStates.length === 0
            }
            onChange={(event) => setDecisionDestinationId(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
          >
            {decisionDestinationStates.length === 0 ? (
              <option value="">No destination statuses available</option>
            ) : null}
            {decisionDestinationStates.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </select>
        </label>

        {pendingDecision.action === "decline" ? (
          <label className="mb-4 block text-[12px] font-medium text-[var(--color-text-secondary)]">
            Rejection reason (optional)
            <textarea
              aria-label="Decline reason"
              value={decisionReason}
              disabled={decisionSubmitting}
              onChange={(event) => setDecisionReason(event.target.value)}
              className="mt-1 min-h-20 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-60"
              placeholder="Add context for why this issue is being declined"
            />
          </label>
        ) : null}

        {decisionError ? (
          <div
            className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-300"
            role="alert"
          >
            {decisionError}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={decisionSubmitting}
            onClick={closeDecision}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={decisionSubmitting || !decisionDestinationId}
            onClick={() => void confirmDecision()}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium text-white transition-colors disabled:opacity-50 ${
              pendingDecision.action === "accept"
                ? "bg-green-600 hover:bg-green-500"
                : "bg-red-600 hover:bg-red-500"
            }`}
          >
            {decisionSubmitting ? "Saving…" : decisionButtonLabel}
          </button>
        </div>
      </dialog>
    </div>
  ) : null;

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
        {decisionModal}
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
            availableTeams={filterOptions.teams}
          />
          {sortControl}
          {createIssueButton}
        </TriageHeader>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div
            aria-label="Triage issues"
            className="min-w-0 flex-1 overflow-y-auto lg:max-w-[480px] lg:border-r lg:border-[var(--color-border)]"
          >
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
                  selected={issue.id === selectedIssueId}
                  onSelect={setSelectedIssueId}
                  onAccept={handleAccept}
                  onDecline={handleDecline}
                />
              ))
            )}
          </div>

          <div className="flex min-h-[480px] min-w-0 flex-1 lg:min-h-0">
            {selectedIssue ? (
              <section
                aria-label={`${selectedIssue.identifier} triage review`}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
                      Triage review
                    </div>
                    <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                      {selectedIssue.identifier}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAccept(selectedIssue.id)}
                      className="rounded-md border border-green-500/30 px-3 py-1.5 text-[12px] font-medium text-green-400 transition-colors hover:bg-green-400/10"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDecline(selectedIssue.id)}
                      className="rounded-md border border-red-500/30 px-3 py-1.5 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-400/10"
                    >
                      Decline
                    </button>
                  </div>
                </div>
                <div className="min-h-[480px] flex-1">
                  <IssueDetailView compact issueId={selectedIssue.id} />
                </div>
              </section>
            ) : (
              <div className="flex flex-1 items-center justify-center">
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
                    {data.count} {data.count === 1 ? "issue" : "issues"} to
                    triage
                  </p>
                  <p className="text-[13px] text-[var(--color-text-secondary)]">
                    Select an issue to inspect its details before accepting or
                    declining it.
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
            )}
          </div>
        </div>
      </div>

      {decisionModal}
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
