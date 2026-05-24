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
      className={`flex min-w-[280px] flex-1 flex-col rounded-xl transition-colors ${
        isDropTarget ? "bg-[var(--color-surface-hover)]" : ""
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-2 py-2.5">
        <StatusIcon category={statusCategory} color={statusColor} size={14} />
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
          {name}
        </span>
        <span className="text-[13px] text-[var(--color-text-secondary)]">
          {count}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          aria-label={`Add issue to ${name}`}
          onClick={onAddIssue}
          disabled={!onAddIssue}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
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
        className={`flex flex-1 flex-col gap-1.5 overflow-y-auto rounded-lg px-1.5 pb-2 transition-colors ${
          isDropTarget
            ? "border border-dashed border-[var(--color-accent)]"
            : "border border-transparent"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
