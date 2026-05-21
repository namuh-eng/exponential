"use client";

export interface MilestoneRowProps {
  name: string;
  description?: string;
  progress: number;
  issueCount: number;
  completedCount: number;
  onEdit?: () => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function MilestoneRow({
  name,
  description,
  progress,
  issueCount,
  completedCount,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: MilestoneRowProps) {
  return (
    <div className="rounded-md px-3 py-2 transition-colors hover:bg-[var(--color-surface-hover)]">
      <div className="flex items-center gap-3">
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
            progress === 100
              ? "bg-green-500"
              : progress > 0
                ? "bg-yellow-500"
                : "bg-[var(--color-text-secondary)]"
          }`}
        />

        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text-primary)]">
          {name}
        </span>

        <span className="shrink-0 text-[12px] text-[var(--color-text-secondary)]">
          {completedCount} of {issueCount}
        </span>

        <span className="shrink-0 text-[12px] text-[var(--color-text-secondary)]">
          {progress}%
        </span>

        <div
          data-testid="milestone-progress-bar"
          className="h-1.5 w-[60px] shrink-0 overflow-hidden rounded-full bg-[var(--color-border)]"
        >
          <div
            className={`h-full rounded-full transition-all ${
              progress === 100
                ? "bg-green-500"
                : progress > 0
                  ? "bg-[var(--color-accent)]"
                  : ""
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {description ? (
        <p className="mt-1 pl-5 text-[12px] text-[var(--color-text-secondary)]">
          {description}
        </p>
      ) : null}

      {onEdit || onDelete || onMoveUp || onMoveDown ? (
        <div className="mt-2 flex gap-1 pl-5">
          <button
            type="button"
            aria-label={`Move ${name} up`}
            disabled={!onMoveUp}
            onClick={onMoveUp}
            className="rounded px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move ${name} down`}
            disabled={!onMoveDown}
            onClick={onMoveDown}
            className="rounded px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
          >
            ↓
          </button>
          {onEdit ? (
            <button
              type="button"
              aria-label={`Rename ${name}`}
              onClick={onEdit}
              className="rounded px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            >
              Rename
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              aria-label={`Delete ${name}`}
              onClick={onDelete}
              className="rounded px-2 py-0.5 text-[11px] text-red-400 hover:bg-[var(--color-surface-hover)]"
            >
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
