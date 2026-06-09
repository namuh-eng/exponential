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
type EditableProperty =
  | "status"
  | "priority"
  | "assignee"
  | "labels"
  | "dueDate"
  | "estimate"
  | "cycle"
  | "project"
  | "parentIssue";

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

interface PropertyOptions {
  statuses?: {
    id: string;
    name: string;
    category: StatusCategory;
    color: string;
  }[];
  priorities?: { value: PriorityValue; label: string }[];
  assignees?: { id: string; name: string | null; image: string | null }[];
  labels?: { id: string; name: string; color: string }[];
  projects?: { id: string; name: string; icon?: string | null }[];
  cycles?: { id: string; name: string | null; number: number }[];
  estimates?: { value: number; label: string }[];
}

export interface IssuePropertyUpdate {
  stateId?: string;
  priority?: PriorityValue;
  assigneeId?: string | null;
  labelIds?: string[];
  dueDate?: string | null;
  estimate?: number | null;
  cycleId?: string | null;
  projectId?: string | null;
  parentIssueId?: string | null;
}

interface IssuePropertiesProps {
  status: {
    id?: string;
    name: string;
    category: StatusCategory;
    color: string;
  };
  priority: PriorityValue;
  assignee: { id?: string; name: string; image: string | null } | null;
  labels: { id: string; name: string; color: string }[];
  project: { id?: string; name: string; icon: string | null } | null;
  dueDate?: string | null;
  estimate?: number | null;
  cycle?: { id: string; name: string | null; number: number } | null;
  parentIssue?: { id: string; identifier: string; title: string } | null;
  relations?: IssueRelationSummary[];
  issueId?: string;
  editable?: boolean;
  options?: PropertyOptions;
  savingProperty?: EditableProperty | null;
  onUpdateIssue?: (updates: IssuePropertyUpdate) => Promise<void> | void;
  onRelationAdded?: (relation: IssueRelationSummary) => void;
  onRelationRemoved?: (relationId: string) => void;
  onNavigateToIssue?: (issueIdentifier: string) => void;
}

const emptyRelations: IssueRelationSummary[] = [];

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

const defaultPriorityOptions: { value: PriorityValue; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "No priority" },
];

const defaultEstimateOptions = [1, 2, 3, 5, 8].map((value) => ({
  value,
  label: `${value} points`,
}));

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex items-center gap-3 py-1.5">
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

function dueDateInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
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

function PropertyButton({
  label,
  open,
  disabled,
  children,
  onClick,
}: {
  label: string;
  open: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      onClick={onClick}
      className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[var(--color-surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function Popover({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-label={title}
      className="absolute left-[92px] top-8 z-30 w-64 rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-2 text-[13px] shadow-xl"
    >
      {children}
    </div>
  );
}

function OptionButton({
  children,
  selected,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
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
  relations = emptyRelations,
  issueId,
  editable = false,
  options,
  savingProperty = null,
  onUpdateIssue,
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
  const [openProperty, setOpenProperty] = useState<EditableProperty | null>(
    null,
  );
  const [parentQuery, setParentQuery] = useState("");
  const [parentResults, setParentResults] = useState<IssueSearchResult[]>([]);
  const [parentSearching, setParentSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const parentInputRef = useRef<HTMLInputElement>(null);
  const manageable = Boolean(issueId && onRelationAdded && onRelationRemoved);
  const canEdit = editable && Boolean(onUpdateIssue);

  useEffect(() => {
    if (!addingType) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [addingType]);

  useEffect(() => {
    if (openProperty === "parentIssue") {
      requestAnimationFrame(() => parentInputRef.current?.focus());
    }
  }, [openProperty]);

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

  useEffect(() => {
    if (openProperty !== "parentIssue" || parentQuery.trim().length < 2) {
      setParentResults([]);
      setParentSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setParentSearching(true);
      const params = new URLSearchParams({ q: parentQuery.trim() });
      try {
        const res = await fetch(`/api/issues/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as IssueSearchResult[];
        setParentResults(data.filter((result) => result.id !== issueId));
      } catch {
        setParentResults([]);
      } finally {
        setParentSearching(false);
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [issueId, openProperty, parentQuery]);

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

  async function updateIssue(
    property: EditableProperty,
    updates: IssuePropertyUpdate,
  ) {
    if (!onUpdateIssue) return;
    setError(null);
    await onUpdateIssue(updates);
    setOpenProperty(null);
    if (property === "parentIssue") {
      setParentQuery("");
      setParentResults([]);
    }
  }

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

  const currentLabelIds = new Set(labels.map((label) => label.id));

  return (
    <div className="space-y-0.5">
      <PropertyRow label="Status">
        <PropertyButton
          label="Edit status"
          open={openProperty === "status"}
          disabled={!canEdit || savingProperty === "status"}
          onClick={() =>
            setOpenProperty((current) =>
              current === "status" ? null : "status",
            )
          }
        >
          <StatusIcon
            category={status.category}
            color={status.color}
            size={14}
          />
          <span className="text-[13px] text-[var(--color-text-primary)]">
            {status.name}
          </span>
        </PropertyButton>
        {openProperty === "status" && (
          <Popover title="Status selector">
            <div aria-label="Status options">
              {(options?.statuses ?? []).map((option) => (
                <OptionButton
                  key={option.id}
                  selected={option.id === status.id}
                  onClick={() =>
                    void updateIssue("status", { stateId: option.id })
                  }
                >
                  <StatusIcon
                    category={option.category}
                    color={option.color}
                    size={14}
                  />
                  {option.name}
                </OptionButton>
              ))}
            </div>
          </Popover>
        )}
      </PropertyRow>

      <PropertyRow label="Priority">
        <PropertyButton
          label="Edit priority"
          open={openProperty === "priority"}
          disabled={!canEdit || savingProperty === "priority"}
          onClick={() =>
            setOpenProperty((current) =>
              current === "priority" ? null : "priority",
            )
          }
        >
          <PriorityIcon priority={priorityNumeric[priority]} size={14} />
          <span className="text-[13px] text-[var(--color-text-primary)]">
            {priorityLabel[priority]}
          </span>
        </PropertyButton>
        {openProperty === "priority" && (
          <Popover title="Priority selector">
            <div aria-label="Priority options">
              {(options?.priorities ?? defaultPriorityOptions).map((option) => (
                <OptionButton
                  key={option.value}
                  selected={option.value === priority}
                  onClick={() =>
                    void updateIssue("priority", { priority: option.value })
                  }
                >
                  <PriorityIcon
                    priority={priorityNumeric[option.value]}
                    size={14}
                  />
                  {option.label}
                </OptionButton>
              ))}
            </div>
          </Popover>
        )}
      </PropertyRow>

      <PropertyRow label="Assignee">
        <PropertyButton
          label="Edit assignee"
          open={openProperty === "assignee"}
          disabled={!canEdit || savingProperty === "assignee"}
          onClick={() =>
            setOpenProperty((current) =>
              current === "assignee" ? null : "assignee",
            )
          }
        >
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
        </PropertyButton>
        {openProperty === "assignee" && (
          <Popover title="Assignee selector">
            <div aria-label="Assignee options">
              <OptionButton
                selected={!assignee}
                onClick={() =>
                  void updateIssue("assignee", { assigneeId: null })
                }
              >
                No assignee
              </OptionButton>
              {(options?.assignees ?? []).map((option) => (
                <OptionButton
                  key={option.id}
                  selected={option.id === assignee?.id}
                  onClick={() =>
                    void updateIssue("assignee", { assigneeId: option.id })
                  }
                >
                  <Avatar
                    name={option.name ?? "Member"}
                    src={option.image ?? undefined}
                    size="sm"
                  />
                  {option.name ?? "Member"}
                </OptionButton>
              ))}
            </div>
          </Popover>
        )}
      </PropertyRow>

      <PropertyRow label="Labels">
        <PropertyButton
          label="Edit labels"
          open={openProperty === "labels"}
          disabled={!canEdit || savingProperty === "labels"}
          onClick={() =>
            setOpenProperty((current) =>
              current === "labels" ? null : "labels",
            )
          }
        >
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
        </PropertyButton>
        {openProperty === "labels" && (
          <Popover title="Label selector">
            <div className="max-h-64 overflow-auto" aria-label="Label options">
              {(options?.labels ?? []).length === 0 && (
                <div className="px-2 py-1.5 text-[var(--color-text-secondary)]">
                  No labels available
                </div>
              )}
              {(options?.labels ?? []).map((option) => {
                const selected = currentLabelIds.has(option.id);
                const nextIds = selected
                  ? labels
                      .map((label) => label.id)
                      .filter((id) => id !== option.id)
                  : [...labels.map((label) => label.id), option.id];
                return (
                  <OptionButton
                    key={option.id}
                    selected={selected}
                    onClick={() =>
                      void updateIssue("labels", { labelIds: nextIds })
                    }
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: option.color }}
                    />
                    <span className="flex-1">{option.name}</span>
                    {selected ? "✓" : null}
                  </OptionButton>
                );
              })}
            </div>
          </Popover>
        )}
      </PropertyRow>

      <PropertyRow label="Due date">
        <PropertyButton
          label="Edit due date"
          open={openProperty === "dueDate"}
          disabled={!canEdit || savingProperty === "dueDate"}
          onClick={() =>
            setOpenProperty((current) =>
              current === "dueDate" ? null : "dueDate",
            )
          }
        >
          <span
            className={`text-[13px] ${dueDate ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}
          >
            {formatDueDate(dueDate)}
          </span>
        </PropertyButton>
        {openProperty === "dueDate" && (
          <Popover title="Due date picker">
            <input
              aria-label="Due date value"
              type="date"
              defaultValue={dueDateInputValue(dueDate)}
              onChange={(event) =>
                void updateIssue("dueDate", {
                  dueDate: event.target.value || null,
                })
              }
              className="w-full rounded-lg border border-[var(--color-border)] bg-transparent px-2 py-1.5 text-[13px]"
            />
            <OptionButton
              selected={!dueDate}
              onClick={() => void updateIssue("dueDate", { dueDate: null })}
            >
              Clear due date
            </OptionButton>
          </Popover>
        )}
      </PropertyRow>

      <PropertyRow label="Estimate">
        <PropertyButton
          label="Edit estimate"
          open={openProperty === "estimate"}
          disabled={!canEdit || savingProperty === "estimate"}
          onClick={() =>
            setOpenProperty((current) =>
              current === "estimate" ? null : "estimate",
            )
          }
        >
          <span
            className={`text-[13px] ${estimate !== null ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}
          >
            {estimate !== null ? `${estimate} points` : "No estimate"}
          </span>
        </PropertyButton>
        {openProperty === "estimate" && (
          <Popover title="Estimate selector">
            <div aria-label="Estimate options">
              <OptionButton
                selected={estimate === null}
                onClick={() => void updateIssue("estimate", { estimate: null })}
              >
                No estimate
              </OptionButton>
              {(options?.estimates ?? defaultEstimateOptions).map((option) => (
                <OptionButton
                  key={option.value}
                  selected={option.value === estimate}
                  onClick={() =>
                    void updateIssue("estimate", { estimate: option.value })
                  }
                >
                  {option.label}
                </OptionButton>
              ))}
            </div>
          </Popover>
        )}
      </PropertyRow>

      <PropertyRow label="Cycle">
        <PropertyButton
          label="Edit cycle"
          open={openProperty === "cycle"}
          disabled={!canEdit || savingProperty === "cycle"}
          onClick={() =>
            setOpenProperty((current) => (current === "cycle" ? null : "cycle"))
          }
        >
          <span
            className={`text-[13px] ${cycle ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}
          >
            {cycle ? cycle.name || `Cycle ${cycle.number}` : "No cycle"}
          </span>
        </PropertyButton>
        {openProperty === "cycle" && (
          <Popover title="Cycle selector">
            <div aria-label="Cycle options">
              <OptionButton
                selected={!cycle}
                onClick={() => void updateIssue("cycle", { cycleId: null })}
              >
                No cycle
              </OptionButton>
              {(options?.cycles ?? []).map((option) => (
                <OptionButton
                  key={option.id}
                  selected={option.id === cycle?.id}
                  onClick={() =>
                    void updateIssue("cycle", { cycleId: option.id })
                  }
                >
                  {option.name || `Cycle ${option.number}`}
                </OptionButton>
              ))}
            </div>
          </Popover>
        )}
      </PropertyRow>

      <PropertyRow label="Parent issue">
        <PropertyButton
          label="Edit parent issue"
          open={openProperty === "parentIssue"}
          disabled={!canEdit || savingProperty === "parentIssue"}
          onClick={() =>
            setOpenProperty((current) =>
              current === "parentIssue" ? null : "parentIssue",
            )
          }
        >
          {parentIssue ? (
            <span className="min-w-0 truncate text-[13px] text-[var(--color-text-primary)]">
              {parentIssue.identifier} · {parentIssue.title}
            </span>
          ) : (
            <span className="text-[13px] text-[var(--color-text-secondary)]">
              No parent
            </span>
          )}
        </PropertyButton>
        {openProperty === "parentIssue" && (
          <Popover title="Parent issue selector">
            <input
              ref={parentInputRef}
              aria-label="Search parent issues"
              value={parentQuery}
              onChange={(event) => setParentQuery(event.target.value)}
              placeholder="Search issues..."
              className="mb-2 w-full rounded-lg border border-[var(--color-border)] bg-transparent px-2 py-1.5 text-[13px]"
            />
            <OptionButton
              selected={!parentIssue}
              onClick={() =>
                void updateIssue("parentIssue", { parentIssueId: null })
              }
            >
              No parent
            </OptionButton>
            {parentSearching && (
              <div className="px-2 py-1.5 text-[var(--color-text-secondary)]">
                Searching…
              </div>
            )}
            {parentResults.map((result) => (
              <OptionButton
                key={result.id}
                onClick={() =>
                  void updateIssue("parentIssue", { parentIssueId: result.id })
                }
              >
                {result.identifier} · {result.title}
              </OptionButton>
            ))}
          </Popover>
        )}
      </PropertyRow>

      <PropertyRow label="Project">
        <PropertyButton
          label="Edit project"
          open={openProperty === "project"}
          disabled={!canEdit || savingProperty === "project"}
          onClick={() =>
            setOpenProperty((current) =>
              current === "project" ? null : "project",
            )
          }
        >
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
        </PropertyButton>
        {openProperty === "project" && (
          <Popover title="Project selector">
            <div aria-label="Project options">
              <OptionButton
                selected={!project}
                onClick={() => void updateIssue("project", { projectId: null })}
              >
                No project
              </OptionButton>
              {(options?.projects ?? []).map((option) => (
                <OptionButton
                  key={option.id}
                  selected={option.id === project?.id}
                  onClick={() =>
                    void updateIssue("project", { projectId: option.id })
                  }
                >
                  {option.icon ? `${option.icon} ` : ""}
                  {option.name}
                </OptionButton>
              ))}
            </div>
          </Popover>
        )}
      </PropertyRow>

      <div className="pt-4">
        <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-text-tertiary)]">
          Relations
        </div>
        <div className="space-y-1">
          {relationTypes.map((type) => (
            <div
              key={type}
              className="rounded-lg border border-transparent px-2 py-1 hover:border-[var(--color-border)]"
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[12px] text-[var(--color-text-secondary)]">
                <span>{relationLabel(type)}</span>
                <span>{relationCounts.get(type) ?? 0}</span>
              </div>
              <div className="space-y-1">
                {relations
                  .filter((relation) => relation.type === type)
                  .map((relation) => (
                    <div
                      key={relation.id}
                      className="flex items-center gap-2 rounded-md bg-[var(--color-sidebar-bg)] px-2 py-1"
                    >
                      <button
                        type="button"
                        onClick={() => navigate(relation.issue.identifier)}
                        className="min-w-0 flex-1 truncate text-left text-[12px] text-[var(--color-text-primary)] hover:underline"
                      >
                        {relation.issue.identifier} · {relation.issue.title}
                      </button>
                      {manageable && (
                        <button
                          type="button"
                          aria-label={`Remove ${relationLabel(type)} relation to ${relation.issue.identifier}`}
                          disabled={removingId === relation.id}
                          onClick={() => void removeRelation(relation.id)}
                          className="text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                {manageable && addingType === type ? (
                  <div className="rounded-lg border border-[var(--color-border)] p-2">
                    <input
                      ref={inputRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setAddingType(null);
                      }}
                      placeholder="Search issues..."
                      aria-label={`Search issues to add ${relationLabel(type)} relation`}
                      className="mb-2 w-full rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-[12px] text-[var(--color-text-primary)]"
                    />
                    {searching && (
                      <div className="px-1 py-1 text-[12px] text-[var(--color-text-secondary)]">
                        Searching…
                      </div>
                    )}
                    {!searching &&
                      query.trim().length >= 2 &&
                      results.length === 0 && (
                        <div className="px-1 py-1 text-[12px] text-[var(--color-text-secondary)]">
                          No issues found
                        </div>
                      )}
                    {results.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        disabled={savingType === type}
                        onClick={() => void addRelation(type, result.id)}
                        className="block w-full rounded-md px-2 py-1 text-left text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                      >
                        {result.identifier} · {result.title}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!manageable}
                    onClick={() => manageable && setAddingType(type)}
                    className="text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Add relation
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {error && <div className="mt-2 text-[12px] text-red-500">{error}</div>}
      </div>
    </div>
  );
}
