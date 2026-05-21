"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

type ProjectUpdateConfiguration = {
  id: string;
  name: string;
  enabled: boolean;
  cadence: "weekly" | "biweekly" | "monthly";
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
  projectScope: "all" | "active" | "statuses";
  statusScope: string[];
  shareTargets: string[];
  slackChannel: string | null;
  createdAt: string;
  updatedAt: string;
};

const CADENCES = [
  ["weekly", "Weekly"],
  ["biweekly", "Every two weeks"],
  ["monthly", "Monthly"],
] as const;

const DAYS = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"],
] as const;

const PROJECT_SCOPES = [
  ["all", "All projects"],
  ["active", "Active projects"],
  ["statuses", "Selected statuses"],
] as const;

const STATUS_OPTIONS = [
  ["planned", "Planned"],
  ["started", "In progress"],
  ["paused", "Paused"],
  ["completed", "Completed"],
  ["canceled", "Canceled"],
] as const;

const SHARE_TARGETS = [
  ["workspace", "Workspace and project feed"],
  ["slack", "Slack channel"],
  ["email", "Email digest"],
] as const;

type ProjectUpdateFormState = {
  name: string;
  enabled: boolean;
  cadence: ProjectUpdateConfiguration["cadence"];
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
  projectScope: ProjectUpdateConfiguration["projectScope"];
  statusScope: string[];
  shareTargets: string[];
  slackChannel: string;
};

const DEFAULT_FORM: ProjectUpdateFormState = {
  name: "",
  enabled: true,
  cadence: "weekly",
  dayOfWeek: 5,
  timeOfDay: "09:00",
  timezone: "UTC",
  projectScope: "active",
  statusScope: ["started"],
  shareTargets: ["workspace"],
  slackChannel: "",
};

function dayName(dayOfWeek: number) {
  return DAYS.find(([value]) => value === dayOfWeek)?.[1] ?? "Friday";
}

function targetLabel(target: string) {
  return SHARE_TARGETS.find(([value]) => value === target)?.[1] ?? target;
}

function formatSummary(configuration: ProjectUpdateConfiguration) {
  const cadence = CADENCES.find(
    ([value]) => value === configuration.cadence,
  )?.[1];
  const scope = PROJECT_SCOPES.find(
    ([value]) => value === configuration.projectScope,
  )?.[1];
  return `${cadence} on ${dayName(configuration.dayOfWeek)} at ${configuration.timeOfDay} ${configuration.timezone} · ${scope}`;
}

export default function ProjectUpdatesPage() {
  const [loading, setLoading] = useState(true);
  const [configurations, setConfigurations] = useState<
    ProjectUpdateConfiguration[]
  >([]);
  const [canManage, setCanManage] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfiguration, setEditingConfiguration] =
    useState<ProjectUpdateConfiguration | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadConfigurations() {
      try {
        const response = await fetch("/api/project-update-configurations");
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load project updates");
        }
        if (!cancelled) {
          setConfigurations(payload.configurations ?? []);
          setCanManage(Boolean(payload.canManage));
        }
      } catch {
        if (!cancelled) {
          setLoadError("Unable to load project update configurations.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadConfigurations();

    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setEditingConfiguration(null);
    setForm(DEFAULT_FORM);
    setError("");
  }

  function openCreateDialog() {
    resetForm();
    setActionMessage("");
    setDialogOpen(true);
  }

  function openEditDialog(configuration: ProjectUpdateConfiguration) {
    setEditingConfiguration(configuration);
    setForm({
      name: configuration.name,
      enabled: configuration.enabled,
      cadence: configuration.cadence,
      dayOfWeek: configuration.dayOfWeek,
      timeOfDay: configuration.timeOfDay,
      timezone: configuration.timezone,
      projectScope: configuration.projectScope,
      statusScope: configuration.statusScope,
      shareTargets: configuration.shareTargets,
      slackChannel: configuration.slackChannel ?? "",
    });
    setError("");
    setActionMessage("");
    setDialogOpen(true);
  }

  function updateForm<Key extends keyof ProjectUpdateFormState>(
    key: Key,
    value: ProjectUpdateFormState[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleArrayValue(
    key: "shareTargets" | "statusScope",
    value: string,
  ) {
    setForm((current) => {
      const values = current[key];
      return {
        ...current,
        [key]: values.includes(value)
          ? values.filter((item) => item !== value)
          : [...values, value],
      };
    });
  }

  async function saveConfiguration() {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setError("Configuration name is required.");
      return;
    }

    if (form.projectScope === "statuses" && form.statusScope.length === 0) {
      setError("Select at least one project status for this scope.");
      return;
    }

    if (form.shareTargets.length === 0) {
      setError("Select at least one reporting target.");
      return;
    }

    if (form.shareTargets.includes("slack") && !form.slackChannel.trim()) {
      setError("Slack channel is required for Slack reports.");
      return;
    }

    setSaving(true);
    setError("");
    setActionMessage("");

    try {
      const url = editingConfiguration
        ? `/api/project-update-configurations/${encodeURIComponent(editingConfiguration.id)}`
        : "/api/project-update-configurations";
      const response = await fetch(url, {
        method: editingConfiguration ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, name: trimmedName }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          payload.error ??
            (editingConfiguration
              ? "Failed to update project update configuration."
              : "Failed to create project update configuration."),
        );
        return;
      }

      setConfigurations((current) =>
        editingConfiguration
          ? current.map((configuration) =>
              configuration.id === editingConfiguration.id
                ? payload.configuration
                : configuration,
            )
          : [payload.configuration, ...current],
      );
      setDialogOpen(false);
      setActionMessage(
        editingConfiguration
          ? "Project update configuration updated."
          : "Project update configuration created.",
      );
      resetForm();
    } catch {
      setError(
        editingConfiguration
          ? "Failed to update project update configuration."
          : "Failed to create project update configuration.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteConfiguration(
    configuration: ProjectUpdateConfiguration,
  ) {
    setDeletingId(configuration.id);
    setActionMessage("");
    try {
      const response = await fetch(
        `/api/project-update-configurations/${encodeURIComponent(configuration.id)}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionMessage(
          payload.error ?? "Failed to delete project update configuration.",
        );
        return;
      }
      setConfigurations((current) =>
        current.filter((item) => item.id !== configuration.id),
      );
      setActionMessage("Project update configuration deleted.");
    } catch {
      setActionMessage("Failed to delete project update configuration.");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  if (loadError) {
    return <div className="p-8 text-[13px] text-red-400">{loadError}</div>;
  }

  return (
    <div className="max-w-[780px]">
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
            className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={!canManage}
            onClick={openCreateDialog}
          >
            Create update configuration
          </button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
          Only workspace admins can manage project update configurations.
        </p>
      ) : null}

      {actionMessage ? (
        <p className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
          {actionMessage}
        </p>
      ) : null}

      <div className="mt-8">
        {configurations.length === 0 ? (
          <EmptyState
            title="No update configurations"
            description="Configure reminder cadences and reporting formats for your projects."
            action={{
              label: "Create update configuration",
              onClick: openCreateDialog,
              disabled: !canManage,
              disabledReason: !canManage
                ? "Only workspace admins can create update configurations."
                : undefined,
            }}
          />
        ) : (
          <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            {configurations.map((configuration) => (
              <article
                key={configuration.id}
                className="flex items-start justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                      {configuration.name}
                    </h2>
                    <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                      {configuration.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
                    {formatSummary(configuration)}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                    Reports to{" "}
                    {configuration.shareTargets.map(targetLabel).join(", ")}
                    {configuration.slackChannel
                      ? ` · ${configuration.slackChannel}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-60"
                    type="button"
                    disabled={!canManage}
                    onClick={() => openEditDialog(configuration)}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded-md border border-red-900/50 px-2.5 py-1 text-[12px] text-red-400 hover:text-red-300 disabled:opacity-60"
                    type="button"
                    disabled={!canManage || deletingId === configuration.id}
                    onClick={() => void deleteConfiguration(configuration)}
                  >
                    {deletingId === configuration.id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <dialog
            open
            aria-labelledby="project-update-dialog-title"
            className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 shadow-xl"
          >
            <h2
              id="project-update-dialog-title"
              className="text-[18px] font-semibold text-[var(--color-text-primary)]"
            >
              {editingConfiguration
                ? "Edit update configuration"
                : "Create update configuration"}
            </h2>
            <div className="mt-5 space-y-4">
              <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    updateForm("enabled", event.currentTarget.checked)
                  }
                />
                Enable update reminders
              </label>
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Configuration name
                <input
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Reminder cadence
                  <select
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                    value={form.cadence}
                    onChange={(event) =>
                      updateForm(
                        "cadence",
                        event.target
                          .value as ProjectUpdateConfiguration["cadence"],
                      )
                    }
                  >
                    {CADENCES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Due day
                  <select
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                    value={form.dayOfWeek}
                    onChange={(event) =>
                      updateForm("dayOfWeek", Number(event.target.value))
                    }
                  >
                    {DAYS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Due time
                  <input
                    type="time"
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                    value={form.timeOfDay}
                    onChange={(event) =>
                      updateForm("timeOfDay", event.target.value)
                    }
                  />
                </label>
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Timezone
                  <input
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                    value={form.timezone}
                    onChange={(event) =>
                      updateForm("timezone", event.target.value)
                    }
                  />
                </label>
              </div>
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Project scope
                <select
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                  value={form.projectScope}
                  onChange={(event) =>
                    updateForm(
                      "projectScope",
                      event.target
                        .value as ProjectUpdateConfiguration["projectScope"],
                    )
                  }
                >
                  {PROJECT_SCOPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {form.projectScope === "statuses" ? (
                <fieldset className="rounded-md border border-[var(--color-border)] p-3">
                  <legend className="px-1 text-[13px] text-[var(--color-text-secondary)]">
                    Status scope
                  </legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {STATUS_OPTIONS.map(([value, label]) => (
                      <label
                        key={value}
                        className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]"
                      >
                        <input
                          type="checkbox"
                          checked={form.statusScope.includes(value)}
                          onChange={() =>
                            toggleArrayValue("statusScope", value)
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
              <fieldset className="rounded-md border border-[var(--color-border)] p-3">
                <legend className="px-1 text-[13px] text-[var(--color-text-secondary)]">
                  Reporting targets
                </legend>
                <div className="mt-2 space-y-2">
                  {SHARE_TARGETS.map(([value, label]) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]"
                    >
                      <input
                        type="checkbox"
                        checked={form.shareTargets.includes(value)}
                        onChange={() => toggleArrayValue("shareTargets", value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              {form.shareTargets.includes("slack") ? (
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Slack channel name
                  <input
                    placeholder="#project-updates"
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                    value={form.slackChannel}
                    onChange={(event) =>
                      updateForm("slackChannel", event.target.value)
                    }
                  />
                </label>
              ) : null}
              {error ? (
                <p className="text-[13px] text-red-400">{error}</p>
              ) : null}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-md px-4 py-[8px] text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]"
                type="button"
                onClick={() => {
                  setDialogOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:opacity-60"
                type="button"
                disabled={saving}
                onClick={saveConfiguration}
              >
                {saving
                  ? "Saving..."
                  : editingConfiguration
                    ? "Save changes"
                    : "Save configuration"}
              </button>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
