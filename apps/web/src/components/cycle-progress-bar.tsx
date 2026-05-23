interface CycleProgressBarProps {
  completed: number;
  total: number;
}

export function CycleProgressBar({ completed, total }: CycleProgressBarProps) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div
          className="h-full rounded-full bg-[var(--color-accent)] transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-[12px] text-[var(--color-text-secondary)]">
        {percent}%
      </span>
      <span className="text-[12px] text-[var(--color-text-tertiary)]">
        {completed} / {total} issues
      </span>
    </div>
  );
}
