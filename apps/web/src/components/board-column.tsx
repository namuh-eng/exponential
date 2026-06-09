import { StatusIcon } from "@/components/icons/status-icon";

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

interface BoardColumnProps {
  name: string;
  count: number;
  statusCategory: StatusCategory;
  statusColor: string;
  testId?: string;
  isDropTarget?: boolean;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onAddIssue?: () => void;
  children: React.ReactNode;
}

export function BoardColumn({
  name,
  count,
  statusCategory,
  statusColor,
  testId,
  isDropTarget = false,
  onDragOver,
  onDrop,
  onDragLeave,
  onAddIssue,
  children,
}: BoardColumnProps) {
  return (
    <div
      data-testid={testId}
      data-drop-target={isDropTarget ? "true" : "false"}
      className={`tty-panel flex min-w-[260px] flex-1 flex-col overflow-hidden rounded-[6px] transition-colors ${
        isDropTarget
          ? "border-[var(--color-accent)] bg-[var(--color-surface-hover)]"
          : ""
      }`}
    >
      {/* Column header */}
      <div className="tty-status-bar border-b px-2.5 py-1.5">
        <span aria-hidden="true" className="text-[var(--color-text-tertiary)]">
          col
        </span>
        <StatusIcon category={statusCategory} color={statusColor} size={14} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text-primary)]">
          {name}
        </span>
        <span className="tty-chip">{count}</span>
        <button
          type="button"
          aria-label={`Add issue to ${name}`}
          onClick={onAddIssue}
          disabled={!onAddIssue}
          className="tty-row flex h-6 w-6 items-center justify-center text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
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
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>
      </div>

      {/* Cards */}
      <div
        data-testid={testId ? `${testId}-cards` : undefined}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragLeave={onDragLeave}
        className={`flex flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 py-1.5 transition-colors ${
          isDropTarget
            ? "bg-[color-mix(in_oklab,var(--color-accent)_10%,transparent)]"
            : "border border-transparent"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
