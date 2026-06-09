import { CycleRow } from "@/components/cycle-row";

interface CycleData {
  id: string;
  name: string | null;
  number: number;
  startDate: string;
  endDate: string;
  issueCount: number;
  completedIssueCount: number;
}

interface CycleSectionProps {
  title: string;
  cycles: CycleData[];
  teamKey: string;
  workspaceSlug?: string | null;
}

export function CycleSection({
  title,
  cycles,
  teamKey,
  workspaceSlug,
}: CycleSectionProps) {
  if (cycles.length === 0) return null;

  return (
    <div>
      <div className="flex h-[36px] items-center border-b border-[var(--color-border)] bg-[var(--color-content-bg)] px-4">
        <span className="text-[13px] font-medium text-[var(--color-text-secondary)]">
          {title}
        </span>
        <span className="ml-2 text-[12px] text-[var(--color-text-tertiary)]">
          {cycles.length}
        </span>
      </div>
      {cycles.map((cycle) => (
        <CycleRow
          key={cycle.id}
          cycle={cycle}
          teamKey={teamKey}
          workspaceSlug={workspaceSlug}
        />
      ))}
    </div>
  );
}
