"use client";

import { CycleRow } from "@/components/cycle-row";
import { CycleSection } from "@/components/cycle-section";
import { EmptyState } from "@/components/empty-state";
import { TeamRouteErrorState } from "@/components/team-route-error-state";
import { categorizeCycles, getDateInputValue } from "@/lib/cycle-utils";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface CycleData {
  id: string;
  name: string | null;
  number: number;
  teamId: string;
  startDate: string;
  endDate: string;
  autoRollover: boolean;
  issueCount: number;
  completedIssueCount: number;
}

interface CyclesResponse {
  team: {
    id: string;
    name: string;
    key: string;
    cyclesEnabled: boolean;
    cycleStartDay: number;
    cycleDurationWeeks: number;
    timezone: string;
  };
  cycles: CycleData[];
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function alignToCycleStartDay(date: Date, cycleStartDay: number): Date {
  const next = new Date(date);
  const targetDay = cycleStartDay % 7;
  const delta = (targetDay - next.getDay() + 7) % 7;
  next.setDate(next.getDate() + delta);
  return next;
}

function getCycleFormDefaults(data: CyclesResponse | null) {
  const durationWeeks = data?.team.cycleDurationWeeks ?? 2;
  const today = new Date();
  const latestCycleEnd = data?.cycles.reduce<Date | null>((latest, cycle) => {
    const cycleEnd = new Date(cycle.endDate);
    if (!latest || cycleEnd.getTime() > latest.getTime()) {
      return cycleEnd;
    }

    return latest;
  }, null);

  let startDate =
    latestCycleEnd && latestCycleEnd.getTime() >= today.getTime()
      ? addDays(latestCycleEnd, 1)
      : today;

  if (data?.team.cyclesEnabled) {
    startDate = alignToCycleStartDay(startDate, data.team.cycleStartDay);
  }

  const endDate = addDays(startDate, durationWeeks * 7 - 1);

  return {
    startDate: getDateInputValue(startDate),
    endDate: getDateInputValue(endDate),
  };
}

export default function TeamCyclesPage() {
  const params = useParams<{ key: string; workspaceSlug?: string }>();
  const [data, setData] = useState<CyclesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadState, setLoadState] = useState<"ready" | "not-found" | "error">(
    "ready",
  );
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchCycles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/teams/${params.key}/cycles`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLoadState("ready");
        return;
      }

      setData(null);
      setLoadState(res.status === 404 ? "not-found" : "error");
    } catch {
      setData(null);
      setLoadState("error");
    } finally {
      setLoading(false);
    }
  }, [params.key]);

  useEffect(() => {
    fetchCycles();
  }, [fetchCycles]);

  const handleCreateCycle = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const startDate = formData.get("startDate") as string;
      const endDate = formData.get("endDate") as string;
      const name = (formData.get("name") as string) || undefined;

      const res = await fetch(`/api/teams/${params.key}/cycles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, name }),
      });

      if (res.ok) {
        setCreateError(null);
        setShowCreateForm(false);
        await fetchCycles();
        return;
      }

      const json = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setCreateError(json?.error ?? "Failed to create cycle");
    },
    [params.key, fetchCycles],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (loadState !== "ready") {
    return (
      <TeamRouteErrorState
        teamKey={params.key}
        variant={loadState}
        onRetry={loadState === "error" ? fetchCycles : undefined}
      />
    );
  }

  if (!data) {
    return (
      <TeamRouteErrorState
        teamKey={params.key}
        variant="error"
        onRetry={fetchCycles}
      />
    );
  }

  if (data.cycles.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
          <h1 className="text-[15px] font-medium text-[var(--color-text-primary)]">
            Cycles
          </h1>
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setShowCreateForm(true);
            }}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:opacity-90"
          >
            New cycle
          </button>
        </div>
        {showCreateForm ? (
          <CreateCycleForm
            onSubmit={handleCreateCycle}
            onCancel={() => {
              setCreateError(null);
              setShowCreateForm(false);
            }}
            error={createError}
            defaults={getCycleFormDefaults(data)}
          />
        ) : (
          <EmptyState
            title="No active cycle"
            description="Cycles are a great way to manage iterative development. Focus your team over time-boxed windows to ship faster."
            icon={
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#6b6f76"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
                aria-label="Cycles"
              >
                <path d="M21.5 2v6h-6" />
                <path d="M2.5 22v-6h6" />
                <path d="M22 11.5A10 10 0 0 0 3.2 7.2" />
                <path d="M2 12.5a10 10 0 0 0 18.8 4.3" />
              </svg>
            }
            action={{
              label: "Create cycle",
              onClick: () => setShowCreateForm(true),
            }}
          />
        )}
      </div>
    );
  }

  const { current, upcoming, past } = categorizeCycles(
    data.cycles,
    new Date(),
    data.team.timezone || undefined,
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-[15px] font-medium text-[var(--color-text-primary)]">
            Cycles
          </h1>
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {data.cycles.length} cycles
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setShowCreateForm(true);
          }}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:opacity-90"
        >
          New cycle
        </button>
      </div>

      {showCreateForm && (
        <CreateCycleForm
          onSubmit={handleCreateCycle}
          onCancel={() => {
            setCreateError(null);
            setShowCreateForm(false);
          }}
          error={createError}
          defaults={getCycleFormDefaults(data)}
        />
      )}

      {/* Cycle lists */}
      <div className="flex-1 overflow-y-auto">
        {/* Current cycle - highlighted */}
        {current && (
          <div>
            <div className="flex h-[36px] items-center border-b border-[var(--color-border)] bg-[var(--color-content-bg)] px-4">
              <span className="text-[13px] font-medium text-[var(--color-text-secondary)]">
                Current Cycle
              </span>
            </div>
            <CycleRow
              cycle={current}
              teamKey={params.key}
              workspaceSlug={params.workspaceSlug}
            />
          </div>
        )}

        <CycleSection
          title="Upcoming"
          cycles={upcoming}
          teamKey={params.key}
          workspaceSlug={params.workspaceSlug}
        />

        <CycleSection
          title="Past Cycles"
          cycles={past}
          teamKey={params.key}
          workspaceSlug={params.workspaceSlug}
        />
      </div>
    </div>
  );
}

function CreateCycleForm({
  onSubmit,
  onCancel,
  error,
  defaults,
}: {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  error: string | null;
  defaults: { startDate: string; endDate: string };
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="border-b border-[var(--color-border)] bg-[var(--color-surface-hover)] px-4 py-3"
    >
      <div className="flex flex-col gap-3">
        <input
          name="name"
          type="text"
          placeholder="Cycle name (optional)"
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <div className="flex items-center gap-3">
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
        </div>
        {error && <p className="text-[12px] text-red-400">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:opacity-90"
          >
            Create cycle
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
