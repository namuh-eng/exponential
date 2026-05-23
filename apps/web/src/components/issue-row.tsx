import { Avatar } from "@/components/avatar";
import type { DisplayProperties } from "@/components/display-options-panel";
import { PriorityIcon } from "@/components/icons/priority-icon";
import { StatusIcon } from "@/components/icons/status-icon";
import { LabelChip } from "@/components/label-chip";
import Link from "next/link";

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

interface IssueRowProps {
  identifier: string;
  title: string;
  priority: 0 | 1 | 2 | 3 | 4;
  statusCategory: StatusCategory;
  statusColor: string;
  assigneeName?: string;
  assigneeImage?: string;
  labels?: { name: string; color: string }[];
  projectName?: string;
  cycleName?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  createdAt: string;
  href?: string;
  displayProperties?: DisplayProperties;
  selected?: boolean;
  selectionMode?: boolean;
  onToggleSelected?: (event: { shiftKey: boolean }) => void;
}

const priorityMap: Record<string, 0 | 1 | 2 | 3 | 4> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
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
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

export { priorityMap };

export function IssueRow({
  identifier,
  title,
  priority,
  statusCategory,
  statusColor,
  assigneeName,
  assigneeImage,
  labels,
  projectName,
  cycleName,
  estimate,
  dueDate,
  createdAt,
  href,
  displayProperties,
  selected = false,
  selectionMode = false,
  onToggleSelected,
}: IssueRowProps) {
  const showProp = (key: keyof DisplayProperties) =>
    !displayProperties || displayProperties[key];

  const selectionControl = onToggleSelected ? (
    <input
      type="checkbox"
      checked={selected}
      aria-label={`Select ${identifier}`}
      data-testid="issue-row-checkbox"
      className={`h-3.5 w-3.5 shrink-0 rounded accent-[var(--color-accent)] ${
        selectionMode || selected
          ? ""
          : "md:opacity-0 md:group-hover:opacity-100"
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onToggleSelected({ shiftKey: event.shiftKey });
      }}
      onChange={() => undefined}
    />
  ) : null;

  const content = (
    <>
      {/* Priority */}
      {showProp("priority") && <PriorityIcon priority={priority} size={14} />}

      {/* Status */}
      {showProp("status") && (
        <StatusIcon category={statusCategory} color={statusColor} size={14} />
      )}

      {/* Identifier */}
      {showProp("id") && (
        <span className="t-mono-sm shrink-0 text-[var(--color-text-secondary)]">
          {identifier}
        </span>
      )}

      {/* Title */}
      <span
        data-editorial-row-title
        className="editorial-row-title min-w-0 flex-1 truncate text-[var(--color-text-primary)]"
      >
        {title}
      </span>

      {/* Labels */}
      {showProp("labels") && labels && labels.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          {labels.map((l) => (
            <LabelChip key={l.name} name={l.name} color={l.color} />
          ))}
        </div>
      )}

      {/* Project */}
      {showProp("project") && projectName && (
        <div className="flex max-w-[220px] shrink-0 items-center gap-1 text-[12px] text-[var(--color-text-secondary)]">
          <span aria-hidden="true">›</span>
          <span className="truncate">{projectName}</span>
        </div>
      )}

      {/* Cycle and estimate */}
      {cycleName && (
        <span className="shrink-0 text-[12px] text-[var(--color-text-secondary)]">
          {cycleName}
        </span>
      )}
      {estimate !== null && estimate !== undefined && (
        <span className="shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
          {estimate} pt
        </span>
      )}

      {/* Due date */}
      {showProp("dueDate") && dueDate && (
        <span className="shrink-0 text-[12px] text-[var(--color-text-secondary)]">
          Due {formatDate(dueDate)}
        </span>
      )}

      {/* Date */}
      {showProp("created") && (
        <span className="shrink-0 text-[12px] text-[var(--color-text-secondary)]">
          {formatDate(createdAt)}
        </span>
      )}

      {/* Assignee */}
      {showProp("assignee") &&
        (assigneeName ? (
          <div data-testid="assignee" className="shrink-0">
            <Avatar name={assigneeName} src={assigneeImage} size="sm" />
          </div>
        ) : (
          <div className="h-4 w-4 shrink-0" />
        ))}
    </>
  );

  const className = `group flex h-[42px] items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-surface)_72%,transparent)] px-4 text-[13px] transition-colors hover:bg-[var(--color-surface-hover)] ${
    selected
      ? "bg-[var(--color-surface-active)] shadow-[inset_2px_0_0_var(--color-accent)]"
      : ""
  }`;

  if (onToggleSelected) {
    const linkedContent = href ? (
      <Link
        href={href}
        aria-label={`${identifier} ${title}`}
        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
        onClick={(event) => {
          if (event.shiftKey || selectionMode) {
            event.preventDefault();
            onToggleSelected({ shiftKey: event.shiftKey });
          }
        }}
      >
        {content}
      </Link>
    ) : (
      content
    );

    return (
      <div
        data-testid="issue-row"
        aria-label={`${identifier} ${title}`}
        data-selected={selected ? "true" : "false"}
        className={className}
        onKeyDown={(event) => {
          if (event.key === "Escape" && selectionMode) {
            onToggleSelected({ shiftKey: false });
          }
        }}
      >
        {selectionControl}
        {linkedContent}
      </div>
    );
  }

  if (href) {
    return (
      <Link
        href={href}
        data-testid="issue-row"
        aria-label={`${identifier} ${title}`}
        className={className}
      >
        {content}
      </Link>
    );
  }

  return (
    <div data-testid="issue-row" className={className}>
      {content}
    </div>
  );
}
