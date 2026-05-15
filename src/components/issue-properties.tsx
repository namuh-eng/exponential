import { Avatar } from "@/components/avatar";
import { PriorityIcon } from "@/components/icons/priority-icon";
import { StatusIcon } from "@/components/icons/status-icon";

type StatusCategory =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

type PriorityValue = "none" | "urgent" | "high" | "medium" | "low";

interface IssueRelationSummary {
  id: string;
  type: "blocks" | "blocked_by" | "duplicate" | "related";
  issue: { id: string; identifier: string; title: string };
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
  onAddRelation?: (type: IssueRelationSummary["type"]) => void;
  onRemoveRelation?: (relationId: string) => void;
  onOpenIssue?: (issueId: string) => void;
  onEditParent?: () => void;
  onClearParent?: () => void;
}

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
  if (!value) {
    return "No due date";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No due date";
  }

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

function relationLabel(type: IssueRelationSummary["type"]): string {
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
  onAddRelation,
  onRemoveRelation,
  onOpenIssue,
  onEditParent,
  onClearParent,
}: IssuePropertiesProps) {
  return (
    <div className="space-y-0.5">
      {/* Status */}
      <PropertyRow label="Status">
        <StatusIcon category={status.category} color={status.color} size={14} />
        <span className="text-[13px] text-[var(--color-text-primary)]">
          {status.name}
        </span>
      </PropertyRow>

      {/* Priority */}
      <PropertyRow label="Priority">
        <PriorityIcon priority={priorityNumeric[priority]} size={14} />
        <span className="text-[13px] text-[var(--color-text-primary)]">
          {priorityLabel[priority]}
        </span>
      </PropertyRow>

      {/* Assignee */}
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

      {/* Labels */}
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

      {/* Planning */}
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
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => onOpenIssue?.(parentIssue.id)}
              className="min-w-0 truncate rounded-md px-1 py-0.5 text-left text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              {parentIssue.identifier} · {parentIssue.title}
            </button>
            {onEditParent ? (
              <button
                type="button"
                onClick={onEditParent}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                Change
              </button>
            ) : null}
            {onClearParent ? (
              <button
                type="button"
                onClick={onClearParent}
                aria-label="Clear parent issue"
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-red-500"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={onEditParent}
            className="rounded-md px-1 py-0.5 text-left text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            No parent
          </button>
        )}
      </PropertyRow>

      {/* Project */}
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
          {["blocks", "blocked_by", "duplicate", "related"].map((type) => {
            const typedRelations = relations.filter(
              (relation) => relation.type === type,
            );

            return (
              <div key={type} className="flex items-start gap-3 py-1">
                <span className="w-[80px] shrink-0 text-[12px] text-[var(--color-text-secondary)]">
                  {relationLabel(type as IssueRelationSummary["type"])}
                </span>
                <div className="min-w-0 flex-1">
                  {typedRelations.length > 0 ? (
                    <div className="space-y-1">
                      {typedRelations.map((relation) => (
                        <div
                          key={relation.id}
                          className="flex min-w-0 items-center gap-1"
                        >
                          <button
                            type="button"
                            onClick={() => onOpenIssue?.(relation.issue.id)}
                            className="min-w-0 truncate rounded-md px-1 py-0.5 text-left text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                          >
                            {relation.issue.identifier} · {relation.issue.title}
                          </button>
                          {onRemoveRelation ? (
                            <button
                              type="button"
                              onClick={() => onRemoveRelation(relation.id)}
                              aria-label={`Remove ${relation.issue.identifier} relation`}
                              className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-red-500"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        onAddRelation?.(type as IssueRelationSummary["type"])
                      }
                      className="rounded-md px-1 py-0.5 text-left text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      Add relation
                    </button>
                  )}
                  {typedRelations.length > 0 && onAddRelation ? (
                    <button
                      type="button"
                      onClick={() =>
                        onAddRelation(type as IssueRelationSummary["type"])
                      }
                      className="mt-1 rounded-md px-1 py-0.5 text-left text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                    >
                      Add relation
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
