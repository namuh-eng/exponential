"use client";

import { StatusIcon } from "@/components/icons/status-icon";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

type StatusTerminalBehavior = "none" | "completed" | "canceled";
type StatusSlaBehavior = "counts" | "pauses" | "breached";

interface StatusBehavior {
  terminalBehavior: StatusTerminalBehavior;
  slaBehavior: StatusSlaBehavior;
  autoCloseEnabled: boolean;
  autoCloseDays: number | null;
  archiveClosedIssues: boolean;
  automationLinkEnabled: boolean;
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

type StatusWithCategory = StatusItem & { category: StatusCategory };
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

const DEFAULT_BEHAVIOR: Record<StatusCategory, StatusBehavior> = {
  triage: {
    terminalBehavior: "none",
    slaBehavior: "breached",
    autoCloseEnabled: false,
    autoCloseDays: null,
    archiveClosedIssues: false,
    automationLinkEnabled: true,
  },
  backlog: {
    terminalBehavior: "none",
    slaBehavior: "counts",
    autoCloseEnabled: false,
    autoCloseDays: null,
    archiveClosedIssues: false,
    automationLinkEnabled: true,
  },
  unstarted: {
    terminalBehavior: "none",
    slaBehavior: "counts",
    autoCloseEnabled: false,
    autoCloseDays: null,
    archiveClosedIssues: false,
    automationLinkEnabled: true,
  },
  started: {
    terminalBehavior: "none",
    slaBehavior: "counts",
    autoCloseEnabled: false,
    autoCloseDays: null,
    archiveClosedIssues: false,
    automationLinkEnabled: true,
  },
  completed: {
    terminalBehavior: "completed",
    slaBehavior: "pauses",
    autoCloseEnabled: false,
    autoCloseDays: 14,
    archiveClosedIssues: true,
    automationLinkEnabled: true,
  },
  canceled: {
    terminalBehavior: "canceled",
    slaBehavior: "pauses",
    autoCloseEnabled: false,
    autoCloseDays: 14,
    archiveClosedIssues: true,
    automationLinkEnabled: true,
  },
};

function behaviorFor(category: StatusCategory, status?: StatusItem) {
  return { ...DEFAULT_BEHAVIOR[category], ...(status?.behavior ?? {}) };
}

function formatIssueCount(count: number): string {
  if (count === 0) return "";
  if (count === 1) return "1 issue";
  return `${count} issues`;
}

function behaviorSummary(category: StatusCategory, behavior?: StatusBehavior) {
  const resolved = behavior ?? DEFAULT_BEHAVIOR[category];
  if (resolved.terminalBehavior === "completed") return "Completes issues";
  if (resolved.terminalBehavior === "canceled") return "Cancels issues";
  if (resolved.slaBehavior === "pauses") return "Pauses SLA";
  if (resolved.slaBehavior === "breached") return "SLA attention";
  return "Active workflow";
}

function CategoryHeader({
  category,
  statuses,
  saving,
  onAdd,
  onDefaultChange,
}: {
  category: StatusCategory;
  statuses: StatusItem[];
  saving: boolean;
  onAdd: (category: StatusCategory) => void;
  onDefaultChange: (category: StatusCategory, statusId: string) => void;
}) {
  const defaultStatus = statuses.find((status) => status.isDefault);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--color-surface)] px-4 py-2">
      <div>
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          {CATEGORY_LABELS[category]}
        </span>
        <div className="text-[11px] text-[var(--color-text-tertiary)]">
          Default: {defaultStatus?.name ?? "Not configured"}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {statuses.length > 0 && (
          <label className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
            Default status
            <select
              aria-label={`Default ${CATEGORY_LABELS[category]} status`}
              value={defaultStatus?.id ?? ""}
              disabled={saving}
              onChange={(event) =>
                onDefaultChange(category, event.target.value)
              }
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-[12px] text-[var(--color-text-primary)] outline-none"
            >
              <option value="" disabled>
                Select default
              </option>
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
  const behavior = behaviorFor(category, status);

  return (
    <div
      data-testid="status-item"
      className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <StatusIcon category={category} color={status.color} size={18} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
            {status.name}
          </span>
          <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
            {CATEGORY_LABELS[category]}
          </span>
          {status.isDefault && (
            <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]">
              Default
            </span>
          )}
          <span className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
            {behaviorSummary(category, behavior)}
          </span>
          {countText && (
            <span className="text-[12px] text-[var(--color-text-tertiary)]">
              {countText}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] text-[var(--color-text-tertiary)]">
          {status.description ||
            (behavior.autoCloseEnabled && behavior.autoCloseDays
              ? `Auto-closes after ${behavior.autoCloseDays} days`
              : "Configured for issue lifecycle behavior")}
        </div>
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
  workspaceSlug,
  teamKey,
  errorMessage,
  onClose,
  onSubmit,
  onDelete,
}: {
  dialog: DialogState;
  saving: boolean;
  allStatuses: StatusWithCategory[];
  workspaceSlug?: string;
  teamKey: string;
  errorMessage: string;
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#6b6f76");
  const [category, setCategory] = useState<StatusCategory>("backlog");
  const [isDefault, setIsDefault] = useState(false);
  const [behavior, setBehavior] = useState<StatusBehavior>(
    DEFAULT_BEHAVIOR.backlog,
  );
  const [replacementStatusId, setReplacementStatusId] = useState("");

  useEffect(() => {
    if (!dialog) return;
    const nextCategory = dialog.category;
    setName(dialog.mode === "edit" ? dialog.status.name : "");
    setDescription(
      dialog.mode === "edit" ? (dialog.status.description ?? "") : "",
    );
    setColor(
      dialog.mode === "edit" ? (dialog.status.color ?? "#6b6f76") : "#6b6f76",
    );
    setCategory(nextCategory);
    setIsDefault(
      dialog.mode === "edit" ? dialog.status.isDefault === true : false,
    );
    setBehavior(
      behaviorFor(
        nextCategory,
        dialog.mode === "edit" ? dialog.status : undefined,
      ),
    );
    setReplacementStatusId("");
  }, [dialog]);

  useEffect(() => {
    setBehavior((current) => ({
      ...DEFAULT_BEHAVIOR[category],
      ...current,
      terminalBehavior:
        category === "completed"
          ? "completed"
          : category === "canceled"
            ? "canceled"
            : current.terminalBehavior === "completed" ||
                current.terminalBehavior === "canceled"
              ? "none"
              : current.terminalBehavior,
    }));
  }, [category]);

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
  const workflowsHref = workspaceSlug
    ? `/${encodeURIComponent(workspaceSlug)}/settings/teams/${encodeURIComponent(teamKey)}/workflows`
    : `/settings/teams/${encodeURIComponent(teamKey)}/workflows`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        aria-label={dialog.mode === "create" ? "Create status" : "Edit status"}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ name, description, color, category, isDefault, behavior });
        }}
      >
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
          {dialog.mode === "create"
            ? "Add workflow status"
            : "Edit workflow status"}
        </h2>
        <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
          Configure the status type, default handling, SLA semantics, and
          automation behavior used by issue creation, issue details, boards,
          triage, and duplicate resolution.
        </p>
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
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
            Workflow type
            <select
              aria-label="Workflow type"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as StatusCategory)
              }
              className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none"
            >
              {CATEGORY_ORDER.map((item) => (
                <option key={item} value={item}>
                  {CATEGORY_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
            Color
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="mt-1 h-9 w-16 rounded border border-[var(--color-border)] bg-transparent"
            />
          </label>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            aria-label="Default status for this category"
            checked={isDefault}
            disabled={
              dialog.mode === "edit" && dialog.status.isDefault === true
            }
            onChange={(event) => setIsDefault(event.target.checked)}
          />
          Default status for {CATEGORY_LABELS[category]}
        </label>

        <section className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <h3 className="text-[13px] font-medium text-[var(--color-text-primary)]">
            Workflow behavior
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Terminal behavior
              <select
                aria-label="Terminal behavior"
                value={behavior.terminalBehavior}
                disabled={category === "completed" || category === "canceled"}
                onChange={(event) =>
                  setBehavior((current) => ({
                    ...current,
                    terminalBehavior: event.target
                      .value as StatusTerminalBehavior,
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none disabled:opacity-70"
              >
                <option value="none">Active / non-terminal</option>
                <option value="completed">Completes issue</option>
                <option value="canceled">Cancels issue</option>
              </select>
            </label>
            <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
              SLA behavior
              <select
                aria-label="SLA behavior"
                value={behavior.slaBehavior}
                onChange={(event) =>
                  setBehavior((current) => ({
                    ...current,
                    slaBehavior: event.target.value as StatusSlaBehavior,
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none"
              >
                <option value="counts">Counts toward SLA</option>
                <option value="pauses">Pauses SLA</option>
                <option value="breached">Requires triage/SLA attention</option>
              </select>
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={behavior.autoCloseEnabled}
              onChange={(event) =>
                setBehavior((current) => ({
                  ...current,
                  autoCloseEnabled: event.target.checked,
                  autoCloseDays: current.autoCloseDays ?? 14,
                }))
              }
            />
            Auto-close/archive issues in this status
          </label>
          {behavior.autoCloseEnabled && (
            <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Auto-close after days
              <input
                type="number"
                min={1}
                max={365}
                value={behavior.autoCloseDays ?? 14}
                onChange={(event) =>
                  setBehavior((current) => ({
                    ...current,
                    autoCloseDays: Number(event.target.value),
                  }))
                }
                className="mt-1 w-28 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none"
              />
            </label>
          )}
          <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={behavior.archiveClosedIssues}
              onChange={(event) =>
                setBehavior((current) => ({
                  ...current,
                  archiveClosedIssues: event.target.checked,
                }))
              }
            />
            Hide terminal issues from active lists
          </label>
          <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={behavior.automationLinkEnabled}
              onChange={(event) =>
                setBehavior((current) => ({
                  ...current,
                  automationLinkEnabled: event.target.checked,
                }))
              }
            />
            Available to workflow automations
          </label>
          <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
            Configure status-driven transitions on the{" "}
            <Link
              href={workflowsHref}
              className="text-[var(--color-accent)] hover:underline"
            >
              Workflows & automations
            </Link>{" "}
            page.
          </p>
        </section>

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
                    {status.name} ({CATEGORY_LABELS[status.category]})
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
  const workspaceSlug = params.workspaceSlug as string | undefined;
  const [statuses, setStatuses] = useState<StatusesByCategory | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [duplicateStatus, setDuplicateStatus] = useState("");
  const [message, setMessage] = useState("");
  const [mutationError, setMutationError] = useState("");

  const allStatuses = useMemo<StatusWithCategory[]>(
    () =>
      CATEGORY_ORDER.flatMap((cat) =>
        (statuses?.[cat] ?? []).map((status) => ({ ...status, category: cat })),
      ),
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

  async function handleDefaultChange(
    _category: StatusCategory,
    statusId: string,
  ) {
    if (!statusId) return;
    await mutate(
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: statusId, isDefault: true }),
      },
      "Default status saved.",
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
    <div className="max-w-[840px]">
      <h1 className="mb-2 text-[20px] font-semibold text-[var(--color-text-primary)]">
        Issue statuses
      </h1>
      <p className="mb-6 text-[13px] text-[var(--color-text-tertiary)]">
        Issue statuses define the team workflow, default states, terminal
        behavior, SLA handling, and automation touchpoints used throughout the
        issue lifecycle.
      </p>

      {message && (
        <div className="mb-4 rounded-md border border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
          {message}
        </div>
      )}

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--color-border)] p-3">
          <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
            Defaults per workflow type
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
            Pick the status used for issue creation, triage decisions, and
            fallback workflow moves.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] p-3">
          <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
            Terminal semantics
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
            Completed and canceled statuses drive completed/canceled issue
            timestamps and active-list visibility.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] p-3">
          <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
            Automation links
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
            Statuses remain available to boards, issue properties, duplicate
            handling, and workflow automation rules.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        {CATEGORY_ORDER.map((category) => (
          <div key={category}>
            <CategoryHeader
              category={category}
              statuses={statuses[category] || []}
              saving={saving}
              onAdd={(selectedCategory) => {
                setMutationError("");
                setDialog({ mode: "create", category: selectedCategory });
              }}
              onDefaultChange={handleDefaultChange}
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
        <div className="flex items-center justify-between gap-4">
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
                {s.name} ({CATEGORY_LABELS[s.category]})
              </option>
            ))}
          </select>
        </div>
      </div>

      <StatusDialog
        dialog={dialog}
        saving={saving}
        allStatuses={allStatuses}
        workspaceSlug={workspaceSlug}
        teamKey={teamKey}
        errorMessage={dialog ? mutationError : ""}
        onClose={() => setDialog(null)}
        onSubmit={handleDialogSubmit}
        onDelete={handleDelete}
      />
    </div>
  );
}
