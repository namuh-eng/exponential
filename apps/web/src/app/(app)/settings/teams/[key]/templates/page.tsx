"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  settings?: {
    title?: string;
    body?: string;
    defaultPriority?: string;
    defaultStatusName?: string;
    defaultTeamId?: string;
    defaultTeamKey?: string;
  };
}

interface TemplatesResponse {
  team: { name: string; key: string };
  templates: TeamTemplate[];
}

type DialogState =
  | { mode: "create"; template: null }
  | { mode: "edit"; template: TeamTemplate };

const emptyForm = {
  name: "",
  description: "",
  title: "",
  body: "",
  defaultPriority: "none",
  defaultStatusName: "",
};

function readError(payload: unknown, fallback: string) {
  return typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { error?: unknown }).error === "string"
    ? (payload as { error: string }).error
    : fallback;
}

export default function TeamTemplatesSettingsPage() {
  const params = useParams();
  const teamKey = String(params.key ?? "").toUpperCase();
  const [data, setData] = useState<TemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadTemplates() {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(
          `/api/teams/${encodeURIComponent(teamKey)}/templates`,
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(readError(payload, "Unable to load team templates."));
        }
        if (!cancelled) setData(payload as TemplatesResponse);
      } catch (error) {
        if (!cancelled) {
          setData(null);
          setLoadError(
            error instanceof Error
              ? error.message
              : "Unable to load team templates.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [teamKey]);

  function openDialog(template?: TeamTemplate) {
    setFormError(null);
    setDialog(
      template
        ? { mode: "edit", template }
        : { mode: "create", template: null },
    );
    setForm({
      name: template?.name ?? "",
      description: template?.description ?? "",
      title: template?.settings?.title ?? "",
      body: template?.settings?.body ?? template?.description ?? "",
      defaultPriority: template?.settings?.defaultPriority ?? "none",
      defaultStatusName: template?.settings?.defaultStatusName ?? "",
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = form.name.trim();
    const description = form.description.trim();
    const body = form.body.trim();
    if (!name) {
      setFormError("Template name is required.");
      return;
    }
    if (!description && !body) {
      setFormError("Issue description is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch(
        `/api/teams/${encodeURIComponent(teamKey)}/templates`,
        {
          method: dialog?.mode === "edit" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: dialog?.mode === "edit" ? dialog.template.id : undefined,
            name,
            description: description || body,
            settings: {
              title: form.title.trim(),
              body,
              defaultPriority: form.defaultPriority,
              defaultStatusName: form.defaultStatusName.trim(),
            },
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readError(payload, "Failed to save team template."));
      }
      const template = (payload as { template: TeamTemplate }).template;
      setData((current) =>
        current
          ? {
              ...current,
              templates:
                dialog?.mode === "edit"
                  ? current.templates.map((item) =>
                      item.id === template.id ? template : item,
                    )
                  : [template, ...current.templates],
            }
          : current,
      );
      setDialog(null);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Failed to save team template.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(template: TeamTemplate) {
    setFormError(null);
    setSaving(true);
    try {
      const response = await fetch(
        `/api/teams/${encodeURIComponent(teamKey)}/templates`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: template.id }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readError(payload, "Failed to delete team template."));
      }
      setData((current) =>
        current
          ? {
              ...current,
              templates: current.templates.filter(
                (item) => item.id !== template.id,
              ),
            }
          : current,
      );
      setDialog(null);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Failed to delete team template.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (loadError || !data) {
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
        <div
          role="alert"
          className="rounded-lg border border-[var(--color-border)] border-dashed p-12 text-center text-[var(--color-text-tertiary)]"
        >
          {loadError ?? "Team not found"}
        </div>
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
          Templates
        </h1>
        <button
          type="button"
          onClick={() => openDialog()}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          New template
        </button>
      </div>
      <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
        Create reusable templates for issues, documents, and projects for the{" "}
        {data.team.name} team.
      </p>

      {loadError ? (
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {loadError}
        </div>
      ) : null}

      <div className="mt-8 flex flex-col gap-2">
        {data.templates.length === 0 ? (
          <div className="rounded-lg border border-[var(--color-border)] border-dashed p-12 text-center text-[var(--color-text-tertiary)]">
            No templates have been created for this team.
          </div>
        ) : (
          data.templates.map((template) => (
            <div
              key={template.id}
              className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3"
            >
              <div>
                <div className="flex items-center gap-2 text-[14px] font-medium text-[var(--color-text-primary)]">
                  {template.name}
                </div>
                <div className="text-[12px] text-[var(--color-text-tertiary)]">
                  {template.description ||
                    template.settings?.body ||
                    "No description"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => openDialog(template)}
                className="text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                Edit
              </button>
            </div>
          ))
        )}
      </div>

      {dialog ? (
        <dialog
          open
          aria-modal="true"
          aria-labelledby="team-template-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
        >
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-[520px] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 shadow-xl"
          >
            <h2
              id="team-template-dialog-title"
              className="text-[16px] font-semibold text-[var(--color-text-primary)]"
            >
              {dialog.mode === "edit"
                ? "Edit team template"
                : "Create team template"}
            </h2>
            {formError ? (
              <p
                role="alert"
                className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-500"
              >
                {formError}
              </p>
            ) : null}
            <label className="mt-4 block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Name
              <input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              />
            </label>
            <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Description
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                className="mt-1 min-h-16 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              />
            </label>
            <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Default title
              <input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              />
            </label>
            <label className="mt-3 block text-[12px] font-medium text-[var(--color-text-secondary)]">
              Issue body
              <textarea
                value={form.body}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    body: event.target.value,
                  }))
                }
                className="mt-1 min-h-24 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
                Priority
                <select
                  value={form.defaultPriority}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      defaultPriority: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                >
                  <option value="none">No priority</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
                Status name
                <input
                  value={form.defaultStatusName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      defaultStatusName: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-between gap-3">
              <div>
                {dialog.mode === "edit" ? (
                  <button
                    type="button"
                    onClick={() => void deleteTemplate(dialog.template)}
                    disabled={saving}
                    className="rounded-md border border-red-500/50 px-3 py-1.5 text-[12px] font-medium text-red-500 disabled:opacity-60"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDialog(null)}
                  disabled={saving}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save template"}
                </button>
              </div>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}
