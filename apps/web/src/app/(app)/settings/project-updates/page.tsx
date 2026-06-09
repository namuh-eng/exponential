"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useMemo, useState } from "react";

type ProjectUpdateCadence = "weekly" | "biweekly" | "monthly";
type ProjectUpdateDueDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday";
type ProjectUpdateScope =
  | "all_projects"
  | "active_projects"
  | "selected_projects";
type ProjectUpdateReportingTarget = "workspace" | "slack" | "email";

type ProjectUpdateConfiguration = {
  id: string;
  name: string;
  enabled: boolean;
  cadence: ProjectUpdateCadence;
  dueDay: ProjectUpdateDueDay;
  dueTime: string;
  timezone: string;
  scope: ProjectUpdateScope;
  projectIds: string[];
  reportingTarget: ProjectUpdateReportingTarget;
  shareTarget: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectUpdateFormValues = Pick<
  ProjectUpdateConfiguration,
  | "name"
  | "enabled"
  | "cadence"
  | "dueDay"
  | "dueTime"
  | "timezone"
  | "scope"
  | "reportingTarget"
  | "shareTarget"
>;

const CADENCE_OPTIONS: Array<{ value: ProjectUpdateCadence; label: string }> = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "monthly", label: "Monthly" },
];
const DUE_DAY_OPTIONS: Array<{ value: ProjectUpdateDueDay; label: string }> = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
];
const SCOPE_OPTIONS: Array<{ value: ProjectUpdateScope; label: string }> = [
  { value: "active_projects", label: "Active projects" },
  { value: "all_projects", label: "All projects" },
  { value: "selected_projects", label: "Selected projects" },
];
const REPORTING_TARGET_OPTIONS: Array<{
  value: ProjectUpdateReportingTarget;
  label: string;
}> = [
  { value: "workspace", label: "Workspace update feed" },
  { value: "slack", label: "Slack channel" },
  { value: "email", label: "Email recipients" },
];

const EMPTY_FORM: ProjectUpdateFormValues = {
  name: "Weekly project update reminder",
  enabled: true,
  cadence: "weekly",
  dueDay: "friday",
  dueTime: "09:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  scope: "active_projects",
  reportingTarget: "workspace",
  shareTarget: "",
};

function cadenceLabel(value: ProjectUpdateCadence) {
  return (
    CADENCE_OPTIONS.find((option) => option.value === value)?.label ?? value
  );
}

function dueDayLabel(value: ProjectUpdateDueDay) {
  return (
    DUE_DAY_OPTIONS.find((option) => option.value === value)?.label ?? value
  );
}

function scopeLabel(value: ProjectUpdateScope) {
  return SCOPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function reportingTargetLabel(value: ProjectUpdateReportingTarget) {
  return (
    REPORTING_TARGET_OPTIONS.find((option) => option.value === value)?.label ??
    value
  );
}

async function readApiError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Keep fallback.
  }

  return fallback;
}

function ProjectUpdateModal({
  configuration,
  onClose,
  onSubmit,
}: {
  configuration?: ProjectUpdateConfiguration | null;
  onClose: () => void;
  onSubmit: (
    values: ProjectUpdateFormValues,
    configuration?: ProjectUpdateConfiguration | null,
  ) => Promise<string | null>;
}) {
  const [values, setValues] = useState<ProjectUpdateFormValues>(
    configuration
      ? {
          name: configuration.name,
          enabled: configuration.enabled,
          cadence: configuration.cadence,
          dueDay: configuration.dueDay,
          dueTime: configuration.dueTime,
          timezone: configuration.timezone,
          scope: configuration.scope,
          reportingTarget: configuration.reportingTarget,
          shareTarget: configuration.shareTarget,
        }
      : EMPTY_FORM,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isEditing = Boolean(configuration);

  function updateValue<K extends keyof ProjectUpdateFormValues>(
    key: K,
    value: ProjectUpdateFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setSubmitError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    if (!values.name.trim()) {
      setSubmitError("Name is required");
      return;
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(values.dueTime)) {
      setSubmitError("Due time must use 24-hour HH:MM format");
      return;
    }

    setSubmitting(true);
    try {
      const error = await onSubmit(
        {
          ...values,
          name: values.name.trim(),
          shareTarget: values.shareTarget.trim(),
        },
        configuration,
      );
      if (error) {
        setSubmitError(error);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-[560px] rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-6 shadow-2xl">
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
          {isEditing
            ? "Edit project update configuration"
            : "Create project update configuration"}
        </h2>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          Configure reminder cadence, due time, scope, and reporting
          destination.
        </p>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="project-update-name"
              className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
            >
              Name
            </label>
            <input
              id="project-update-name"
              value={values.name}
              onChange={(event) => updateValue("name", event.target.value)}
              className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-primary)]">
            <input
              type="checkbox"
              checked={values.enabled}
              onChange={(event) => updateValue("enabled", event.target.checked)}
            />
            Reminders enabled
          </label>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label
                htmlFor="project-update-cadence"
                className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
              >
                Cadence
              </label>
              <select
                id="project-update-cadence"
                value={values.cadence}
                onChange={(event) =>
                  updateValue(
                    "cadence",
                    event.target.value as ProjectUpdateCadence,
                  )
                }
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              >
                {CADENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="project-update-due-day"
                className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
              >
                Due day
              </label>
              <select
                id="project-update-due-day"
                value={values.dueDay}
                onChange={(event) =>
                  updateValue(
                    "dueDay",
                    event.target.value as ProjectUpdateDueDay,
                  )
                }
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              >
                {DUE_DAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="project-update-due-time"
                className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
              >
                Due time
              </label>
              <input
                id="project-update-due-time"
                type="time"
                value={values.dueTime}
                onChange={(event) => updateValue("dueTime", event.target.value)}
                className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label
                htmlFor="project-update-timezone"
                className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
              >
                Timezone
              </label>
              <input
                id="project-update-timezone"
                value={values.timezone}
                onChange={(event) =>
                  updateValue("timezone", event.target.value)
                }
                className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                placeholder="America/Los_Angeles"
              />
            </div>
            <div>
              <label
                htmlFor="project-update-scope"
                className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
              >
                Scope
              </label>
              <select
                id="project-update-scope"
                value={values.scope}
                onChange={(event) =>
                  updateValue("scope", event.target.value as ProjectUpdateScope)
                }
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              >
                {SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label
                htmlFor="project-update-reporting-target"
                className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
              >
                Reporting destination
              </label>
              <select
                id="project-update-reporting-target"
                value={values.reportingTarget}
                onChange={(event) =>
                  updateValue(
                    "reportingTarget",
                    event.target.value as ProjectUpdateReportingTarget,
                  )
                }
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              >
                {REPORTING_TARGET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="project-update-share-target"
                className="mb-1 block text-[12px] text-[var(--color-text-secondary)]"
              >
                Share target
              </label>
              <input
                id="project-update-share-target"
                value={values.shareTarget}
                onChange={(event) =>
                  updateValue("shareTarget", event.target.value)
                }
                className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                placeholder="#project-updates or team@example.com"
              />
            </div>
          </div>

          {submitError ? (
            <p className="text-[13px] text-red-400" role="alert">
              {submitError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !values.name.trim()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting
                ? "Saving..."
                : isEditing
                  ? "Save changes"
                  : "Create configuration"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProjectUpdatesPage() {
  const [loading, setLoading] = useState(true);
  const [configurations, setConfigurations] = useState<
    ProjectUpdateConfiguration[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProjectUpdateConfiguration | null>(
    null,
  );

  const loadConfigurations = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/project-updates");
      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            "Unable to load project update settings.",
          ),
        );
      }
      const payload = (await response.json()) as {
        configurations?: ProjectUpdateConfiguration[];
      };
      setConfigurations(payload.configurations ?? []);
    } catch (err) {
      setConfigurations([]);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load project update settings.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigurations();
  }, [loadConfigurations]);

  const enabledCount = useMemo(
    () =>
      configurations.filter((configuration) => configuration.enabled).length,
    [configurations],
  );

  async function saveConfiguration(
    values: ProjectUpdateFormValues,
    configuration?: ProjectUpdateConfiguration | null,
  ) {
    setError(null);
    setMessage(null);
    const response = await fetch(
      configuration
        ? `/api/project-updates/${configuration.id}`
        : "/api/project-updates",
      {
        method: configuration ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      },
    );

    if (!response.ok) {
      return readApiError(response, "Unable to save project update settings.");
    }

    const payload = (await response.json()) as {
      configuration: ProjectUpdateConfiguration;
    };
    setConfigurations((current) =>
      configuration
        ? current.map((item) =>
            item.id === configuration.id ? payload.configuration : item,
          )
        : [...current, payload.configuration],
    );
    setCreating(false);
    setEditing(null);
    setMessage("Project update settings saved.");
    return null;
  }

  async function toggleConfiguration(
    configuration: ProjectUpdateConfiguration,
  ) {
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/project-updates/${configuration.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !configuration.enabled }),
    });

    if (!response.ok) {
      setError(
        await readApiError(response, "Unable to update reminder state."),
      );
      return;
    }

    const payload = (await response.json()) as {
      configuration: ProjectUpdateConfiguration;
    };
    setConfigurations((current) =>
      current.map((item) =>
        item.id === configuration.id ? payload.configuration : item,
      ),
    );
    setMessage(
      payload.configuration.enabled
        ? "Project update reminders enabled."
        : "Project update reminders disabled.",
    );
  }

  async function deleteConfiguration(
    configuration: ProjectUpdateConfiguration,
  ) {
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/project-updates/${configuration.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setError(
        await readApiError(
          response,
          "Unable to delete project update settings.",
        ),
      );
      return;
    }

    setConfigurations((current) =>
      current.filter((item) => item.id !== configuration.id),
    );
    setMessage("Project update configuration deleted.");
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  return (
    <div className="max-w-[840px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
            Project updates
          </h1>
          <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
            Manage how project updates are collected, shared, and reported
            within the workspace.
          </p>
        </div>
        {configurations.length > 0 ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Create configuration
          </button>
        ) : null}
      </div>

      <div className="mt-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-[13px] text-[var(--color-text-secondary)]">
        {configurations.length} configuration
        {configurations.length === 1 ? "" : "s"} · {enabledCount} enabled
      </div>

      {error ? (
        <p className="mt-4 text-[13px] text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-4 text-[13px] text-[var(--color-text-secondary)]">
          {message}
        </p>
      ) : null}

      <div className="mt-8">
        {configurations.length === 0 ? (
          <EmptyState
            title="No update configurations"
            description="Configure reminder cadences and reporting formats for your projects."
            action={{
              label: "Create update configuration",
              onClick: () => setCreating(true),
            }}
          />
        ) : (
          <div className="space-y-3">
            {configurations.map((configuration) => (
              <article
                key={configuration.id}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                        {configuration.name}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          configuration.enabled
                            ? "bg-green-500/15 text-green-400"
                            : "bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]"
                        }`}
                      >
                        {configuration.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                      {cadenceLabel(configuration.cadence)} on{" "}
                      {dueDayLabel(configuration.dueDay)} at{" "}
                      {configuration.dueTime} ({configuration.timezone})
                    </p>
                    <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                      Scope: {scopeLabel(configuration.scope)} · Reporting:{" "}
                      {reportingTargetLabel(configuration.reportingTarget)}
                      {configuration.shareTarget
                        ? ` · ${configuration.shareTarget}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void toggleConfiguration(configuration)}
                      className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    >
                      {configuration.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(configuration)}
                      className="text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteConfiguration(configuration)}
                      className="text-[13px] text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {creating ? (
        <ProjectUpdateModal
          onClose={() => setCreating(false)}
          onSubmit={saveConfiguration}
        />
      ) : null}
      {editing ? (
        <ProjectUpdateModal
          configuration={editing}
          onClose={() => setEditing(null)}
          onSubmit={saveConfiguration}
        />
      ) : null}
    </div>
  );
}
