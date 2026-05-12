"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface TeamCycle {
  id: string;
  name: string | null;
  number: number;
  startDate: string;
  endDate: string;
  issueCount: number;
  completedIssueCount: number;
}

interface CyclesResponse {
  team: {
    name: string;
    cyclesEnabled: boolean;
  };
  cycles: TeamCycle[];
}

export default function TeamCyclesSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [data, setData] = useState<CyclesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/teams/${teamKey}/cycles`)
      .then((res) => res.json())
      .then((json) => setData(json))
      .finally(() => setLoading(false));
  }, [teamKey]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Team not found
      </div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <div className="mb-6">
        <Link
          href={`/settings/teams/${encodeURIComponent(teamKey)}`}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
          Cycles
        </h1>
        <button
          type="button"
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          New cycle
        </button>
      </div>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Cycles are time-boxed periods for your team to focus on a set of work.
      </p>

      {!data.team.cyclesEnabled && (
        <div className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-[13px] text-amber-200/80">
          Cycles are currently disabled for this team. You can enable them in
          the{" "}
          <Link
            href={`/settings/teams/${encodeURIComponent(teamKey)}/general`}
            className="text-amber-200 underline underline-offset-2"
          >
            General settings
          </Link>
          .
        </div>
      )}

      <div className="mt-8 flex flex-col gap-2">
        {data.cycles.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] border-dashed p-12 text-center text-[var(--color-text-tertiary)]">
            No cycles have been created for this team.
          </div>
        ) : (
          data.cycles.map((cycle) => (
            <div
              key={cycle.id}
              className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3"
            >
              <div>
                <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                  {cycle.name || `Cycle ${cycle.number}`}
                </div>
                <div className="text-[12px] text-[var(--color-text-tertiary)]">
                  {new Date(cycle.startDate).toLocaleDateString()} –{" "}
                  {new Date(cycle.endDate).toLocaleDateString()}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[13px] text-[var(--color-text-secondary)]">
                  {cycle.issueCount} issues
                </div>
                <div className="text-[11px] text-[var(--color-text-tertiary)]">
                  {cycle.completedIssueCount} completed
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
