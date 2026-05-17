"use client";

import { Avatar } from "@/components/avatar";
import { PriorityIcon } from "@/components/icons/priority-icon";
import { StatusIcon } from "@/components/icons/status-icon";
import { useEffect, useMemo, useRef, useState } from "react";

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

type PriorityValue = "none" | "urgent" | "high" | "medium" | "low";
type RelationType = "blocks" | "blocked_by" | "duplicate" | "related";

interface IssueRelationSummary {
  id: string;
  type: RelationType;
  issue: { id: string; identifier: string; title: string };
}

interface IssueSearchResult {
  id: string;
  identifier: string;
  title: string;
}

interface IssuePropertiesProps {
  status: { name: string; category: StatusCategory; color: string };
  priority: PriorityValue;
  assignee: { name: string; image: string | null } | null;
  labels: { id: string; name: string; color: string }[];
  project: { name: string; icon: string } | null;
  dueDate?: string | null;
  estimate?: number | null;
  cycle?: { id: string; name: string | null; number: number } | null;
  parentIssue?: { id: string; identifier: string; title: string } | null;
  relations?: IssueRelationSummary[];
  issueId?: string;
  onRelationAdded?: (relation: IssueRelationSummary) => void;
  onRelationRemoved?: (relationId: string) => void;
  onNavigateToIssue?: (issueIdentifier: string) => void;
}

const relationTypes: RelationType[] = [
  "blocks",
  "blocked_by",
  "duplicate",
  "related",
];

const priorityNumeric: Record<PriorityValue, 0 | 1 | 2 | 3 | 4> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

const priorityLabel: Record<PriorityValue, string> = {
  none: "No priority",
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-[80px] shrink-0 text-[12px] text-[var(--color-text-secondary)]">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

function formatDueDate(value: string | null): string {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function relationLabel(type: RelationType): string {
  switch (type) {
    case "blocks":
      return "Blocks";
    case "blocked_by":
      return "Blocked by";
    case "duplicate":
      return "Duplicate";
    case "related":
      return "Related";
  }
}

function relationRoute(issueId: string, relationId?: string) {
  const base = `/api/issues/${encodeURIComponent(issueId)}/relations`;
  return relationId ? `${base}/${encodeURIComponent(relationId)}` : base;
}

export function IssueProperties({
  status,
  priority,
  assignee,
  labels,
  project,
  dueDate = null,
  estimate = null,
  cycle = null,
  parentIssue = null,
  relations = [],
  issueId,
  onRelationAdded,
  onRelationRemoved,
  onNavigateToIssue,
}: IssuePropertiesProps) {
  const [addingType, setAddingType] = useState<RelationType | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IssueSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [savingType, setSavingType] = useState<RelationType | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const manageable = Boolean(issueId && onRelationAdded && onRelationRemoved);

  useEffect(() => {
    if (!addingType) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [addingType]);

  useEffect(() => {
    if (!addingType || query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      const params = new URLSearchParams({ q: query.trim() });
      try {
        const res = await fetch(`/api/issues/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as IssueSearchResult[];
        const existingIssueIds = new Set(
          relations.map((relation) => relation.issue.id),
        );
        setResults(
          data.filter(
            (result) =>
              result.id !== issueId && !existingIssueIds.has(result.id),
          ),
        );
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("Couldn’t search issues.");
        }
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [addingType, issueId, query, relations]);

  const relationCounts = useMemo(
    () =>
      new Map(
        relationTypes.map((type) => [
          type,
          relations.filter((relation) => relation.type === type).length,
        ]),
      ),
    [relations],
  );

  async function addRelation(type: RelationType, targetIssueId: string) {
    if (!issueId || !onRelationAdded) return;
    setSavingType(type);
    setError(null);
    try {
      const res = await fetch(relationRoute(issueId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, targetIssueId }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error ?? "Couldn’t add relation.");
      }
      onRelationAdded(payload as IssueRelationSummary);
      setAddingType(null);
      setQuery("");
      setResults([]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Couldn’t add relation.",
      );
    } finally {
      setSavingType(null);
    }
  }

  async function removeRelation(relationId: string) {
    if (!issueId || !onRelationRemoved) return;
    setRemovingId(relationId);
    setError(null);
    try {
      const res = await fetch(relationRoute(issueId, relationId), {
        method: "DELETE",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "Couldn’t remove relation.");
      }
      onRelationRemoved(relationId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Couldn’t remove relation.",
      );
    } finally {
      setRemovingId(null);
    }
  }

  function navigate(identifier: string) {
    onNavigateToIssue?.(identifier);
  }

  return (
    <div className="space-y-0.5">
      <PropertyRow label="Status">
        <StatusIcon category={status.category} color={status.color} size={14} />
        <span className="text-[13px] text-[var(--color-text-primary)]">
          {status.name}
        </span>
      </PropertyRow>

      <PropertyRow label="Priority">
        <PriorityIcon priority={priorityNumeric[priority]} size={14} />
        <span className="text-[13px] text-[var(--color-text-primary)]">
          {priorityLabel[priority]}
        </span>
      </PropertyRow>

      <PropertyRow label="Assignee">
        {assignee ? (
          <>
            <Avatar
              name={assignee.name}
              src={assignee.image ?? undefined}
              size="sm"
            />
            <span className="text-[13px] text-[var(--color-text-primary)]">
              {assignee.name}
            </span>
          </>
        ) : (
          <span className="text-[13px] text-[var(--color-text-secondary)]">
            No assignee
          </span>
        )}
      </PropertyRow>

      <PropertyRow label="Labels">
        {labels.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {labels.map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[12px] text-[var(--color-text-primary)]"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                {l.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[13px] text-[var(--color-text-secondary)]">
            None
          </span>
        )}
      </PropertyRow>

      <PropertyRow label="Due date">
        <span
          className={`text-[13px] ${dueDate ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}
        >
          {formatDueDate(dueDate)}
        </span>
      </PropertyRow>

      <PropertyRow label="Estimate">
        <span
          className={`text-[13px] ${estimate !== null ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}
        >
          {estimate !== null ? `${estimate} points` : "No estimate"}
        </span>
      </PropertyRow>

      <PropertyRow label="Cycle">
        <span
          className={`text-[13px] ${cycle ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}
        >
          {cycle ? cycle.name || `Cycle ${cycle.number}` : "No cycle"}
        </span>
      </PropertyRow>

      <PropertyRow label="Parent issue">
        {parentIssue ? (
          <span className="min-w-0 truncate text-[13px] text-[var(--color-text-primary)]">
            {parentIssue.identifier} · {parentIssue.title}
          </span>
        ) : (
          <span className="text-[13px] text-[var(--color-text-secondary)]">
            No parent
          </span>
        )}
      </PropertyRow>

      <PropertyRow label="Project">
        {project ? (
          <span className="text-[13px] text-[var(--color-text-primary)]">
            {project.icon && <span className="mr-1">{project.icon}</span>}
            {project.name}
          </span>
        ) : (
          <span className="text-[13px] text-[var(--color-text-secondary)]">
            Add to project
          </span>
        )}
      </PropertyRow>

      <div className="pt-3">
        <div className="mb-2 text-[12px] font-medium text-[var(--color-text-secondary)]">
          Relations
        </div>
        <div className="space-y-1.5">
          {relationTypes.map((type) => {
            const typedRelations = relations.filter(
              (relation) => relation.type === type,
            );
            return (
              <div key={type} className="flex items-start gap-3 py-1">
                <span className="w-[80px] shrink-0 text-[12px] text-[var(--color-text-secondary)]">
                  {relationLabel(type)}
                </span>
                <div className="min-w-0 flex-1">
                  {typedRelations.length > 0 ? (
                    <div className="space-y-1">
                      {typedRelations.map((relation) => (
                        <div
                          key={relation.id}
                          className="group flex min-w-0 items-center gap-1"
                        >
                          <button
                            type="button"
                            onClick={() => navigate(relation.issue.identifier)}
                            className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                          >
                            {relation.issue.identifier} · {relation.issue.title}
                          </button>
                          {manageable && (
                            <button
                              type="button"
                              onClick={() => void removeRelation(relation.id)}
                              disabled={removingId === relation.id}
                              aria-label={`Remove ${relationLabel(type)} relation to ${relation.issue.identifier}`}
                              className="rounded px-1.5 py-0.5 text-[12px] text-[var(--color-text-secondary)] opacity-80 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {manageable && addingType === type ? (
                    <div className="mt-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
                      <input
                        ref={inputRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={`Search issue to ${relationLabel(type).toLowerCase()}…`}
                        aria-label={`Search issue to add ${relationLabel(type)} relation`}
                        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] px-2 py-1.5 text-[13px] text-[var(--color-text-primary)] outline-none"
                      />
                      <div className="mt-1 max-h-40 overflow-auto">
                        {searching && (
                          <div className="px-2 py-1 text-[12px] text-[var(--color-text-secondary)]">
                            Searching…
                          </div>
                        )}
                        {!searching &&
                          query.length >= 2 &&
                          results.length === 0 && (
                            <div className="px-2 py-1 text-[12px] text-[var(--color-text-secondary)]">
                              No matching issues
                            </div>
                          )}
                        {results.map((result) => (
                          <button
                            key={result.id}
                            type="button"
                            disabled={savingType === type}
                            onClick={() => void addRelation(type, result.id)}
                            className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                          >
                            <span className="font-medium">
                              {result.identifier}
                            </span>{" "}
                            · {result.title}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setAddingType(null)}
                        className="mt-1 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : manageable ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAddingType(type);
                        setQuery("");
                        setError(null);
                      }}
                      className={`rounded px-1 py-0.5 text-left text-[13px] ${relationCounts.get(type) ? "mt-1 text-[var(--color-text-secondary)]" : "text-[var(--color-text-secondary)]"} hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]`}
                    >
                      Add relation
                    </button>
                  ) : typedRelations.length === 0 ? (
                    <span className="text-[13px] text-[var(--color-text-secondary)]">
                      Add relation
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {error && <div className="mt-2 text-[12px] text-red-500">{error}</div>}
      </div>
    </div>
  );
}
