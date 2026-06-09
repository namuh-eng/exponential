type InitiativeStatusType = "active" | "planned" | "completed";

const statusConfig: Record<
  InitiativeStatusType,
  { label: string; dotColor: string; bgColor: string; textColor: string }
> = {
  active: {
    label: "Active",
    dotColor: "bg-green-400",
    bgColor: "bg-green-400/10",
    textColor: "text-green-400",
  },
  planned: {
    label: "Planned",
    dotColor: "bg-blue-400",
    bgColor: "bg-blue-400/10",
    textColor: "text-blue-400",
  },
  completed: {
    label: "Completed",
    dotColor: "bg-[var(--color-text-secondary)]",
    bgColor: "bg-[var(--color-surface-hover)]",
    textColor: "text-[var(--color-text-secondary)]",
  },
};

interface InitiativeStatusBadgeProps {
  status: InitiativeStatusType;
}

export function InitiativeStatusBadge({ status }: InitiativeStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium ${config.bgColor} ${config.textColor}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dotColor}`} />
      {config.label}
    </span>
  );
}
