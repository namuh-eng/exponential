"use client";

import { StatusIcon } from "@/components/icons/status-icon";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

interface StatusBehavior {
  terminalBehavior?: string;
  autoArchiveDays?: number | null;
  slaBehavior?: string;
}

interface StatusItem {
  id: string;
  name: string;
  issueCount: number;
  description: string | null;
  color?: string;
  isDefault?: boolean;
  behavior?: StatusBehavior;
}

type StatusesByCategory = Record<StatusCategory, StatusItem[]>;

type DialogState =
  | { mode: "create"; category: StatusCategory }
  | { mode: "edit"; category: StatusCategory; status: StatusItem }
  | null;

const CATEGORY_ORDER: StatusCategory[] = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
];

const CATEGORY_LABELS: Record<StatusCategory, string> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Unstarted",
  started: "Started",
  completed: "Completed",
  canceled: "Canceled",
};

function formatIssueCount(count: number): string {
  if (count === 0) return "";
  if (count === 1) return "1 issue";
  return `${count} issues`;
}

function CategoryHeader({
  category,
  onAdd,
}: {
  category: StatusCategory;
  onAdd: (category: StatusCategory) => void;
}) {
  return (
    <div className="flex items-center justify-between bg-[var(--color-surface)] px-4 py-2">
      <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
        {CATEGORY_LABELS[category]}
      </span>
      <button
        type="button"
        aria-label="Add status"
        className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        onClick={() => onAdd(category)}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}

function StatusRow({
  status,
  category,
  canMoveUp,
  canMoveDown,
  onEdit,
  onMove,
}: {
  status: StatusItem;
  category: StatusCategory;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: (category: StatusCategory, status: StatusItem) => void;
  onMove: (
    category: StatusCategory,
    statusId: string,
    direction: -1 | 1,
  ) => void;
}) {
  const countText = formatIssueCount(status.issueCount);

  return (
    <div
      data-testid="status-item"
      className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <StatusIcon category={category} size={18} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
            {status.name}
          </span>
          {status.isDefault && (
            <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
              Default
            </span>
          )}
          {countText && (
            <span className="text-[12px] text-[var(--color-text-tertiary)]">
              {countText}
            </span>
          )}
        </div>
        {status.description && (
          <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
            {status.description}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Move ${status.name} up`}
          disabled={!canMoveUp}
          onClick={() => onMove(category, status.id, -1)}
          className="rounded px-2 py-1 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] disabled:opacity-40"
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${status.name} down`}
          disabled={!canMoveDown}
          onClick={() => onMove(category, status.id, 1)}
          className="rounded px-2 py-1 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] disabled:opacity-40"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => onEdit(category, status)}
          className="rounded px-2 py-1 text-[12px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function StatusDialog({
  dialog,
  saving,
  allStatuses,
  errorMessage,
  workflowHref,
  onClose,
  onSubmit,
  onDelete,
}: {
  dialog: DialogState;
  saving: boolean;
  allStatuses: StatusItem[];
  errorMessage: string;
  workflowHref: string;
  onClose: () => void;
  onSubmit: (values: {
    name: string;
    description: string;
    color: string;
    category: StatusCategory;
    isDefault: boolean;
    behavior: StatusBehavior;
  }) => void;
  onDelete: (status: StatusItem, replacementStatusId?: string) => void;
}) {
  const [name, setName] = useState(
    dialog?.mode === "edit" ? dialog.status.name : "",
  );
  const [description, setDescription] = useState(
    dialog?.mode === "edit" ? (dialog.status.description ?? "") : "",
  );
  const [color, setColor] = useState(
    dialog?.mode === "edit" ? (dialog.status.color ?? "#6b6f76") : "#6b6f76",
  );
  const [category, setCategory] = useState<StatusCategory>(
    dialog?.category ?? "unstarted",
  );
  const [isDefault, setIsDefault] = useState(
    dialog?.mode === "edit" ? dialog.status.isDefault === true : false,
  );
  const [terminalBehavior, setTerminalBehavior] = useState(
    dialog?.mode === "edit"
      ? (dialog.status.behavior?.terminalBehavior ?? "standard")
      : "standard",
  );
  const [autoArchiveDays, setAutoArchiveDays] = useState(
    dialog?.mode === "edit" &&
      typeof dialog.status.behavior?.autoArchiveDays === "number"
      ? String(dialog.status.behavior.autoArchiveDays)
      : "",
  );
  const [slaBehavior, setSlaBehavior] = useState(
    dialog?.mode === "edit"
      ? (dialog.status.behavior?.slaBehavior ?? "inherit")
      : "inherit",
  );
  const [replacementStatusId, setReplacementStatusId] = useState("");

  useEffect(() => {
    setName(dialog?.mode === "edit" ? dialog.status.name : "");
    setDescription(
      dialog?.mode === "edit" ? (dialog.status.description ?? "") : "",
    );
    setColor(
      dialog?.mode === "edit" ? (dialog.status.color ?? "#6b6f76") : "#6b6f76",
    );
    setCategory(dialog?.category ?? "unstarted");
    setIsDefault(
      dialog?.mode === "edit" ? dialog.status.isDefault === true : false,
    );
    setTerminalBehavior(
      dialog?.mode === "edit"
        ? (dialog.status.behavior?.terminalBehavior ?? "standard")
        : "standard",
    );
    setAutoArchiveDays(
      dialog?.mode === "edit" &&
        typeof dialog.status.behavior?.autoArchiveDays === "number"
        ? String(dialog.status.behavior.autoArchiveDays)
        : "",
    );
    setSlaBehavior(
      dialog?.mode === "edit"
        ? (dialog.status.behavior?.slaBehavior ?? "inherit")
        : "inherit",
    );
    setReplacementStatusId("");
  }, [dialog]);

  if (!dialog) return null;

  const replacementOptions =
    dialog.mode === "edit"
      ? allStatuses.filter((status) => status.id !== dialog.status.id)
      : [];
  const needsReplacement =
    dialog.mode === "edit" &&
    dialog.status.issueCount > 0 &&
    dialog.status.isDefault !== true;
  const deleteDisabled =
    saving ||
    (dialog.mode === "edit" && dialog.status.isDefault === true) ||
    (needsReplacement && !replacementStatusId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        aria-label={dialog.mode === "create" ? "Create status" : "Edit status"}
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            name,
            description,
            color,
            category,
            isDefault,
            behavior: {
              terminalBehavior,
              autoArchiveDays: autoArchiveDays.trim()
                ? Number(autoArchiveDays)
                : null,
              slaBehavior,
            },
          });
        }}
      >
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
          {dialog.mode === "create"
            ? `Add ${CATEGORY_LABELS[dialog.category]} status`
            : "Edit status"}
        </h2>
        <label className="mt-4 block text-[12px] font-medium text-[var(--color-text-secondary)]">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none"
            required
          />
        </label>
        <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
          Description
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none"
          />
        </label>
        <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
          Workflow type
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as StatusCategory)
            }
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none"
          >
            {CATEGORY_ORDER.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
          Color
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="mt-1 h-9 w-16 rounded border border-[var(--color-border)] bg-transparent"
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            checked={isDefault}
            disabled={
              dialog.mode === "edit" &&
              dialog.status.isDefault === true &&
              category === dialog.category
            }
            onChange={(event) => setIsDefault(event.target.checked)}
          />
          Default status for this workflow type
        </label>
        <div className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="text-[12px] font-semibold text-[var(--color-text-primary)]">
            Workflow behavior
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
            Controls how issues in this status behave in lifecycle automations,
            SLA reporting, and terminal lists.
          </p>
          <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
            Terminal behavior
            <select
              value={terminalBehavior}
              onChange={(event) => setTerminalBehavior(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none"
            >
              <option value="standard">Standard workflow status</option>
              <option value="completed">
                Completed/resolved terminal status
              </option>
              <option value="canceled">
                Canceled/declined terminal status
              </option>
            </select>
          </label>
          <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
            Auto-close/archive after days
            <input
              type="number"
              min="0"
              value={autoArchiveDays}
              onChange={(event) => setAutoArchiveDays(event.target.value)}
              placeholder="Inherit team default"
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none"
            />
          </label>
          <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
            SLA behavior
            <select
              value={slaBehavior}
              onChange={(event) => setSlaBehavior(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none"
            >
              <option value="inherit">Inherit team SLA behavior</option>
              <option value="pause">Pause SLA timer</option>
              <option value="complete">Satisfy SLA when entered</option>
              <option value="ignore">Exclude from SLA reporting</option>
            </select>
          </label>
          <a
            href={workflowHref}
            className="mt-3 inline-flex text-[12px] font-medium text-[var(--color-accent)] hover:underline"
          >
            Configure workflow automations
          </a>
        </div>
        {needsReplacement && (
          <div className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              Deleting this status will move{" "}
              {formatIssueCount(dialog.status.issueCount)} to another status.
            </p>
            <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Move existing issues to
              <select
                value={replacementStatusId}
                onChange={(event) => setReplacementStatusId(event.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none"
              >
                <option value="">Select a replacement status</option>
                {replacementOptions.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {dialog.mode === "edit" && dialog.status.isDefault === true && (
          <p className="mt-3 text-[12px] text-[var(--color-text-tertiary)]">
            Default statuses cannot be deleted. Choose another default before
            removing this status.
          </p>
        )}
        {errorMessage && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-500">
            {errorMessage}
          </div>
        )}
        <div className="mt-5 flex items-center justify-between gap-2">
          {dialog.mode === "edit" && (
            <button
              type="button"
              disabled={deleteDisabled}
              onClick={() =>
                onDelete(
                  dialog.status,
                  needsReplacement ? replacementStatusId : undefined,
                )
              }
              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-40"
            >
              Delete
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-[var(--color-text-primary)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-background)] disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function TeamIssueStatusesPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const workspaceSlug =
    typeof params.workspaceSlug === "string" ? params.workspaceSlug : null;
  const workflowHref = workspaceSlug
    ? `/${workspaceSlug}/settings/teams/${teamKey}/workflows`
    : `/settings/teams/${teamKey}/workflows`;
  const [statuses, setStatuses] = useState<StatusesByCategory | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [duplicateStatus, setDuplicateStatus] = useState("");
  const [message, setMessage] = useState("");
  const [mutationError, setMutationError] = useState("");

  const allStatuses = useMemo(
    () => CATEGORY_ORDER.flatMap((cat) => statuses?.[cat] ?? []),
    [statuses],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadStatuses() {
      setLoading(true);
      const res = await fetch(`/api/teams/${teamKey}/statuses`);
      const data = await res.json();
      if (!isMounted) return;
      setStatuses(data.statuses);
      setDuplicateStatus(data.duplicateStatusId ?? "");
      setLoading(false);
    }

    loadStatuses().catch(() => {
      if (!isMounted) return;
      setStatuses(null);
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [teamKey]);

  async function mutate(init: RequestInit, successMessage: string) {
    setSaving(true);
    setMessage("");
    setMutationError("");
    const res = await fetch(`/api/teams/${teamKey}/statuses`, init);
    const data = await res.json();
    if (!res.ok) {
      setMutationError(data.error ?? "Unable to save statuses.");
      setSaving(false);
      return false;
    }
    setStatuses(data.statuses);
    setDuplicateStatus(data.duplicateStatusId ?? "");
    setMessage(successMessage);
    setSaving(false);
    return true;
  }

  async function handleDialogSubmit(values: {
    name: string;
    description: string;
    color: string;
    category: StatusCategory;
    isDefault: boolean;
    behavior: StatusBehavior;
  }) {
    if (!dialog) return;
    const ok = await mutate(
      {
        method: dialog.mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          dialog.mode === "create"
            ? values
            : { ...values, id: dialog.status.id },
        ),
      },
      dialog.mode === "create" ? "Status created." : "Status updated.",
    );
    if (ok) setDialog(null);
  }

  async function handleDelete(
    status: StatusItem,
    replacementStatusId?: string,
  ) {
    const ok = await mutate(
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: status.id, replacementStatusId }),
      },
      "Status deleted.",
    );
    if (ok) setDialog(null);
  }

  async function handleMove(
    category: StatusCategory,
    statusId: string,
    direction: -1 | 1,
  ) {
    if (!statuses) return;
    const nextIds = statuses[category].map((status) => status.id);
    const index = nextIds.indexOf(statusId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= nextIds.length) return;
    [nextIds[index], nextIds[targetIndex]] = [
      nextIds[targetIndex],
      nextIds[index],
    ];
    await mutate(
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reorder: { category, orderedIds: nextIds } }),
      },
      "Status order saved.",
    );
  }

  async function handleDuplicateStatusChange(statusId: string) {
    setDuplicateStatus(statusId);
    await mutate(
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateStatusId: statusId }),
      },
      "Duplicate issue status saved.",
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (!statuses) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        No statuses found
      </div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <h1 className="mb-2 text-[20px] font-semibold text-[var(--color-text-primary)]">
        Issue statuses
      </h1>
      <p className="mb-6 text-[13px] text-[var(--color-text-tertiary)]">
        Issue statuses define the workflow that issues go through from start to
        completion.
      </p>

      {message && (
        <div className="mb-4 rounded-md border border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        {CATEGORY_ORDER.map((category) => (
          <div key={category}>
            <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-[12px] text-[var(--color-text-tertiary)]">
              Default {CATEGORY_LABELS[category].toLowerCase()} status:{" "}
              <select
                aria-label={`${CATEGORY_LABELS[category]} default status`}
                value={
                  (statuses[category] || []).find((status) => status.isDefault)
                    ?.id ?? ""
                }
                onChange={(event) =>
                  mutate(
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        id: event.target.value,
                        isDefault: true,
                      }),
                    },
                    "Default status saved.",
                  )
                }
                className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-[12px] text-[var(--color-text-primary)]"
              >
                {(statuses[category] || []).map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </select>
            </div>
            <CategoryHeader
              category={category}
              onAdd={(selectedCategory) => {
                setMutationError("");
                setDialog({ mode: "create", category: selectedCategory });
              }}
            />
            {(statuses[category] || []).map(
              (status, index, categoryStatuses) => (
                <StatusRow
                  key={status.id}
                  status={status}
                  category={category}
                  canMoveUp={index > 0}
                  canMoveDown={index < categoryStatuses.length - 1}
                  onEdit={(editCategory, editStatus) => {
                    setMutationError("");
                    setDialog({
                      mode: "edit",
                      category: editCategory,
                      status: editStatus,
                    });
                  }}
                  onMove={handleMove}
                />
              ),
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-[var(--color-border)] p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
              Duplicate issue status
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
              Status to set when an issue is marked as a duplicate
            </div>
          </div>
          <select
            aria-label="Duplicate issue status"
            value={duplicateStatus}
            onChange={(e) => handleDuplicateStatusChange(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] outline-none"
          >
            {allStatuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <StatusDialog
        dialog={dialog}
        saving={saving}
        allStatuses={allStatuses}
        errorMessage={dialog ? mutationError : ""}
        workflowHref={workflowHref}
        onClose={() => setDialog(null)}
        onSubmit={handleDialogSubmit}
        onDelete={handleDelete}
      />
    </div>
  );
}
