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
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

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
  projectMilestoneId?: string | null;
  cycleId?: string | null;
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
  metadataOptions?: {
    labels: { id: string; name: string; color: string }[];
    cycles: { id: string; name: string | null; number: number }[];
    projects: { id: string; name: string }[];
    projectMilestones: { id: string; name: string; projectId: string }[];
    members: { id: string; name: string | null; email: string | null }[];
  };
}

type TriageDecisionAction = "accept" | "decline";

interface PendingTriageDecision {
  action: TriageDecisionAction;
  issues: TriageIssue[];
  bulk: boolean;
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
  const [bulkSelectedIssueIds, setBulkSelectedIssueIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeIssueIndex, setActiveIssueIndex] = useState(0);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] =
    useState<PendingTriageDecision | null>(null);
  const [decisionDestinationId, setDecisionDestinationId] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [acceptMetadata, setAcceptMetadata] = useState({
    priority: "none",
    estimate: "",
    labelIds: [] as string[],
    cycleId: "",
    projectId: "",
    projectMilestoneId: "",
    assigneeId: "",
    comment: "",
    subscribe: true,
  });
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
        setBulkSelectedIssueIds((current) => {
          const visibleIds = new Set(json.issues.map((issue) => issue.id));
          return new Set(
            [...current].filter((issueId) => visibleIds.has(issueId)),
          );
        });
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
    setBulkSelectedIssueIds((current) => {
      const next = new Set(current);
      next.delete(issueId);
      return next;
    });
  }, []);

  const openDecision = useCallback(
    (action: TriageDecisionAction, issueIds: string[], bulk = false) => {
      const issues = issueIds
        .map((issueId) =>
          data?.issues.find((currentIssue) => currentIssue.id === issueId),
        )
        .filter((issue): issue is TriageIssue => Boolean(issue));
      if (issues.length === 0) {
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

      setPendingDecision({ action, issues, bulk });
      setDecisionDestinationId(defaultDestination?.id ?? "");
      const issue = issues[0];
      setDecisionReason("");
      setAcceptMetadata({
        priority: issue.priority ?? "none",
        estimate: issue.estimate == null ? "" : String(issue.estimate),
        labelIds: issue.labelIds ?? [],
        cycleId: issue.cycleId ?? "",
        projectId: issue.projectId ?? "",
        projectMilestoneId: issue.projectMilestoneId ?? "",
        assigneeId: issue.assigneeId ?? "",
        comment: "",
        subscribe: true,
      });
      setDecisionError(null);
    },
    [
      data?.acceptDestinationStates,
      data?.declineDestinationStates,
      data?.issues,
    ],
  );

  const handleAccept = useCallback(
    (issueId: string) => openDecision("accept", [issueId]),
    [openDecision],
  );

  const handleDecline = useCallback(
    (issueId: string) => openDecision("decline", [issueId]),
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

    if (pendingDecision.action === "accept" && acceptMetadata.estimate) {
      const estimate = Number(acceptMetadata.estimate);
      if (!Number.isFinite(estimate) || estimate < 0) {
        setDecisionError("Estimate must be a positive number.");
        return;
      }
    }

    if (!decisionDestinationId) {
      setDecisionError("Choose a destination status before confirming.");
      return;
    }

    setDecisionSubmitting(true);
    setDecisionError(null);

    try {
      const endpoint = pendingDecision.bulk
        ? `/api/teams/${params.key}/triage/bulk`
        : `/api/teams/${params.key}/triage/${pendingDecision.issues[0].id}`;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: pendingDecision.action,
          issueIds: pendingDecision.bulk
            ? pendingDecision.issues.map((issue) => issue.id)
            : undefined,
          destinationStateId: decisionDestinationId,
          confirmed: true,
          reason: decisionReason.trim() || undefined,
          ...(pendingDecision.action === "accept" && !pendingDecision.bulk
            ? {
                priority: acceptMetadata.priority,
                estimate: acceptMetadata.estimate
                  ? Number(acceptMetadata.estimate)
                  : null,
                labelIds: acceptMetadata.labelIds,
                cycleId: acceptMetadata.cycleId || null,
                projectId: acceptMetadata.projectId || null,
                projectMilestoneId: acceptMetadata.projectMilestoneId || null,
                assigneeId: acceptMetadata.assigneeId || null,
                comment: acceptMetadata.comment.trim() || undefined,
                subscribe: acceptMetadata.subscribe,
              }
            : {}),
        }),
      });

      if (!res.ok && res.status !== 207) {
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

      if (pendingDecision.bulk) {
        const payload = (await res.json()) as {
          updatedCount?: number;
          conflictCount?: number;
          results?: { issueId: string; status: string; error?: string }[];
        };
        const updatedIds = new Set(
          (payload.results ?? [])
            .filter((result) => result.status === "updated")
            .map((result) => result.issueId),
        );
        for (const issueId of updatedIds) {
          removeAcceptedOrDeclinedIssue(issueId);
        }
        setBulkMessage(
          `${payload.updatedCount ?? updatedIds.size} updated${
            payload.conflictCount ? `, ${payload.conflictCount} conflicts` : ""
          }`,
        );
      } else {
        removeAcceptedOrDeclinedIssue(pendingDecision.issues[0].id);
      }
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
    acceptMetadata,
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

  useEffect(() => {
    setActiveIssueIndex((current) =>
      filteredIssues.length === 0
        ? 0
        : Math.min(Math.max(current, 0), filteredIssues.length - 1),
    );
    setBulkSelectedIssueIds((current) => {
      const visibleIds = new Set(filteredIssues.map((issue) => issue.id));
      return new Set([...current].filter((issueId) => visibleIds.has(issueId)));
    });
  }, [filteredIssues]);

  const selectedIssue = useMemo(
    () => filteredIssues.find((issue) => issue.id === selectedIssueId) ?? null,
    [filteredIssues, selectedIssueId],
  );

  const selectedVisibleIssues = useMemo(
    () => filteredIssues.filter((issue) => bulkSelectedIssueIds.has(issue.id)),
    [bulkSelectedIssueIds, filteredIssues],
  );

  const allVisibleSelected =
    filteredIssues.length > 0 &&
    selectedVisibleIssues.length === filteredIssues.length;

  const toggleBulkSelected = useCallback((issueId: string) => {
    setBulkMessage(null);
    setBulkSelectedIssueIds((current) => {
      const next = new Set(current);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setBulkMessage(null);
    setBulkSelectedIssueIds((current) => {
      if (filteredIssues.every((issue) => current.has(issue.id))) {
        return new Set();
      }
      return new Set(filteredIssues.map((issue) => issue.id));
    });
  }, [filteredIssues]);

  const clearBulkSelection = useCallback(() => {
    setBulkSelectedIssueIds(new Set());
    setBulkMessage(null);
  }, []);

  const openBulkDecision = useCallback(
    (action: TriageDecisionAction) => {
      openDecision(
        action,
        selectedVisibleIssues.map((issue) => issue.id),
        true,
      );
    },
    [openDecision, selectedVisibleIssues],
  );

  const handleKeyboardIntake = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (filteredIssues.length === 0) {
        return;
      }
      const activeIssue = filteredIssues[activeIssueIndex];
      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        setActiveIssueIndex((current) =>
          Math.min(current + 1, filteredIssues.length - 1),
        );
      } else if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        setActiveIssueIndex((current) => Math.max(current - 1, 0));
      } else if (event.key === " " && activeIssue) {
        event.preventDefault();
        toggleBulkSelected(activeIssue.id);
      } else if (event.key === "Enter" && activeIssue) {
        event.preventDefault();
        setSelectedIssueId(activeIssue.id);
      } else if (event.key.toLowerCase() === "a" && activeIssue) {
        event.preventDefault();
        openDecision("accept", [activeIssue.id]);
      } else if (event.key.toLowerCase() === "d" && activeIssue) {
        event.preventDefault();
        openDecision("decline", [activeIssue.id]);
      }
    },
    [activeIssueIndex, filteredIssues, openDecision, toggleBulkSelected],
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

  const metadataOptions = data?.metadataOptions ?? {
    labels: [],
    cycles: [],
    projects: [],
    projectMilestones: [],
    members: [],
  };
  const availableMilestones = metadataOptions.projectMilestones.filter(
    (milestone) =>
      !acceptMetadata.projectId ||
      milestone.projectId === acceptMetadata.projectId,
  );
  const toggleAcceptLabel = (labelId: string) => {
    setAcceptMetadata((current) => ({
      ...current,
      labelIds: current.labelIds.includes(labelId)
        ? current.labelIds.filter((currentId) => currentId !== labelId)
        : [...current.labelIds, labelId],
    }));
  };

  const decisionModal = pendingDecision ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="presentation"
    >
      <dialog
        aria-labelledby="triage-decision-title"
        className={`w-full ${pendingDecision.action === "accept" && !pendingDecision.bulk ? "max-w-[720px]" : "max-w-[440px]"} rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] p-5 shadow-2xl`}
        open
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closeDecision();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void confirmDecision();
          }
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              className="text-[15px] font-semibold text-[var(--color-text-primary)]"
              id="triage-decision-title"
            >
              {pendingDecision.action === "accept" && !pendingDecision.bulk
                ? `Accept: ${pendingDecision.issues[0].identifier} ${pendingDecision.issues[0].title}`
                : decisionTitle}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              {pendingDecision.bulk
                ? `${pendingDecision.issues.length} selected issues`
                : `${pendingDecision.issues[0].identifier}: ${pendingDecision.issues[0].title}`}
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

        {pendingDecision.action === "accept" && !pendingDecision.bulk ? (
          <div className="mb-4 grid gap-3 rounded-lg border border-[var(--color-border)] p-3 md:grid-cols-2">
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Priority
              <select
                aria-label="Accept priority"
                value={acceptMetadata.priority}
                onChange={(event) =>
                  setAcceptMetadata((current) => ({
                    ...current,
                    priority: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              >
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority.value} value={priority.value}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Estimate
              <input
                aria-label="Accept estimate"
                type="number"
                min="0"
                step="0.5"
                value={acceptMetadata.estimate}
                onChange={(event) =>
                  setAcceptMetadata((current) => ({
                    ...current,
                    estimate: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              />
            </label>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Team
              <input
                aria-label="Accept team"
                value={data?.team.name ?? params.key}
                disabled
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)] opacity-70"
              />
            </label>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Assignee
              <select
                aria-label="Accept assignee"
                value={acceptMetadata.assigneeId}
                onChange={(event) =>
                  setAcceptMetadata((current) => ({
                    ...current,
                    assigneeId: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              >
                <option value="">Unassigned</option>
                {metadataOptions.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name ?? member.email ?? member.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Cycle
              <select
                aria-label="Accept cycle"
                value={acceptMetadata.cycleId}
                onChange={(event) =>
                  setAcceptMetadata((current) => ({
                    ...current,
                    cycleId: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              >
                <option value="">No cycle</option>
                {metadataOptions.cycles.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.name ?? `Cycle ${cycle.number}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Project
              <select
                aria-label="Accept project"
                value={acceptMetadata.projectId}
                onChange={(event) =>
                  setAcceptMetadata((current) => ({
                    ...current,
                    projectId: event.target.value,
                    projectMilestoneId: "",
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              >
                <option value="">No project</option>
                {metadataOptions.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Project milestone
              <select
                aria-label="Accept project milestone"
                value={acceptMetadata.projectMilestoneId}
                onChange={(event) =>
                  setAcceptMetadata((current) => ({
                    ...current,
                    projectMilestoneId: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              >
                <option value="">No milestone</option>
                {availableMilestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="md:col-span-2">
              <legend className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                Labels
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {metadataOptions.labels.length === 0 ? (
                  <span className="text-[12px] text-[var(--color-text-tertiary)]">
                    No labels available
                  </span>
                ) : null}
                {metadataOptions.labels.map((label) => (
                  <label
                    key={label.id}
                    className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-primary)]"
                  >
                    <input
                      aria-label={`Accept label ${label.name}`}
                      type="checkbox"
                      checked={acceptMetadata.labelIds.includes(label.id)}
                      onChange={() => toggleAcceptLabel(label.id)}
                    />
                    {label.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="md:col-span-2 block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Comment
              <textarea
                aria-label="Comment for accepting issue"
                placeholder="Add a comment…"
                value={acceptMetadata.comment}
                onChange={(event) =>
                  setAcceptMetadata((current) => ({
                    ...current,
                    comment: event.target.value,
                  }))
                }
                className="mt-1 min-h-20 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              />
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
              <input
                aria-label="Subscribe to issue updates"
                type="checkbox"
                checked={acceptMetadata.subscribe}
                onChange={(event) =>
                  setAcceptMetadata((current) => ({
                    ...current,
                    subscribe: event.target.checked,
                  }))
                }
              />
              Subscribe to issue updates
            </label>
            <button
              type="button"
              className="justify-self-start rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
            >
              More actions
            </button>
          </div>
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

        <div className="border-b border-[var(--color-border)] px-4 py-2">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label="Select all visible triage issues"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                className="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-content-bg)] accent-[var(--color-accent)]"
              />
              Select all visible
            </label>
            {selectedVisibleIssues.length > 0 ? (
              <>
                <span aria-live="polite">
                  {selectedVisibleIssues.length} selected
                </span>
                <button
                  type="button"
                  onClick={() => openBulkDecision("accept")}
                  className="rounded-md border border-green-500/30 px-2 py-1 font-medium text-green-400 hover:bg-green-400/10"
                >
                  Bulk accept
                </button>
                <button
                  type="button"
                  onClick={() => openBulkDecision("decline")}
                  className="rounded-md border border-red-500/30 px-2 py-1 font-medium text-red-400 hover:bg-red-400/10"
                >
                  Bulk decline
                </button>
                <button
                  type="button"
                  onClick={clearBulkSelection}
                  className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                >
                  Clear selection
                </button>
              </>
            ) : (
              <span>
                Use ↑/↓ or J/K to move, Space to select, Enter to review, A/D to
                accept/decline.
              </span>
            )}
            {bulkMessage ? <output>{bulkMessage}</output> : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div
            aria-label="Triage issues"
            className="min-w-0 flex-1 overflow-y-auto lg:max-w-[480px] lg:border-r lg:border-[var(--color-border)]"
            onKeyDown={handleKeyboardIntake}
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
                  checked={bulkSelectedIssueIds.has(issue.id)}
                  active={issue.id === filteredIssues[activeIssueIndex]?.id}
                  onSelect={setSelectedIssueId}
                  onToggleSelected={toggleBulkSelected}
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
