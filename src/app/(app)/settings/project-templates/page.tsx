"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useState } from "react";

type ProjectTemplateSettings = {
  defaults?: { status?: string; priority?: string };
  milestones?: { name: string; sortOrder?: number }[];
  starterIssues?: {
    title: string;
    description?: string;
    priority?: string;
    milestoneName?: string;
  }[];
  archived?: boolean;
};

type ProjectTemplate = {
  id: string;
  name: string;
  description: string;
  settings: ProjectTemplateSettings;
  createdAt: string;
};

const emptySettings: ProjectTemplateSettings = {
  defaults: { status: "planned", priority: "none" },
  milestones: [{ name: "Kickoff", sortOrder: 0 }],
  starterIssues: [
    {
      title: "Plan project kickoff",
      priority: "medium",
      milestoneName: "Kickoff",
    },
  ],
};

function linesToItems(value: string, key: "name" | "title") {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      [key]: line,
      sortOrder: index,
      priority: "none",
    }));
}

export default function ProjectTemplatesPage() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectTemplate | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("planned");
  const [priority, setPriority] = useState("none");
  const [milestones, setMilestones] = useState("Kickoff");
  const [starterIssues, setStarterIssues] = useState("Plan project kickoff");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadTemplates = useCallback(async function loadTemplates() {
    setLoading(true);
    try {
      const response = await fetch("/api/project-templates");
      if (!response.ok) throw new Error("Failed to load project templates");
      const payload = await response.json();
      setTemplates(payload.templates ?? []);
      setLoadError("");
    } catch {
      setLoadError("Unable to load project templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  function openEditor(template?: ProjectTemplate) {
    const settings = template?.settings ?? emptySettings;
    setEditing(template ?? null);
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setStatus(settings.defaults?.status ?? "planned");
    setPriority(settings.defaults?.priority ?? "none");
    setMilestones(
      (settings.milestones ?? []).map((item) => item.name).join("\n") ||
        "Kickoff",
    );
    setStarterIssues(
      (settings.starterIssues ?? []).map((item) => item.title).join("\n") ||
        "Plan project kickoff",
    );
    setError("");
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
    setNotice("");
    const settings = {
      defaults: { status, priority },
      milestones: linesToItems(milestones, "name"),
      starterIssues: linesToItems(starterIssues, "title"),
    };
    try {
      const response = await fetch(
        editing
          ? `/api/project-templates/${editing.id}`
          : "/api/project-templates",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, description, settings }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Failed to create project template.");
        return;
      }
      setTemplates((current) =>
        editing
          ? current.map((item) =>
              item.id === editing.id ? payload.template : item,
            )
          : [payload.template, ...current],
      );
      setDialogOpen(false);
      setEditing(null);
      setNotice(
        editing ? "Project template updated." : "Project template created.",
      );
    } catch {
      setError("Failed to create project template.");
    } finally {
      setSaving(false);
    }
  }

  async function duplicateTemplate(template: ProjectTemplate) {
    const response = await fetch("/api/project-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${template.name} copy`,
        description: template.description,
        settings: template.settings,
      }),
    });
    if (response.ok) {
      const payload = await response.json();
      setTemplates((current) => [payload.template, ...current]);
      setNotice("Project template duplicated.");
    } else {
      setNotice("Unable to duplicate project template.");
    }
  }

  async function deleteTemplate(template: ProjectTemplate) {
    const response = await fetch(`/api/project-templates/${template.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setTemplates((current) =>
        current.filter((item) => item.id !== template.id),
      );
      setNotice("Project template deleted.");
    } else {
      setNotice("Unable to delete project template.");
    }
  }

  async function archiveTemplate(template: ProjectTemplate) {
    const response = await fetch(`/api/project-templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !template.settings?.archived }),
    });
    if (response.ok) {
      const payload = await response.json();
      setTemplates((current) =>
        current.map((item) =>
          item.id === template.id ? payload.template : item,
        ),
      );
      setNotice(
        payload.template.settings.archived
          ? "Project template archived."
          : "Project template restored.",
      );
    } else {
      setNotice("Unable to update archive state.");
    }
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
            Project templates
          </h1>
          <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
            Standardize project structures, defaults, milestones, and starter
            issues with templates.
          </p>
          {notice ? (
            <p className="mt-3 text-[13px] text-green-400">{notice}</p>
          ) : null}
        </div>
        {templates.length > 0 ? (
          <button
            className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white"
            type="button"
            onClick={() => openEditor()}
          >
            Create project template
          </button>
        ) : null}
      </div>
      <div className="mt-8">
        {templates.length === 0 ? (
          <EmptyState
            title="No project templates"
            description="Create your first project template to streamline project setup."
            action={{
              label: "Create project template",
              onClick: () => openEditor(),
            }}
          />
        ) : (
          <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            {templates.map((template) => (
              <article key={template.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                      {template.name}
                      {template.settings?.archived ? " (archived)" : ""}
                    </h2>
                    <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                      {template.description || "No description"}
                    </p>
                    <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">
                      Default {template.settings?.defaults?.status ?? "planned"}{" "}
                      / {template.settings?.defaults?.priority ?? "none"} ·{" "}
                      {template.settings?.milestones?.length ?? 0} milestones ·{" "}
                      {template.settings?.starterIssues?.length ?? 0} starter
                      issues
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[12px]"
                      onClick={() => openEditor(template)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[12px]"
                      onClick={() => void duplicateTemplate(template)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[12px]"
                      onClick={() => void archiveTemplate(template)}
                    >
                      {template.settings?.archived ? "Restore" : "Archive"}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-red-500/40 px-2 py-1 text-[12px] text-red-300"
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
            aria-labelledby="project-template-dialog-title"
            className="w-full max-w-[520px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 shadow-xl"
          >
            <h2
              id="project-template-dialog-title"
              className="text-[18px] font-semibold text-[var(--color-text-primary)]"
            >
              {editing ? "Edit project template" : "Create project template"}
            </h2>
            <div className="mt-5 space-y-4">
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Template name
                <input
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Description
                <textarea
                  className="mt-1 min-h-[70px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Default status
                  <select
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2"
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <option value="planned">Planned</option>
                    <option value="started">Started</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                    <option value="canceled">Canceled</option>
                  </select>
                </label>
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Default priority
                  <select
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2"
                    value={priority}
                    onChange={(event) => setPriority(event.target.value)}
                  >
                    <option value="none">None</option>
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
              </div>
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Milestones (one per line)
                <textarea
                  className="mt-1 min-h-[70px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                  value={milestones}
                  onChange={(event) => setMilestones(event.target.value)}
                />
              </label>
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Starter issues (one per line)
                <textarea
                  className="mt-1 min-h-[70px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                  value={starterIssues}
                  onChange={(event) => setStarterIssues(event.target.value)}
                />
              </label>
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
                }}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white disabled:opacity-60"
                type="button"
                disabled={saving}
                onClick={saveTemplate}
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
