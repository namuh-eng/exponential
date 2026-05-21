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

interface IssueCardProps {
  issueId?: string;
  identifier: string;
  title: string;
  priority: 0 | 1 | 2 | 3 | 4;
  statusCategory: StatusCategory;
  statusColor: string;
  assigneeName?: string;
  assigneeImage?: string;
  labels?: { name: string; color: string }[];
  projectName?: string | null;
  cycleName?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  createdAt: string;
  href?: string;
  displayProperties?: DisplayProperties;
  draggable?: boolean;
  isDragging?: boolean;
  onDragStart?: React.DragEventHandler<HTMLElement>;
  onDragEnd?: React.DragEventHandler<HTMLElement>;
}

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
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

export function IssueCard({
  issueId,
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
  draggable = false,
  isDragging = false,
  onDragStart,
  onDragEnd,
}: IssueCardProps) {
  const showProp = (key: keyof DisplayProperties) =>
    !displayProperties || displayProperties[key];

  const className = `block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
    draggable ? "cursor-grab active:cursor-grabbing" : ""
  } ${isDragging ? "opacity-60" : ""}`;

  const cardProps = {
    "data-testid": "issue-card",
    "data-issue-id": issueId,
    draggable,
    "aria-grabbed": draggable ? isDragging : undefined,
    onDragStart,
    onDragEnd,
    className,
  };

  const content = (
    <>
      {/* Title */}
      <p className="mb-2 text-[13px] leading-snug text-[var(--color-text-primary)]">
        {title}
      </p>

      {(showProp("project") && projectName) ||
      (showProp("dueDate") && dueDate) ||
      cycleName ||
      (estimate !== null && estimate !== undefined) ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
          {showProp("project") && projectName ? (
            <span className="truncate">{projectName}</span>
          ) : null}
          {cycleName ? <span>{cycleName}</span> : null}
          {estimate !== null && estimate !== undefined ? (
            <span>{estimate} pt</span>
          ) : null}
          {showProp("dueDate") && dueDate ? (
            <span>Due {formatDate(dueDate)}</span>
          ) : null}
        </div>
      ) : null}

      {/* Bottom row: identifier, priority, labels, assignee */}
      <div className="flex items-center gap-2">
        {showProp("status") ? (
          <StatusIcon category={statusCategory} color={statusColor} size={14} />
        ) : null}

        {showProp("id") ? (
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {identifier}
          </span>
        ) : null}

        {showProp("priority") ? (
          <PriorityIcon priority={priority} size={14} />
        ) : null}

        {/* Labels */}
        {showProp("labels") && labels && labels.length > 0 && (
          <div className="flex items-center gap-1">
            {labels.map((l) => (
              <LabelChip key={l.name} name={l.name} color={l.color} />
            ))}
          </div>
        )}

        <div className="flex-1" />

        {/* Date */}
        {showProp("created") ? (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            {formatDate(createdAt)}
          </span>
        ) : null}

        {/* Assignee */}
        {showProp("assignee") && assigneeName ? (
          <div data-testid="card-assignee">
            <Avatar name={assigneeName} src={assigneeImage} size="sm" />
          </div>
        ) : null}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-label={`${identifier} ${title}`} {...cardProps}>
        {content}
      </Link>
    );
  }

  return <div {...cardProps}>{content}</div>;
}
