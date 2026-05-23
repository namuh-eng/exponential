"use client";

import { formatCadence } from "@/lib/recurring-issues";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type Cadence = "daily" | "weekly" | "monthly";

type RecurringIssue = {
  id: string;
  title: string;
  description: string | null;
  cadenceConfig: { cadence: Cadence; interval: number };
  timezone: string;
  startAt: string | null;
  nextRunAt: string;
  enabled: boolean;
  priority: "none" | "urgent" | "high" | "medium" | "low";
};

type RecurringIssuesResponse = {
  team: { name: string; key: string; timezone?: string | null };
  recurringIssues: RecurringIssue[];
};

const emptyForm = {
  title: "",
  description: "",
  cadence: "weekly" as Cadence,
  interval: "1",
  startAt: "",
  timezone: "UTC",
  enabled: true,
  priority: "none" as RecurringIssue["priority"],
};

function getLocalDateTimeInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toFormValues(issue: RecurringIssue) {
  return {
    title: issue.title,
    description: issue.description ?? "",
    cadence: issue.cadenceConfig.cadence,
    interval: String(issue.cadenceConfig.interval),
    startAt: issue.startAt
      ? getLocalDateTimeInputValue(new Date(issue.startAt))
      : getLocalDateTimeInputValue(),
    timezone: issue.timezone || "UTC",
    enabled: issue.enabled,
    priority: issue.priority ?? "none",
  };
}

function nextRunLabel(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function TeamRecurringIssuesSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const workspaceSlug =
    typeof params.workspaceSlug === "string" ? params.workspaceSlug : null;
  const [data, setData] = useState<RecurringIssuesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<RecurringIssue | null>(null);
  const [formValues, setFormValues] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const backHref = workspaceSlug
    ? `/${encodeURIComponent(workspaceSlug)}/settings/teams/${encodeURIComponent(teamKey)}`
    : `/settings/teams/${encodeURIComponent(teamKey)}`;

  const fetchRecurringIssues = useCallback(async () => {
    const res = await fetch(
      `/api/teams/${encodeURIComponent(teamKey)}/recurring-issues`,
    );
    if (!res.ok) {
      throw new Error("Failed to load recurring issues");
    }
    const json = (await res.json()) as RecurringIssuesResponse;
    setData(json);
  }, [teamKey]);

  useEffect(() => {
    fetchRecurringIssues()
      .catch((error: Error) => {
        setFormError(error.message);
      })
      .finally(() => setLoading(false));
  }, [fetchRecurringIssues]);

  const defaultTimezone = data?.team.timezone || "UTC";
  const defaultsForNewIssue = useMemo(
    () => ({
      ...emptyForm,
      startAt: getLocalDateTimeInputValue(),
      timezone: defaultTimezone,
    }),
    [defaultTimezone],
  );

  const openCreateForm = () => {
    setEditingIssue(null);
    setFormValues(defaultsForNewIssue);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditForm = (issue: RecurringIssue) => {
    setEditingIssue(issue);
    setFormValues(toFormValues(issue));
    setFormError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingIssue(null);
    setFormError(null);
  };

  const updateForm = (
    field: keyof typeof formValues,
    value: string | boolean,
  ) => {
    setFormValues((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!formValues.title.trim()) {
      setFormError("Title is required");
      return;
    }

    const interval = Number(formValues.interval);
    if (!Number.isInteger(interval) || interval < 1) {
      setFormError("Cadence interval must be at least 1");
      return;
    }

    setSubmitting(true);
    const payload = {
      title: formValues.title.trim(),
      description: formValues.description.trim() || null,
      cadenceConfig: { cadence: formValues.cadence, interval },
      startAt: formValues.startAt,
      timezone: formValues.timezone.trim() || "UTC",
      enabled: formValues.enabled,
      priority: formValues.priority,
    };

    try {
      const url = editingIssue
        ? `/api/teams/${encodeURIComponent(teamKey)}/recurring-issues/${editingIssue.id}`
        : `/api/teams/${encodeURIComponent(teamKey)}/recurring-issues`;
      const res = await fetch(url, {
        method: editingIssue ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFormError(json?.error ?? "Failed to save recurring issue");
        return;
      }

      await fetchRecurringIssues();
      closeForm();
    } finally {
      setSubmitting(false);
    }
  };

  const toggleEnabled = async (issue: RecurringIssue) => {
    const res = await fetch(
      `/api/teams/${encodeURIComponent(teamKey)}/recurring-issues/${issue.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !issue.enabled }),
      },
    );
    if (res.ok) {
      await fetchRecurringIssues();
    }
  };

  const deleteIssue = async (issue: RecurringIssue) => {
    if (!globalThis.confirm(`Delete recurring issue "${issue.title}"?`)) return;
    const res = await fetch(
      `/api/teams/${encodeURIComponent(teamKey)}/recurring-issues/${issue.id}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      await fetchRecurringIssues();
    }
  };

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
        Team recurring issues could not be loaded.
      </div>
    );
  }

  return (
    <div className="max-w-[760px]">
      <div className="mb-6">
        <Link
          href={backHref}
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to team settings
        </Link>
      </div>

      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
          Recurring issues
        </h1>
        <button
          type="button"
          onClick={openCreateForm}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          New recurring issue
        </button>
      </div>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Set up scheduled issues that repeat for {data.team.name ?? teamKey} on a
        fixed cadence.
      </p>

      {formOpen && (
        <RecurringIssueForm
          editing={Boolean(editingIssue)}
          values={formValues}
          error={formError}
          submitting={submitting}
          onChange={updateForm}
          onCancel={closeForm}
          onSubmit={handleSubmit}
        />
      )}

      <div className="mt-8 flex flex-col gap-2">
        {data.recurringIssues.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] border-dashed p-12 text-center text-[var(--color-text-tertiary)]">
            No recurring issues have been configured for this team.
          </div>
        ) : (
          data.recurringIssues.map((issue) => (
            <article
              key={issue.id}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] px-4 py-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[14px] font-medium text-[var(--color-text-primary)]">
                    {issue.title}
                  </div>
                  {issue.description && (
                    <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
                      {issue.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--color-text-tertiary)]">
                    <span>{formatCadence(issue.cadenceConfig)}</span>
                    <span>•</span>
                    <span>Next run {nextRunLabel(issue.nextRunAt)}</span>
                    <span>•</span>
                    <span>{issue.timezone}</span>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    issue.enabled
                      ? "bg-green-500/10 text-green-300"
                      : "bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]"
                  }`}
                >
                  {issue.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openEditForm(issue)}
                  className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => toggleEnabled(issue)}
                  className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                  {issue.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  onClick={() => deleteIssue(issue)}
                  className="rounded-md border border-red-500/30 px-2.5 py-1 text-[12px] text-red-300 hover:text-red-200"
                >
                  Delete
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function RecurringIssueForm({
  editing,
  values,
  error,
  submitting,
  onChange,
  onCancel,
  onSubmit,
}: {
  editing: boolean;
  values: typeof emptyForm;
  error: string | null;
  submitting: boolean;
  onChange: (field: keyof typeof emptyForm, value: string | boolean) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      aria-label={editing ? "Edit recurring issue" : "Create recurring issue"}
      onSubmit={onSubmit}
      className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-hover)] p-4"
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-[var(--color-text-secondary)]">
          Title
          <input
            name="title"
            type="text"
            value={values.title}
            onChange={(event) => onChange("title", event.target.value)}
            placeholder="Review on-call handoff"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-[var(--color-text-secondary)]">
          Description
          <textarea
            name="description"
            value={values.description}
            onChange={(event) => onChange("description", event.target.value)}
            placeholder="Template content for each created issue"
            rows={3}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[13px] text-[var(--color-text-secondary)]">
            Cadence
            <select
              name="cadence"
              value={values.cadence}
              onChange={(event) => onChange("cadence", event.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-[var(--color-text-secondary)]">
            Repeat every
            <input
              name="interval"
              type="number"
              min="1"
              value={values.interval}
              onChange={(event) => onChange("interval", event.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-[var(--color-text-secondary)]">
            Start
            <input
              name="startAt"
              type="datetime-local"
              value={values.startAt}
              onChange={(event) => onChange("startAt", event.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-[var(--color-text-secondary)]">
            Timezone
            <input
              name="timezone"
              type="text"
              value={values.timezone}
              onChange={(event) => onChange("timezone", event.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
            <input
              name="enabled"
              type="checkbox"
              checked={values.enabled}
              onChange={(event) => onChange("enabled", event.target.checked)}
            />
            Enabled
          </label>
          <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
            Priority
            <select
              name="priority"
              value={values.priority}
              onChange={(event) => onChange("priority", event.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-2 py-1 text-[13px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              <option value="none">No priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>
        {error && <p className="text-[12px] text-red-400">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting
              ? "Saving..."
              : editing
                ? "Save recurring issue"
                : "Create recurring issue"}
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
