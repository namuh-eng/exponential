"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";

type Cadence = "daily" | "weekly" | "monthly";

type RecurringIssue = {
  id: string;
  title: string;
  description: string;
  cadenceConfig: {
    cadence?: Cadence;
    interval?: number;
    startDate?: string;
    time?: string;
  };
  cadenceLabel: string;
  timezone: string;
  nextRunAt: string;
  enabled: boolean;
};

type FormState = {
  title: string;
  description: string;
  cadence: Cadence;
  interval: string;
  startDate: string;
  time: string;
  timezone: string;
  enabled: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): FormState => ({
  title: "",
  description: "",
  cadence: "weekly",
  interval: "1",
  startDate: today(),
  time: "09:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  enabled: true,
});

function formatNextRun(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formFromIssue(issue: RecurringIssue): FormState {
  return {
    title: issue.title,
    description: issue.description ?? "",
    cadence: issue.cadenceConfig.cadence ?? "weekly",
    interval: String(issue.cadenceConfig.interval ?? 1),
    startDate: issue.cadenceConfig.startDate ?? today(),
    time: issue.cadenceConfig.time ?? "09:00",
    timezone: issue.timezone || "UTC",
    enabled: issue.enabled,
  };
}

export default function TeamRecurringIssuesSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const workspaceSlug = params.workspaceSlug as string | undefined;
  const [team, setTeam] = useState<{ name: string; key: string } | null>(null);
  const [recurringIssues, setRecurringIssues] = useState<RecurringIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<RecurringIssue | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [fieldError, setFieldError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const backHref = workspaceSlug
    ? `/${encodeURIComponent(workspaceSlug)}/settings/teams/${encodeURIComponent(teamKey)}`
    : `/settings/teams/${encodeURIComponent(teamKey)}`;

  const apiPath = `/api/teams/${encodeURIComponent(teamKey)}/recurring-issues`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(apiPath)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? "Unable to load recurring issues");
        if (!cancelled) {
          setTeam(data.team ?? null);
          setRecurringIssues(data.recurringIssues ?? []);
          setLoadError("");
        }
      })
      .catch((error) => {
        if (!cancelled)
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load recurring issues",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiPath]);

  const dialogTitle = editingIssue
    ? "Edit recurring issue"
    : "Create recurring issue";
  const saveLabel = editingIssue ? "Save changes" : "Create recurring issue";

  const cadenceHelp = useMemo(() => {
    if (form.cadence === "daily")
      return "Creates a new issue every configured number of days.";
    if (form.cadence === "weekly")
      return "Creates a new issue on the selected start weekday.";
    return "Creates a new issue on the selected day of each month.";
  }, [form.cadence]);

  function openCreateDialog() {
    setEditingIssue(null);
    setForm(emptyForm());
    setFieldError("");
    setMessage("");
    setDialogOpen(true);
  }

  function openEditDialog(issue: RecurringIssue) {
    setEditingIssue(issue);
    setForm(formFromIssue(issue));
    setFieldError("");
    setMessage("");
    setDialogOpen(true);
  }

  function updateForm(patch: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setFieldError("");
    setMessage("");
  }

  async function saveRecurringIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) {
      setFieldError("Title is required.");
      return;
    }
    if (!form.startDate) {
      setFieldError("Start date is required.");
      return;
    }

    setSaving(true);
    setFieldError("");
    setMessage("");
    try {
      const response = await fetch(
        editingIssue ? `${apiPath}/${editingIssue.id}` : apiPath,
        {
          method: editingIssue ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.title,
            description: form.description,
            cadence: form.cadence,
            interval: Number(form.interval),
            startDate: form.startDate,
            time: form.time,
            timezone: form.timezone,
            enabled: form.enabled,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Unable to save recurring issue");
      const saved = data.recurringIssue as RecurringIssue;
      setRecurringIssues((current) =>
        editingIssue
          ? current.map((issue) => (issue.id === saved.id ? saved : issue))
          : [saved, ...current],
      );
      setDialogOpen(false);
      setEditingIssue(null);
      setMessage(
        editingIssue ? "Recurring issue updated." : "Recurring issue created.",
      );
    } catch (error) {
      setFieldError(
        error instanceof Error
          ? error.message
          : "Unable to save recurring issue",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(issue: RecurringIssue) {
    const nextEnabled = !issue.enabled;
    const body = formFromIssue({ ...issue, enabled: nextEnabled });
    setMessage("");
    try {
      const response = await fetch(`${apiPath}/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          interval: Number(body.interval),
          enabled: nextEnabled,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Unable to update recurring issue");
      const saved = data.recurringIssue as RecurringIssue;
      setRecurringIssues((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      setMessage(
        nextEnabled ? "Recurring issue enabled." : "Recurring issue disabled.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update recurring issue",
      );
    }
  }

  async function deleteIssue(issue: RecurringIssue) {
    if (!window.confirm(`Delete recurring issue “${issue.title}”?`)) return;
    setMessage("");
    try {
      const response = await fetch(`${apiPath}/${issue.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Unable to delete recurring issue");
      setRecurringIssues((current) =>
        current.filter((item) => item.id !== issue.id),
      );
      setMessage("Recurring issue deleted.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to delete recurring issue",
      );
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
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

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
          Recurring issues
        </h1>
        <button
          type="button"
          onClick={openCreateDialog}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          New recurring issue
        </button>
      </div>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Set up scheduled issues that repeat for {team?.name ?? teamKey} on a
        fixed cadence.
      </p>

      {loadError ? (
        <div className="mt-6 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-400">
          {loadError}
        </div>
      ) : null}
      {message ? (
        <div className="mt-6 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-[13px] text-[var(--color-text-secondary)]">
          {message}
        </div>
      ) : null}

      {recurringIssues.length === 0 ? (
        <div className="mt-8 rounded-lg border border-[var(--color-border)] border-dashed p-12 text-center">
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            No recurring issues have been configured for this team.
          </p>
          <button
            type="button"
            onClick={openCreateDialog}
            className="mt-4 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-secondary)]"
          >
            Create recurring issue
          </button>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {recurringIssues.map((issue) => (
            <article
              key={issue.id}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                    {issue.title}
                  </h2>
                  {issue.description ? (
                    <p className="mt-1 line-clamp-2 text-[12px] text-[var(--color-text-tertiary)]">
                      {issue.description}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${issue.enabled ? "bg-green-500/10 text-green-400" : "bg-[var(--color-bg-secondary)] text-[var(--color-text-tertiary)]"}`}
                >
                  {issue.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-3">
                <div>
                  <dt className="text-[var(--color-text-tertiary)]">Cadence</dt>
                  <dd className="mt-1 text-[var(--color-text-primary)]">
                    {issue.cadenceLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-tertiary)]">
                    Next run
                  </dt>
                  <dd className="mt-1 text-[var(--color-text-primary)]">
                    {formatNextRun(issue.nextRunAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-text-tertiary)]">
                    Timezone
                  </dt>
                  <dd className="mt-1 text-[var(--color-text-primary)]">
                    {issue.timezone}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openEditDialog(issue)}
                  className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => toggleEnabled(issue)}
                  className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]"
                >
                  {issue.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  onClick={() => deleteIssue(issue)}
                  className="rounded-md border border-red-500/30 px-2.5 py-1 text-[12px] text-red-400 hover:bg-red-500/10"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <dialog
            open
            aria-labelledby="recurring-issue-dialog-title"
            className="w-full max-w-[560px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2
                id="recurring-issue-dialog-title"
                className="text-[16px] font-semibold text-[var(--color-text-primary)]"
              >
                {dialogTitle}
              </h2>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                Close
              </button>
            </div>
            <form className="space-y-4" onSubmit={saveRecurringIssue}>
              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                  Issue title
                </span>
                <input
                  aria-label="Issue title"
                  value={form.title}
                  onChange={(event) =>
                    updateForm({ title: event.target.value })
                  }
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  placeholder="Weekly metrics review"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                  Description
                </span>
                <textarea
                  aria-label="Description"
                  value={form.description}
                  onChange={(event) =>
                    updateForm({ description: event.target.value })
                  }
                  rows={4}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  placeholder="Template content for each scheduled issue"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                    Cadence
                  </span>
                  <select
                    aria-label="Cadence"
                    value={form.cadence}
                    onChange={(event) =>
                      updateForm({ cadence: event.target.value as Cadence })
                    }
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                    Repeat every
                  </span>
                  <input
                    aria-label="Repeat every"
                    type="number"
                    min="1"
                    max="12"
                    value={form.interval}
                    onChange={(event) =>
                      updateForm({ interval: event.target.value })
                    }
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  />
                </label>
              </div>
              <p className="text-[12px] text-[var(--color-text-tertiary)]">
                {cadenceHelp}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                    Start date
                  </span>
                  <input
                    aria-label="Start date"
                    type="date"
                    value={form.startDate}
                    onChange={(event) =>
                      updateForm({ startDate: event.target.value })
                    }
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                    Start time
                  </span>
                  <input
                    aria-label="Start time"
                    type="time"
                    value={form.time}
                    onChange={(event) =>
                      updateForm({ time: event.target.value })
                    }
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
                    Timezone
                  </span>
                  <input
                    aria-label="Timezone"
                    value={form.timezone}
                    onChange={(event) =>
                      updateForm({ timezone: event.target.value })
                    }
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
                <input
                  aria-label="Enabled"
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    updateForm({ enabled: event.target.checked })
                  }
                />
                Enabled
              </label>
              {fieldError ? (
                <p className="text-[12px] text-red-400">{fieldError}</p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Saving..." : saveLabel}
                </button>
              </div>
            </form>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
