"use client";

import {
  apiErrorMessage,
  createBrowserApiClient,
} from "@/lib/browser-api-client";
import { useEffect, useMemo, useState } from "react";

type ProjectStatus = {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  position: number;
  isDefault: boolean;
  projectCount: number;
};

type ProjectStatusesResponse = {
  statuses: ProjectStatus[];
  totalProjects: number;
  readOnly: boolean;
  customStatusesSupported: boolean;
  canManage: boolean;
};

const apiClient = createBrowserApiClient();

function makeDraftStatus(index: number): ProjectStatus {
  const suffix = Date.now().toString(36);
  return {
    id: `custom-${suffix}-${index}`,
    key: `custom_${suffix}_${index}`,
    name: "New status",
    description: "Describe when projects should use this status.",
    color: "#6b6f76",
    icon: "•",
    position: index,
    isDefault: false,
    projectCount: 0,
  };
}

function normalizePositions(statuses: ProjectStatus[]) {
  return statuses.map((status, position) => ({ ...status, position }));
}

export default function ProjectStatusesPage() {
  const [data, setData] = useState<ProjectStatusesResponse | null>(null);
  const [draftStatuses, setDraftStatuses] = useState<ProjectStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function loadStatuses() {
      setLoading(true);
      setError(null);

      try {
        const { data: payload, error } =
          await apiClient.GET("/project-statuses");
        if (error || !payload) {
          throw new Error(
            apiErrorMessage(error, "Unable to load project statuses."),
          );
        }

        if (!canceled) {
          setData(payload as ProjectStatusesResponse);
          setDraftStatuses(payload.statuses);
        }
      } catch (err) {
        if (!canceled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load project statuses.",
          );
          setData(null);
          setDraftStatuses([]);
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

  const canManage = Boolean(data?.canManage);
  const hasChanges = useMemo(() => {
    if (!data) return false;
    return JSON.stringify(data.statuses) !== JSON.stringify(draftStatuses);
  }, [data, draftStatuses]);

  function updateStatus(id: string, values: Partial<ProjectStatus>) {
    setSaveMessage(null);
    setDraftStatuses((statuses) =>
      statuses.map((status) =>
        status.id === id ? { ...status, ...values } : status,
      ),
    );
  }

  function moveStatus(id: string, direction: -1 | 1) {
    setSaveMessage(null);
    setDraftStatuses((statuses) => {
      const index = statuses.findIndex((status) => status.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= statuses.length) {
        return statuses;
      }
      const next = [...statuses];
      const [status] = next.splice(index, 1);
      next.splice(nextIndex, 0, status);
      return normalizePositions(next);
    });
  }

  function removeStatus(id: string) {
    setSaveMessage(null);
    setDraftStatuses((statuses) =>
      normalizePositions(statuses.filter((status) => status.id !== id)),
    );
  }

  function addStatus() {
    setSaveMessage(null);
    setDraftStatuses((statuses) =>
      normalizePositions([...statuses, makeDraftStatus(statuses.length)]),
    );
  }

  async function saveStatuses() {
    setSaving(true);
    setError(null);
    setSaveMessage(null);

    try {
      const { data: payload, error } = await apiClient.PATCH(
        "/project-statuses",
        {
          body: { statuses: draftStatuses },
        },
      );
      if (error || !payload) {
        throw new Error(
          apiErrorMessage(error, "Unable to save project statuses."),
        );
      }
      setData(payload as ProjectStatusesResponse);
      setDraftStatuses(payload.statuses);
      setSaveMessage("Project statuses saved.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save project statuses.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[900px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
            Project statuses
          </h1>
          <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
            Configure the project lifecycle labels, descriptions, colors, icons,
            and order for this workspace.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={addStatus}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
          >
            New status
          </button>
        ) : null}
      </div>

      <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-[13px] text-[var(--color-text-secondary)]">
        Workspace admins can edit names, descriptions, colors, icons, and order.
        Custom statuses can be applied to projects from each project properties
        panel, and statuses with projects assigned remain protected.
      </div>

      {loading ? (
        <output className="mt-8 block text-[var(--color-text-tertiary)]">
          Loading project statuses...
        </output>
      ) : error && !data ? (
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
              No projects in this workspace yet. The configured project
              lifecycle is ready for new projects.
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              {data.totalProjects} workspace project
              {data.totalProjects === 1 ? "" : "s"} counted across the
              configured lifecycle.
            </p>
          )}

          {error ? (
            <div
              className="rounded-lg border border-red-300 bg-red-50 p-4 text-[14px] text-red-700"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          {saveMessage ? (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-[13px] text-[var(--color-text-primary)]">
              {saveMessage}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            {draftStatuses.map((status, index) => (
              <div
                className="grid gap-3 border-b border-[var(--color-border)] p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_120px]"
                key={status.id}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        backgroundColor: `${status.color}22`,
                        color: status.color,
                      }}
                    >
                      <span>{status.icon}</span>
                      {status.name || "Untitled status"}
                    </span>
                    <code className="text-[11px] text-[var(--color-text-tertiary)]">
                      {status.key}
                    </code>
                    {status.isDefault ? (
                      <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                        Default
                      </span>
                    ) : null}
                  </div>

                  <div className="grid gap-3 md:grid-cols-[180px_90px_minmax(0,1fr)]">
                    <label className="text-[12px] text-[var(--color-text-secondary)]">
                      Name
                      <input
                        value={status.name}
                        disabled={!canManage}
                        maxLength={60}
                        onChange={(event) =>
                          updateStatus(status.id, { name: event.target.value })
                        }
                        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] disabled:opacity-70"
                      />
                    </label>
                    <label className="text-[12px] text-[var(--color-text-secondary)]">
                      Icon
                      <input
                        value={status.icon}
                        disabled={!canManage}
                        maxLength={4}
                        onChange={(event) =>
                          updateStatus(status.id, { icon: event.target.value })
                        }
                        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] disabled:opacity-70"
                      />
                    </label>
                    <label className="text-[12px] text-[var(--color-text-secondary)]">
                      Description
                      <input
                        value={status.description}
                        disabled={!canManage}
                        maxLength={180}
                        onChange={(event) =>
                          updateStatus(status.id, {
                            description: event.target.value,
                          })
                        }
                        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] disabled:opacity-70"
                      />
                    </label>
                  </div>

                  <label className="block max-w-[180px] text-[12px] text-[var(--color-text-secondary)]">
                    Color
                    <input
                      value={status.color}
                      disabled={!canManage}
                      pattern="#[0-9a-fA-F]{6}"
                      onChange={(event) =>
                        updateStatus(status.id, { color: event.target.value })
                      }
                      className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] disabled:opacity-70"
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between gap-3 md:block md:text-right">
                  <div>
                    <div className="text-[20px] font-semibold text-[var(--color-text-primary)]">
                      {status.projectCount}
                    </div>
                    <div className="text-[12px] text-[var(--color-text-tertiary)]">
                      project{status.projectCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  {canManage ? (
                    <div className="mt-3 flex flex-wrap justify-end gap-1">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveStatus(status.id, -1)}
                        className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-primary)] disabled:opacity-40"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        disabled={index === draftStatuses.length - 1}
                        onClick={() => moveStatus(status.id, 1)}
                        className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-primary)] disabled:opacity-40"
                      >
                        Down
                      </button>
                      {!status.isDefault ? (
                        <button
                          type="button"
                          onClick={() => removeStatus(status.id)}
                          className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] text-[var(--color-text-tertiary)]">
              Changes are workspace-scoped and persist after reload.
            </p>
            {canManage ? (
              <button
                type="button"
                disabled={!hasChanges || saving}
                onClick={saveStatuses}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
