"use client";

import { getDateInputValue } from "@/lib/cycle-utils";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

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
    cycleDurationWeeks?: number;
  };
  cycles: TeamCycle[];
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getCycleFormDefaults(data: CyclesResponse | null) {
  const durationWeeks = data?.team.cycleDurationWeeks ?? 2;
  const today = new Date();
  const latestCycleEnd = data?.cycles.reduce<Date | null>((latest, cycle) => {
    const cycleEnd = new Date(cycle.endDate);
    return !latest || cycleEnd.getTime() > latest.getTime() ? cycleEnd : latest;
  }, null);
  const startDate =
    latestCycleEnd && latestCycleEnd.getTime() >= today.getTime()
      ? addDays(latestCycleEnd, 1)
      : today;
  const endDate = addDays(startDate, durationWeeks * 7 - 1);

  return {
    startDate: getDateInputValue(startDate),
    endDate: getDateInputValue(endDate),
  };
}

export default function TeamCyclesSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [data, setData] = useState<CyclesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchCycles = useCallback(async () => {
    const res = await fetch(`/api/teams/${teamKey}/cycles`);
    const json = await res.json();
    setData(json);
  }, [teamKey]);

  useEffect(() => {
    fetchCycles().finally(() => setLoading(false));
  }, [fetchCycles]);

  const handleCreateCycle = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitting(true);
      setCreateError(null);

      const formData = new FormData(e.currentTarget);
      const payload = {
        name: ((formData.get("name") as string) || "").trim() || undefined,
        startDate: formData.get("startDate") as string,
        endDate: formData.get("endDate") as string,
        autoRollover: formData.get("autoRollover") === "on",
      };

      try {
        const res = await fetch(`/api/teams/${teamKey}/cycles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          await fetchCycles();
          setShowCreateForm(false);
          return;
        }

        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setCreateError(json?.error ?? "Failed to create cycle");
      } finally {
        setSubmitting(false);
      }
    },
    [teamKey, fetchCycles],
  );

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

  const createDisabled = !data.team.cyclesEnabled;

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
          onClick={() => {
            setCreateError(null);
            setShowCreateForm(true);
          }}
          disabled={createDisabled}
          title={
            createDisabled
              ? "Enable cycles in General settings before creating a cycle."
              : undefined
          }
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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

      {showCreateForm && (
        <CreateCycleForm
          onSubmit={handleCreateCycle}
          onCancel={() => {
            setCreateError(null);
            setShowCreateForm(false);
          }}
          error={createError}
          defaults={getCycleFormDefaults(data)}
          submitting={submitting}
        />
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

function CreateCycleForm({
  onSubmit,
  onCancel,
  error,
  defaults,
  submitting,
}: {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  error: string | null;
  defaults: { startDate: string; endDate: string };
  submitting: boolean;
}) {
  return (
    <form
      aria-label="Create cycle"
      onSubmit={onSubmit}
      className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-hover)] p-4"
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-[var(--color-text-secondary)]">
          Name
          <input
            name="name"
            type="text"
            placeholder="Cycle name (optional)"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
            Start
            <input
              name="startDate"
              type="date"
              defaultValue={defaults.startDate}
              required
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-2 py-1 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
            End
            <input
              name="endDate"
              type="date"
              defaultValue={defaults.endDate}
              required
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-2 py-1 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
            <input name="autoRollover" type="checkbox" defaultChecked />
            Auto rollover unfinished issues
          </label>
        </div>
        {error && <p className="text-[12px] text-red-400">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create cycle"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
