"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type TemplateType = "issue" | "document" | "project";

interface TeamTemplate {
  id: string;
  name: string;
  description: string;
  type?: TemplateType;
  settings?: {
    title?: string;
    body?: string;
    defaultPriority?: string;
    defaultStatusName?: string;
  };
}

interface TemplatesResponse {
  team: { id: string; name: string; key: string };
  templates: TeamTemplate[];
}

interface TemplateFormState {
  name: string;
  description: string;
  type: TemplateType;
  title: string;
  body: string;
  defaultPriority: string;
  defaultStatusName: string;
}

const emptyForm: TemplateFormState = {
  name: "",
  description: "",
  type: "issue",
  title: "",
  body: "",
  defaultPriority: "none",
  defaultStatusName: "",
};

function formFromTemplate(template?: TeamTemplate): TemplateFormState {
  if (!template) return emptyForm;
  return {
    name: template.name,
    description: template.description ?? "",
    type: template.type ?? "issue",
    title: template.settings?.title ?? "",
    body: template.settings?.body ?? template.description ?? "",
    defaultPriority: template.settings?.defaultPriority ?? "none",
    defaultStatusName: template.settings?.defaultStatusName ?? "",
  };
}

function templateTypeLabel(type: TemplateType | undefined) {
  if (type === "document") return "Document";
  if (type === "project") return "Project";
  return "Issue";
}

export default function TeamTemplatesSettingsPage() {
  const params = useParams();
  const teamKey = params.key as string;
  const [data, setData] = useState<TemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState<TeamTemplate | null>(null);
  const [form, setForm] = useState<TemplateFormState>(emptyForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const response = await fetch(`/api/teams/${teamKey}/templates`);
      const payload = (await response.json().catch(() => null)) as
        | TemplatesResponse
        | { error?: string }
        | null;

      if (response.status === 404) {
        setData(null);
        setNotFound(true);
        return;
      }

      if (!response.ok) {
        setData(null);
        setLoadError(
          payload && "error" in payload && payload.error
            ? payload.error
            : "Unable to load templates.",
        );
        return;
      }

      setData(payload as TemplatesResponse);
    } catch {
      setData(null);
      setLoadError("Unable to load templates.");
    } finally {
      setLoading(false);
    }
  }, [teamKey]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(template: TeamTemplate) {
    setEditing(template);
    setForm(formFromTemplate(template));
    setFormError(null);
    setDialogOpen(true);
  }

  async function saveTemplate() {
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/teams/${teamKey}/templates`, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editing?.id,
          name: form.name,
          description: form.description,
          type: form.type,
          settings: {
            title: form.title,
            body: form.body || form.description,
            defaultPriority: form.defaultPriority,
            defaultStatusName: form.defaultStatusName,
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        template?: TeamTemplate;
        error?: string;
      } | null;

      if (!response.ok || !payload?.template) {
        setFormError(payload?.error ?? "Failed to save template.");
        return;
      }

      const savedTemplate = payload.template;
      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          templates: editing
            ? current.templates.map((template) =>
                template.id === editing.id ? savedTemplate : template,
              )
            : [savedTemplate, ...current.templates],
        };
      });
      setDialogOpen(false);
    } catch {
      setFormError("Failed to save template.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(template: TeamTemplate) {
    if (!window.confirm(`Delete the ${template.name} template?`)) return;
    const previous = data?.templates ?? [];
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

    const response = await fetch(`/api/teams/${teamKey}/templates`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: template.id }),
    });

    if (!response.ok) {
      setData((current) =>
        current ? { ...current, templates: previous } : current,
      );
      setLoadError("Failed to delete template.");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        Loading...
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-[720px]">
        <Link
          href="/settings/teams"
          className="text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Back to teams
        </Link>
        <div className="mt-8 rounded-lg border border-[var(--color-border)] p-8">
          <h1 className="text-[20px] font-semibold text-[var(--color-text-primary)]">
            Team not found
          </h1>
          <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
            The requested team key is not available in this workspace.
          </p>
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="max-w-[720px] rounded-lg border border-[var(--color-border)] p-8 text-[var(--color-text-secondary)]">
        {loadError ?? "Unable to load templates."}
        <button
          type="button"
          onClick={() => void loadTemplates()}
          className="ml-3 text-[12px] text-[var(--color-accent)] hover:underline"
        >
          Retry
        </button>
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
          onClick={openCreate}
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
                  <span className="rounded bg-[var(--color-surface-elevated)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-text-tertiary)]">
                    {templateTypeLabel(template.type)}
                  </span>
                </div>
                <div className="text-[12px] text-[var(--color-text-tertiary)]">
                  {template.description ||
                    template.settings?.body ||
                    "No description"}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => openEdit(template)}
                  className="text-[12px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void deleteTemplate(template)}
                  className="text-[12px] text-[var(--color-text-tertiary)] hover:text-red-300"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <dialog
            open
            aria-labelledby="team-template-dialog-title"
            className="w-full max-w-[520px] rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-5 shadow-xl"
          >
            <h2
              id="team-template-dialog-title"
              className="text-[16px] font-semibold text-[var(--color-text-primary)]"
            >
              {editing ? "Edit template" : "Create template"}
            </h2>
            <div className="mt-4 grid gap-3">
              <label className="text-[12px] text-[var(--color-text-secondary)]">
                Template type
                <select
                  value={form.type}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      type: event.target.value as TemplateType,
                    })
                  }
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                >
                  <option value="issue">Issue</option>
                  <option value="document">Document</option>
                  <option value="project">Project</option>
                </select>
              </label>
              <label className="text-[12px] text-[var(--color-text-secondary)]">
                Name
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  placeholder="Bug report"
                />
              </label>
              <label className="text-[12px] text-[var(--color-text-secondary)]">
                Description
                <input
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  placeholder="When to use this template"
                />
              </label>
              <label className="text-[12px] text-[var(--color-text-secondary)]">
                Default issue title
                <input
                  value={form.title}
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  placeholder="Optional pre-filled title"
                />
              </label>
              <label className="text-[12px] text-[var(--color-text-secondary)]">
                Body
                <textarea
                  value={form.body}
                  onChange={(event) =>
                    setForm({ ...form, body: event.target.value })
                  }
                  className="mt-1 min-h-[110px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  placeholder="Template body"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[12px] text-[var(--color-text-secondary)]">
                  Priority
                  <select
                    value={form.defaultPriority}
                    onChange={(event) =>
                      setForm({ ...form, defaultPriority: event.target.value })
                    }
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                  >
                    <option value="none">No priority</option>
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label className="text-[12px] text-[var(--color-text-secondary)]">
                  Status name
                  <input
                    value={form.defaultStatusName}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        defaultStatusName: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
                    placeholder="Backlog"
                  />
                </label>
              </div>
            </div>
            {formError ? (
              <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
                {formError}
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveTemplate()}
                disabled={saving}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save template"}
              </button>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
