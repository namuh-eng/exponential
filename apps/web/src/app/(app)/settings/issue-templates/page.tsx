"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

type TemplateSettings = {
  title?: string;
  body?: string;
  defaultPriority?: string;
  defaultStatusName?: string;
  defaultTeamKey?: string;
  defaultScope?: string;
};

type IssueTemplate = {
  id: string;
  name: string;
  description: string;
  settings: TemplateSettings;
  createdAt: string;
};

const emptySettings: TemplateSettings = { defaultPriority: "none" };

export default function IssueTemplatesPage() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<IssueTemplate[]>([]);
  const [editing, setEditing] = useState<IssueTemplate | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    title: "",
    body: "",
    defaultPriority: "none",
    defaultStatusName: "",
    defaultTeamKey: "",
    defaultScope: "",
  });
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadTemplates() {
      try {
        const response = await fetch("/api/issue-templates");
        if (!response.ok) throw new Error("Failed to load issue templates");
        const payload = await response.json();
        if (!cancelled) setTemplates(payload.templates ?? []);
      } catch {
        if (!cancelled) setLoadError("Unable to load issue templates.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  function openCreate(template?: IssueTemplate) {
    setEditing(template ?? null);
    setForm({
      name: template?.name ?? "",
      description: template?.description ?? "",
      title: template?.settings?.title ?? "",
      body: template?.settings?.body ?? template?.description ?? "",
      defaultPriority: template?.settings?.defaultPriority ?? "none",
      defaultStatusName: template?.settings?.defaultStatusName ?? "",
      defaultTeamKey: template?.settings?.defaultTeamKey ?? "",
      defaultScope: template?.settings?.defaultScope ?? "",
    });
    setError("");
    setDialogOpen(true);
  }

  async function saveTemplate() {
    const trimmedName = form.name.trim();
    const trimmedDescription = form.description.trim();
    if (!trimmedName) return setError("Template name is required.");
    if (!trimmedDescription) return setError("Issue description is required.");
    setSaving(true);
    setError("");
    const settings: TemplateSettings = {
      title: form.title.trim(),
      body: form.body.trim() || trimmedDescription,
      defaultPriority: form.defaultPriority,
      defaultStatusName: form.defaultStatusName.trim(),
      defaultTeamKey: form.defaultTeamKey.trim(),
      defaultScope: form.defaultScope.trim(),
    };
    try {
      const response = await fetch(
        editing ? `/api/issue-templates/${editing.id}` : "/api/issue-templates",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            description: trimmedDescription,
            settings,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        return setError(
          payload.error ??
            (editing
              ? "Failed to save issue template."
              : "Failed to create issue template."),
        );
      setTemplates((current) =>
        editing
          ? current.map((template) =>
              template.id === editing.id ? payload.template : template,
            )
          : [payload.template, ...current],
      );
      setDialogOpen(false);
      setEditing(null);
    } catch {
      setError(
        editing
          ? "Failed to save issue template."
          : "Failed to create issue template.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function duplicateTemplate(template: IssueTemplate) {
    const response = await fetch("/api/issue-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duplicateFromId: template.id }),
    });
    const payload = await response.json();
    if (response.ok) setTemplates((current) => [payload.template, ...current]);
  }

  async function deleteTemplate(template: IssueTemplate) {
    const response = await fetch(`/api/issue-templates/${template.id}`, {
      method: "DELETE",
    });
    if (response.ok)
      setTemplates((current) =>
        current.filter((item) => item.id !== template.id),
      );
  }

  async function archiveTemplate(template: IssueTemplate) {
    const response = await fetch(`/api/issue-templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: template.settings ?? emptySettings,
        archived: true,
      }),
    });
    if (response.ok)
      setTemplates((current) =>
        current.filter((item) => item.id !== template.id),
      );
  }

  if (loading)
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  if (loadError)
    return <div className="p-8 text-[13px] text-red-400">{loadError}</div>;

  return (
    <div className="max-w-[820px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
            Issue templates
          </h1>
          <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
            Create and manage reusable templates for issue descriptions and
            default properties.
          </p>
        </div>
        {templates.length > 0 ? (
          <button
            className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white"
            type="button"
            onClick={() => openCreate()}
          >
            Create template
          </button>
        ) : null}
      </div>
      <div className="mt-8">
        {templates.length === 0 ? (
          <EmptyState
            title="No templates"
            description="Create your first issue template to standardize new issues."
            action={{ label: "Create template", onClick: () => openCreate() }}
          />
        ) : (
          <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            {templates.map((template) => (
              <article key={template.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                      {template.name}
                    </h2>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-[var(--color-text-secondary)]">
                      {template.description}
                    </p>
                    <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
                      Defaults: {template.settings?.title || "No title"} ·{" "}
                      {template.settings?.defaultPriority || "none"} ·{" "}
                      {template.settings?.defaultStatusName || "No status"} ·{" "}
                      {template.settings?.defaultTeamKey || "Any team"} ·{" "}
                      {template.settings?.defaultScope || "No scope"}
                    </p>
                  </div>
                  <div className="flex gap-2 text-[12px]">
                    <button type="button" onClick={() => openCreate(template)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void duplicateTemplate(template)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => void archiveTemplate(template)}
                    >
                      Archive
                    </button>
                    <button
                      type="button"
                      className="text-red-400"
                      onClick={() => void deleteTemplate(template)}
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
      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <dialog
            open
            aria-labelledby="issue-template-dialog-title"
            className="w-full max-w-[560px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 shadow-xl"
          >
            <h2
              id="issue-template-dialog-title"
              className="text-[18px] font-semibold text-[var(--color-text-primary)]"
            >
              {editing ? "Edit issue template" : "Create issue template"}
            </h2>
            <div className="mt-5 grid gap-4">
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Template name
                <input
                  aria-label="Template name"
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Issue description
                <textarea
                  aria-label="Issue description"
                  className="mt-1 min-h-[90px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </label>
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Default title
                <input
                  aria-label="Default title"
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                  value={form.title}
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                />
              </label>
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Template body
                <textarea
                  aria-label="Template body"
                  className="mt-1 min-h-[90px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                  value={form.body}
                  onChange={(event) =>
                    setForm({ ...form, body: event.target.value })
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[13px] text-[var(--color-text-secondary)]">
                  Default priority
                  <select
                    aria-label="Default priority"
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                    value={form.defaultPriority}
                    onChange={(event) =>
                      setForm({ ...form, defaultPriority: event.target.value })
                    }
                  >
                    {["none", "low", "medium", "high", "urgent"].map(
                      (value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="text-[13px] text-[var(--color-text-secondary)]">
                  Default status
                  <input
                    aria-label="Default status"
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                    value={form.defaultStatusName}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        defaultStatusName: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="text-[13px] text-[var(--color-text-secondary)]">
                  Default team
                  <input
                    aria-label="Default team"
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                    value={form.defaultTeamKey}
                    onChange={(event) =>
                      setForm({ ...form, defaultTeamKey: event.target.value })
                    }
                  />
                </label>
                <label className="text-[13px] text-[var(--color-text-secondary)]">
                  Default scope
                  <input
                    aria-label="Default scope"
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                    value={form.defaultScope}
                    onChange={(event) =>
                      setForm({ ...form, defaultScope: event.target.value })
                    }
                  />
                </label>
              </div>
              {error ? (
                <p className="text-[13px] text-red-400">{error}</p>
              ) : null}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-md px-4 py-[8px] text-[13px]"
                type="button"
                onClick={() => {
                  setDialogOpen(false);
                  setError("");
                  setEditing(null);
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white disabled:opacity-60"
                type="button"
                disabled={saving}
                onClick={() => void saveTemplate()}
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
