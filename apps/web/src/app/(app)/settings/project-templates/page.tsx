"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

type ProjectTemplateSettings = {
  status?: string | null;
  priority?: string | null;
  labelIds?: string[];
  milestones?: string[];
};

type ProjectTemplate = {
  id: string;
  name: string;
  description: string;
  settings?: ProjectTemplateSettings;
  createdAt: string;
};

type ProjectLabel = { id: string; name: string; color: string };

const PROJECT_STATUSES = [
  ["", "Keep default"],
  ["planned", "Planned"],
  ["started", "In progress"],
  ["paused", "Paused"],
  ["completed", "Completed"],
  ["canceled", "Canceled"],
] as const;

const PROJECT_PRIORITIES = [
  ["", "Keep default"],
  ["none", "No priority"],
  ["urgent", "Urgent"],
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
] as const;

function splitLines(value: string) {
  return Array.from(
    new Set(
      value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  );
}

function formatTemplateSummary(template: ProjectTemplate) {
  const settings = template.settings ?? {};
  const pieces = [
    settings.status ? `Status: ${settings.status}` : null,
    settings.priority ? `Priority: ${settings.priority}` : null,
    settings.labelIds?.length ? `${settings.labelIds.length} labels` : null,
    settings.milestones?.length
      ? `${settings.milestones.length} milestones`
      : null,
  ].filter(Boolean);

  return pieces.length > 0 ? pieces.join(" · ") : "No structure configured";
}

export default function ProjectTemplatesPage() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [labels, setLabels] = useState<ProjectLabel[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<ProjectTemplate | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [milestones, setMilestones] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTemplates() {
      try {
        const [templatesResponse, labelsResponse] = await Promise.all([
          fetch("/api/project-templates"),
          fetch("/api/project-labels"),
        ]);
        if (!templatesResponse.ok) {
          throw new Error("Failed to load project templates");
        }
        const payload = await templatesResponse.json();
        const labelsPayload = labelsResponse.ok
          ? await labelsResponse.json()
          : { labels: [] };
        if (!cancelled) {
          setTemplates(payload.templates ?? []);
          setLabels(labelsPayload.labels ?? []);
        }
      } catch {
        if (!cancelled) {
          setLoadError("Unable to load project templates.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadTemplates();

    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setEditingTemplate(null);
    setName("");
    setDescription("");
    setStatus("");
    setPriority("");
    setLabelIds([]);
    setMilestones("");
    setError("");
  }

  function openCreateDialog() {
    resetForm();
    setActionMessage("");
    setDialogOpen(true);
  }

  function openEditDialog(template: ProjectTemplate) {
    const settings = template.settings ?? {};
    setEditingTemplate(template);
    setName(template.name);
    setDescription(template.description);
    setStatus(settings.status ?? "");
    setPriority(settings.priority ?? "");
    setLabelIds(settings.labelIds ?? []);
    setMilestones((settings.milestones ?? []).join("\n"));
    setError("");
    setActionMessage("");
    setDialogOpen(true);
  }

  async function saveTemplate() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Template name is required.");
      return;
    }

    setSaving(true);
    setError("");
    setActionMessage("");

    try {
      const url = editingTemplate
        ? `/api/project-templates/${encodeURIComponent(editingTemplate.id)}`
        : "/api/project-templates";
      const response = await fetch(url, {
        method: editingTemplate ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description,
          settings: {
            status: status || null,
            priority: priority || null,
            labelIds,
            milestones: splitLines(milestones),
          },
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          payload.error ??
            (editingTemplate
              ? "Failed to update project template."
              : "Failed to create project template."),
        );
        return;
      }

      setTemplates((current) =>
        editingTemplate
          ? current.map((template) =>
              template.id === editingTemplate.id ? payload.template : template,
            )
          : [payload.template, ...current],
      );
      setDialogOpen(false);
      setActionMessage(
        editingTemplate
          ? "Project template updated."
          : "Project template created.",
      );
      resetForm();
    } catch {
      setError(
        editingTemplate
          ? "Failed to update project template."
          : "Failed to create project template.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function duplicateTemplate(template: ProjectTemplate) {
    setActionMessage("");
    try {
      const response = await fetch("/api/project-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${template.name} copy`,
          description: template.description,
          settings: template.settings ?? {},
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionMessage(
          payload.error ?? "Failed to duplicate project template.",
        );
        return;
      }
      setTemplates((current) => [payload.template, ...current]);
      setActionMessage("Project template duplicated.");
    } catch {
      setActionMessage("Failed to duplicate project template.");
    }
  }

  async function deleteTemplate(template: ProjectTemplate) {
    setDeletingId(template.id);
    setActionMessage("");
    try {
      const response = await fetch(
        `/api/project-templates/${encodeURIComponent(template.id)}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionMessage(payload.error ?? "Failed to delete project template.");
        return;
      }
      setTemplates((current) =>
        current.filter((currentTemplate) => currentTemplate.id !== template.id),
      );
      setActionMessage("Project template deleted.");
    } catch {
      setActionMessage("Failed to delete project template.");
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
    <div className="max-w-[760px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
            Project templates
          </h1>
          <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
            Standardize project structures, milestones, and default settings
            that can be applied when creating projects.
          </p>
        </div>
        {templates.length > 0 ? (
          <button
            className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF]"
            type="button"
            onClick={openCreateDialog}
          >
            Create project template
          </button>
        ) : null}
      </div>

      {actionMessage ? (
        <p className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
          {actionMessage}
        </p>
      ) : null}

      <div className="mt-8">
        {templates.length === 0 ? (
          <EmptyState
            title="No project templates"
            description="Create your first project template to streamline project setup."
            action={{
              label: "Create project template",
              onClick: openCreateDialog,
            }}
          />
        ) : (
          <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            {templates.map((template) => (
              <article
                key={template.id}
                className="flex items-start justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                    {template.name}
                  </h2>
                  {template.description ? (
                    <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                      {template.description}
                    </p>
                  ) : (
                    <p className="mt-1 text-[13px] text-[var(--color-text-tertiary)]">
                      No description
                    </p>
                  )}
                  <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
                    {formatTemplateSummary(template)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    type="button"
                    onClick={() => openEditDialog(template)}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    type="button"
                    onClick={() => void duplicateTemplate(template)}
                  >
                    Duplicate
                  </button>
                  <button
                    className="rounded-md border border-red-900/50 px-2.5 py-1 text-[12px] text-red-400 hover:text-red-300 disabled:opacity-60"
                    type="button"
                    disabled={deletingId === template.id}
                    onClick={() => void deleteTemplate(template)}
                  >
                    {deletingId === template.id ? "Deleting..." : "Delete"}
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
            aria-labelledby="project-template-dialog-title"
            className="w-full max-w-[520px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 shadow-xl"
          >
            <h2
              id="project-template-dialog-title"
              className="text-[18px] font-semibold text-[var(--color-text-primary)]"
            >
              {editingTemplate
                ? "Edit project template"
                : "Create project template"}
            </h2>
            <div className="mt-5 space-y-4">
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Template name
                <input
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Description
                <textarea
                  className="mt-1 min-h-[72px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Default status
                  <select
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    {PROJECT_STATUSES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Default priority
                  <select
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                    value={priority}
                    onChange={(event) => setPriority(event.target.value)}
                  >
                    {PROJECT_PRIORITIES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {labels.length > 0 ? (
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Default labels
                  <select
                    multiple
                    aria-label="Default project labels"
                    className="mt-1 min-h-[80px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                    value={labelIds}
                    onChange={(event) =>
                      setLabelIds(
                        Array.from(
                          event.currentTarget.selectedOptions,
                          (option) => option.value,
                        ),
                      )
                    }
                  >
                    {labels.map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Milestones
                <textarea
                  aria-label="Template milestones"
                  placeholder="One milestone per line"
                  className="mt-1 min-h-[88px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                  value={milestones}
                  onChange={(event) => setMilestones(event.target.value)}
                />
              </label>
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
                onClick={saveTemplate}
              >
                {saving
                  ? "Saving..."
                  : editingTemplate
                    ? "Save changes"
                    : "Save template"}
              </button>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
