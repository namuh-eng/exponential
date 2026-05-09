"use client";

import { useEffect, useState } from "react";

type ProjectStatus = {
  value: "planned" | "in_progress" | "paused" | "completed" | "canceled";
  label: string;
  description: string;
  projectCount: number;
};

type ProjectStatusesResponse = {
  statuses: ProjectStatus[];
  totalProjects: number;
  readOnly: boolean;
  customStatusesSupported: boolean;
};

const statusTone: Record<ProjectStatus["value"], string> = {
  planned: "bg-[rgba(107,111,118,0.12)] text-[var(--color-text-secondary)]",
  in_progress: "bg-[rgba(240,192,0,0.16)] text-[#b58900]",
  paused: "bg-[rgba(107,111,118,0.12)] text-[var(--color-text-secondary)]",
  completed: "bg-[rgba(76,175,80,0.14)] text-[#2e7d32]",
  canceled: "bg-[rgba(107,111,118,0.12)] text-[var(--color-text-secondary)]",
};

export default function ProjectStatusesPage() {
  const [data, setData] = useState<ProjectStatusesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function loadStatuses() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/project-statuses");
        if (!response.ok) {
          throw new Error("Unable to load project statuses.");
        }

        const payload = (await response.json()) as ProjectStatusesResponse;
        if (!canceled) {
          setData(payload);
        }
      } catch (err) {
        if (!canceled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load project statuses.",
          );
          setData(null);
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    void loadStatuses();

    return () => {
      canceled = true;
    };
  }, []);

  return (
    <div className="max-w-[760px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Project statuses
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Review the default lifecycle stages for projects in your workspace.
      </p>

      <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-[13px] text-[var(--color-text-secondary)]">
        Project statuses are read-only. This workspace uses Linear's default
        lifecycle because custom project status editing is not supported by the
        current schema.
      </div>

      {loading ? (
        <output className="mt-8 block text-[var(--color-text-tertiary)]">
          Loading project statuses...
        </output>
      ) : error ? (
        <div
          className="mt-8 rounded-lg border border-red-300 bg-red-50 p-4 text-[14px] text-red-700"
          role="alert"
        >
          {error}
        </div>
      ) : data ? (
        <div className="mt-8 space-y-4">
          {data.totalProjects === 0 ? (
            <div className="rounded-lg border border-[var(--color-border)] p-4 text-[14px] text-[var(--color-text-secondary)]">
              No projects in this workspace yet. The default project lifecycle
              is available and will be used when projects are created.
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              {data.totalProjects} workspace project
              {data.totalProjects === 1 ? "" : "s"} counted across the default
              lifecycle.
            </p>
          )}

          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            {data.statuses.map((status) => (
              <div
                className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] p-4 last:border-b-0"
                key={status.value}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone[status.value]}`}
                    >
                      {status.label}
                    </span>
                    <code className="text-[11px] text-[var(--color-text-tertiary)]">
                      {status.value}
                    </code>
                  </div>
                  <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
                    {status.description}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[20px] font-semibold text-[var(--color-text-primary)]">
                    {status.projectCount}
                  </div>
                  <div className="text-[12px] text-[var(--color-text-tertiary)]">
                    project{status.projectCount === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
