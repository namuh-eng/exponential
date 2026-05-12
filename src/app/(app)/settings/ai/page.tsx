"use client";

import { Avatar } from "@/components/avatar";
import { useEffect, useState } from "react";

interface TeamCompletedStat {
  teamId: string;
  teamName: string;
  completedCount: number;
}

interface TeamActiveStat {
  teamId: string;
  teamName: string;
  activeCount: number;
}

interface WorkspaceAnalytics {
  workspaceId: string;
  completedLast30Days: TeamCompletedStat[];
  activeIssues: TeamActiveStat[];
  period: string;
}

function StatCard({
  title,
  value,
  unit,
}: { title: string; value: number; unit?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="text-[12px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {title}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[28px] font-semibold text-[var(--color-text-primary)]">
          {value}
        </span>
        {unit && (
          <span className="text-[13px] text-[var(--color-text-secondary)]">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

export default function AISettingsPage() {
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<WorkspaceAnalytics | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/analytics/workspace")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load analytics");
        }
        return (await res.json()) as WorkspaceAnalytics;
      })
      .then((data) => {
        setAnalytics(data);
      })
      .catch(() => {
        setErrorMessage("Unable to load workspace analytics.");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  const totalCompleted =
    analytics?.completedLast30Days.reduce(
      (acc, curr) => acc + curr.completedCount,
      0,
    ) ?? 0;
  const totalActive =
    analytics?.activeIssues.reduce((acc, curr) => acc + curr.activeCount, 0) ??
    0;

  return (
    <div className="max-w-[820px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        AI & Agents
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Configure workspace-wide AI features and monitor agent performance.
      </p>

      {errorMessage && (
        <p className="mt-4 text-[13px] text-red-400">{errorMessage}</p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          title="Issues Completed"
          value={totalCompleted}
          unit="last 30 days"
        />
        <StatCard
          title="Active Issues"
          value={totalActive}
          unit="across all teams"
        />
      </div>

      <div className="mt-10">
        <h3 className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
          Team Activity
        </h3>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-hover)]">
                <th className="px-5 py-3 font-medium text-[var(--color-text-secondary)]">
                  Team
                </th>
                <th className="px-5 py-3 font-medium text-[var(--color-text-secondary)]">
                  Active
                </th>
                <th className="px-5 py-3 font-medium text-[var(--color-text-secondary)]">
                  Completed (30d)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {analytics?.activeIssues.map((team) => {
                const completed =
                  analytics.completedLast30Days.find(
                    (c) => c.teamId === team.teamId,
                  )?.completedCount ?? 0;
                return (
                  <tr
                    key={team.teamId}
                    className="hover:bg-[var(--color-surface-hover)]"
                  >
                    <td className="px-5 py-3 text-[var(--color-text-primary)] font-medium">
                      {team.teamName}
                    </td>
                    <td className="px-5 py-3 text-[var(--color-text-secondary)]">
                      {team.activeCount}
                    </td>
                    <td className="px-5 py-3 text-[var(--color-text-secondary)]">
                      {completed}
                    </td>
                  </tr>
                );
              })}
              {analytics?.activeIssues.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-5 py-8 text-center text-[var(--color-text-tertiary)]"
                  >
                    No team activity found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
