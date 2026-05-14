"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface LabelData {
  id: string;
  name: string;
  color: string;
  description: string | null;
  parentLabelId: string | null;
  issueCount: number;
  lastApplied: string | null;
  createdAt: string;
}

type CreateMode = "group" | "label";
interface CreateState {
  mode: CreateMode;
  parentLabelId: string | null;
}
type SortDirection = "asc" | "desc";

const LABEL_COLORS = [
  "#e5484d",
  "#e54666",
  "#f76b15",
  "#f5a623",
  "#f2c94c",
  "#4cb782",
  "#3b82f6",
  "#7180ff",
  "#8b5cf6",
  "#d946ef",
  "#ec4899",
  "#6b6f76",
];

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const now = new Date();
  const d = new Date(dateStr);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 7) return `${diffDays} days ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return "1 week ago";
  if (diffWeeks < 5) return `${diffWeeks} weeks ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "1 month ago";
  if (diffMonths < 12) return `${diffMonths} months ago`;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatCreatedDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function ColorDot({ color }: { color: string }) {
  return (
    <span
      data-testid="color-dot"
      className="inline-block h-3 w-3 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function InlineDescription({
  value,
  labelId,
  onSave,
}: {
  value: string | null;
  labelId: string;
  onSave: (id: string, desc: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  const handleSave = () => {
    setEditing(false);
    if (text !== (value || "")) {
      onSave(labelId, text);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") {
            setText(value || "");
            setEditing(false);
          }
        }}
        className="w-full rounded border border-[var(--color-border)] bg-transparent px-1 py-0.5 text-[12px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        placeholder="Add label description..."
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="w-full truncate text-left text-[12px]"
    >
      {value ? (
        <span className="text-[var(--color-text-tertiary)]">{value}</span>
      ) : (
        <span className="italic text-[var(--color-text-tertiary)] opacity-50">
          Add label description...
        </span>
      )}
    </button>
  );
}

function CreateLabelModal({
  mode,
  parentLabelId = null,
  parentLabelName,
  onClose,
  onCreate,
}: {
  mode: CreateMode;
  onClose: () => void;
  parentLabelId?: string | null;
  parentLabelName?: string | null;
  onCreate: (payload: {
    name: string;
    color: string;
    description: string;
    parentLabelId: string | null;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      color: mode === "group" ? "#6b6f76" : color,
      description: description.trim(),
      parentLabelId: mode === "label" ? parentLabelId : null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[400px] rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6 shadow-xl">
        <h2 className="mb-4 text-[16px] font-semibold text-[var(--color-text-primary)]">
          {mode === "group" ? "Create group" : "Create label"}
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label
              htmlFor="label-name"
              className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Name
            </label>
            <input
              ref={nameRef}
              id="label-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              placeholder="Label name"
            />
          </div>
          <div className="mb-4">
            <label
              htmlFor="label-description"
              className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Description
            </label>
            <input
              id="label-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              placeholder="Add label description..."
            />
          </div>
          {mode === "label" && parentLabelName ? (
            <p className="mb-4 rounded-md border border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
              Creating under{" "}
              <span className="font-medium text-[var(--color-text-primary)]">
                {parentLabelName}
              </span>
            </p>
          ) : null}
          {mode === "label" ? (
            <div className="mb-6">
              <label
                htmlFor="label-color"
                className="mb-2 block text-[12px] text-[var(--color-text-secondary)]"
              >
                Color
              </label>
              <div className="flex flex-wrap gap-2" id="label-color">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-6 w-6 rounded-full border-2 transition-all ${
                      color === c
                        ? "border-white scale-110"
                        : "border-transparent hover:border-[var(--color-border)]"
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {mode === "group" ? "Create group" : "Create label"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditLabelModal({
  label,
  onClose,
  labels,
  onSave,
}: {
  label: LabelData;
  labels: LabelData[];
  onClose: () => void;
  onSave: (payload: {
    id: string;
    name: string;
    color: string;
    description: string;
    parentLabelId: string | null;
  }) => void;
}) {
  const [name, setName] = useState(label.name);
  const [description, setDescription] = useState(label.description || "");
  const [color, setColor] = useState(label.color);
  const [parentLabelId, setParentLabelId] = useState(label.parentLabelId || "");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      id: label.id,
      name: name.trim(),
      color,
      description: description.trim(),
      parentLabelId: parentLabelId || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[400px] rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6 shadow-xl">
        <h2 className="mb-4 text-[16px] font-semibold text-[var(--color-text-primary)]">
          Edit label
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label
              htmlFor="edit-label-name"
              className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Name
            </label>
            <input
              ref={nameRef}
              id="edit-label-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              placeholder="Label name"
            />
          </div>
          <div className="mb-4">
            <label
              htmlFor="edit-label-description"
              className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Description
            </label>
            <input
              id="edit-label-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              placeholder="Add label description..."
            />
          </div>
          <div className="mb-4">
            <label
              htmlFor="edit-label-group"
              className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Group
            </label>
            <select
              id="edit-label-group"
              value={parentLabelId}
              onChange={(e) => setParentLabelId(e.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">No group</option>
              {labels
                .filter(
                  (candidate) =>
                    candidate.id !== label.id && !candidate.parentLabelId,
                )
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="mb-6">
            <label
              htmlFor="edit-label-color"
              className="mb-2 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Color
            </label>
            <div className="flex flex-wrap gap-2" id="edit-label-color">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-6 w-6 rounded-full border-2 transition-all ${
                    color === c
                      ? "border-white scale-110"
                      : "border-transparent hover:border-[var(--color-border)]"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LabelRow({
  labelItem,
  isChild,
  onAddChild,
  onEdit,
  onDelete,
  onUpdateDescription,
}: {
  labelItem: LabelData;
  isChild: boolean;
  onAddChild?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdateDescription: (id: string, desc: string) => void;
}) {
  return (
    <div
      className="group flex h-[44px] items-center border-b border-[var(--color-border)] text-[13px] transition-colors hover:bg-[var(--color-surface-hover)]"
      data-testid={isChild ? "nested-label-row" : "label-row"}
    >
      <div
        className={`flex min-w-0 flex-1 items-center gap-2 px-4 ${isChild ? "pl-10" : ""}`}
      >
        {isChild ? (
          <span
            className="text-[var(--color-text-tertiary)]"
            aria-hidden="true"
          >
            ↳
          </span>
        ) : null}
        <ColorDot color={labelItem.color} />
        <span
          data-testid="label-name"
          className="truncate text-[var(--color-text-primary)]"
        >
          {labelItem.name}
        </span>
        {onAddChild ? (
          <button
            type="button"
            onClick={onAddChild}
            className="ml-auto rounded px-2 py-1 text-[11px] text-[var(--color-text-tertiary)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus:opacity-100"
            aria-label={`Add label under ${labelItem.name}`}
          >
            Add label
          </button>
        ) : (
          <span className="ml-auto" />
        )}
        <button
          type="button"
          onClick={onEdit}
          className="rounded px-2 py-1 text-[11px] text-[var(--color-text-tertiary)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus:opacity-100"
          aria-label={`Edit ${labelItem.name}`}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded px-2 py-1 text-[11px] text-[var(--color-text-tertiary)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--color-surface-hover)] hover:text-[#f87171] focus:opacity-100"
          aria-label={`Delete ${labelItem.name}`}
        >
          Delete
        </button>
      </div>
      <div className="w-[200px] shrink-0 px-2">
        <InlineDescription
          value={labelItem.description}
          labelId={labelItem.id}
          onSave={onUpdateDescription}
        />
      </div>
      <div className="w-[60px] shrink-0 px-2 text-center text-[12px] text-[var(--color-text-tertiary)]">
        —
      </div>
      <div className="w-[60px] shrink-0 px-2 text-center text-[12px] text-[var(--color-text-secondary)]">
        {labelItem.issueCount}
      </div>
      <div className="w-[100px] shrink-0 px-2 text-[12px] text-[var(--color-text-tertiary)]">
        {formatRelativeTime(labelItem.lastApplied)}
      </div>
      <div className="w-[90px] shrink-0 px-2 text-[12px] text-[var(--color-text-tertiary)]">
        {formatCreatedDate(labelItem.createdAt)}
      </div>
    </div>
  );
}

export default function IssueLabelsPage() {
  const [labels, setLabels] = useState<LabelData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [createState, setCreateState] = useState<CreateState | null>(null);
  const [editingLabel, setEditingLabel] = useState<LabelData | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const fetchLabels = useCallback(() => {
    setError(null);
    fetch("/api/labels")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load labels");
        }
        return res.json();
      })
      .then((data) => {
        setLabels(data.labels ?? []);
      })
      .catch(() => {
        setLabels([]);
        setError("Could not load labels right now.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchLabels();
  }, [fetchLabels]);

  const handleUpdateDescription = async (id: string, description: string) => {
    const res = await fetch(`/api/labels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    if (!res.ok) {
      setError("Could not save that description.");
      return;
    }
    setLabels((prev) =>
      prev.map((l) => (l.id === id ? { ...l, description } : l)),
    );
  };

  const handleCreate = async ({
    name,
    color,
    description,
    parentLabelId,
  }: {
    name: string;
    color: string;
    description: string;
    parentLabelId: string | null;
  }) => {
    const res = await fetch("/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color, description, parentLabelId }),
    });
    if (res.ok) {
      setCreateState(null);
      fetchLabels();
      return;
    }
    setError("Could not create that item.");
  };

  const handleEdit = async ({
    id,
    name,
    color,
    description,
    parentLabelId,
  }: {
    id: string;
    name: string;
    color: string;
    description: string;
    parentLabelId: string | null;
  }) => {
    const res = await fetch(`/api/labels/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color, description, parentLabelId }),
    });
    if (!res.ok) {
      setError("Could not save that label.");
      return;
    }

    setLabels((prev) =>
      prev.map((l) =>
        l.id === id
          ? {
              ...l,
              name,
              color,
              description: description || null,
              parentLabelId,
            }
          : l,
      ),
    );
    setEditingLabel(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete ${name}?`)) {
      return;
    }

    const res = await fetch(`/api/labels/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not delete that item.");
      return;
    }

    setLabels((prev) => prev.filter((l) => l.id !== id));
  };

  const sortLabels = (items: LabelData[]) =>
    [...items].sort((a, b) => {
      const result = a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
      });
      return sortDirection === "asc" ? result : result * -1;
    });

  const childrenByParent = labels.reduce<Record<string, LabelData[]>>(
    (acc, item) => {
      if (item.parentLabelId) {
        acc[item.parentLabelId] = [...(acc[item.parentLabelId] || []), item];
      }
      return acc;
    },
    {},
  );
  const labelMatchesFilter = (item: LabelData) =>
    item.name.toLowerCase().includes(filter.toLowerCase());
  const topLevelLabels = sortLabels(
    labels.filter((item) => !item.parentLabelId),
  );
  const visibleGroups = topLevelLabels
    .map((group) => {
      const children = sortLabels(childrenByParent[group.id] || []).filter(
        labelMatchesFilter,
      );
      const groupMatches = labelMatchesFilter(group);
      return groupMatches || children.length > 0
        ? {
            group,
            children: groupMatches
              ? sortLabels(childrenByParent[group.id] || [])
              : children,
          }
        : null;
    })
    .filter((item): item is { group: LabelData; children: LabelData[] } =>
      Boolean(item),
    );
  const orphanedChildren = sortLabels(
    labels.filter(
      (item) =>
        item.parentLabelId &&
        !labels.some((candidate) => candidate.id === item.parentLabelId) &&
        labelMatchesFilter(item),
    ),
  );
  const visibleCount =
    visibleGroups.reduce((count, item) => count + 1 + item.children.length, 0) +
    orphanedChildren.length;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
          Issue labels
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setCreateState({ mode: "group", parentLabelId: null })
            }
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            New group
          </button>
          <button
            type="button"
            onClick={() =>
              setCreateState({ mode: "label", parentLabelId: null })
            }
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:opacity-90"
          >
            New label
          </button>
        </div>
      </div>

      {/* Filter and scope */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-tertiary)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name..."
            className="w-full rounded-md border border-[var(--color-border)] bg-transparent py-1.5 pr-3 pl-9 text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)]"
          />
        </div>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          Workspace
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-[#5c2c2c] bg-[#2b1717] px-3 py-2 text-[12px] text-[#f5b7b7]">
          {error}
        </div>
      ) : null}

      {/* Table header */}
      <div className="flex h-[32px] items-center border-b border-[var(--color-border)] text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
        <div className="min-w-0 flex-1 px-4">
          <button
            type="button"
            onClick={() =>
              setSortDirection((current) =>
                current === "asc" ? "desc" : "asc",
              )
            }
            className="cursor-pointer hover:text-[var(--color-text-primary)]"
            aria-label={`Order by Name (${sortDirection})`}
          >
            Name {sortDirection === "asc" ? "↓" : "↑"}
          </button>
        </div>
        <div className="w-[200px] shrink-0 px-2">Description</div>
        <div className="w-[60px] shrink-0 px-2 text-center">Rules</div>
        <div className="w-[60px] shrink-0 px-2 text-center">Issues</div>
        <div className="w-[100px] shrink-0 px-2">Last applied</div>
        <div className="w-[90px] shrink-0 px-2">Created</div>
      </div>

      {/* Label rows */}
      {visibleCount === 0 ? (
        <div className="py-12 text-center text-[13px] text-[var(--color-text-tertiary)]">
          {labels.length === 0
            ? "No labels yet. Create labels to categorize issues."
            : "No labels matching your filter."}
        </div>
      ) : (
        <div>
          {visibleGroups.map(({ group, children }) => (
            <div key={group.id} data-testid={`label-group-${group.name}`}>
              <LabelRow
                labelItem={group}
                isChild={false}
                onAddChild={() =>
                  setCreateState({ mode: "label", parentLabelId: group.id })
                }
                onEdit={() => setEditingLabel(group)}
                onDelete={() => handleDelete(group.id, group.name)}
                onUpdateDescription={handleUpdateDescription}
              />
              {children.map((child) => (
                <LabelRow
                  key={child.id}
                  labelItem={child}
                  isChild
                  onEdit={() => setEditingLabel(child)}
                  onDelete={() => handleDelete(child.id, child.name)}
                  onUpdateDescription={handleUpdateDescription}
                />
              ))}
            </div>
          ))}
          {orphanedChildren.map((labelItem) => (
            <LabelRow
              key={labelItem.id}
              labelItem={labelItem}
              isChild={false}
              onEdit={() => setEditingLabel(labelItem)}
              onDelete={() => handleDelete(labelItem.id, labelItem.name)}
              onUpdateDescription={handleUpdateDescription}
            />
          ))}
        </div>
      )}

      {/* Create label modal */}
      {createState && (
        <CreateLabelModal
          mode={createState.mode}
          parentLabelId={createState.parentLabelId}
          parentLabelName={
            labels.find((item) => item.id === createState.parentLabelId)
              ?.name ?? null
          }
          onClose={() => setCreateState(null)}
          onCreate={handleCreate}
        />
      )}
      {editingLabel && (
        <EditLabelModal
          label={editingLabel}
          labels={labels}
          onClose={() => setEditingLabel(null)}
          onSave={handleEdit}
        />
      )}
    </div>
  );
}
