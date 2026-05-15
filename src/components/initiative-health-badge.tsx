import type { InitiativeHealth } from "@/lib/initiative-detail";

const healthConfig: Record<
  InitiativeHealth,
  { label: string; bgColor: string; textColor: string; dotColor: string }
> = {
  unknown: {
    label: "Unknown",
    bgColor: "bg-neutral-400/10",
    textColor: "text-[var(--color-text-tertiary)]",
    dotColor: "bg-neutral-400",
  },
  onTrack: {
    label: "On track",
    bgColor: "bg-emerald-400/10",
    textColor: "text-emerald-300",
    dotColor: "bg-emerald-400",
  },
  atRisk: {
    label: "At risk",
    bgColor: "bg-amber-400/10",
    textColor: "text-amber-300",
    dotColor: "bg-amber-400",
  },
  offTrack: {
    label: "Off track",
    bgColor: "bg-rose-400/10",
    textColor: "text-rose-300",
    dotColor: "bg-rose-400",
  },
};

export function InitiativeHealthBadge({
  health,
}: {
  health: InitiativeHealth;
}) {
  const config = healthConfig[health];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${config.bgColor} ${config.textColor}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dotColor}`} />
      {config.label}
    </span>
  );
}
