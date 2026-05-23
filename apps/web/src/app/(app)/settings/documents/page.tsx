"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

type DocumentTemplate = {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type DocumentFolder = {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

type DocumentsSettings = {
  defaultVisibility: "workspace" | "private";
  autoLinkProjectDocuments: boolean;
  templates: DocumentTemplate[];
  folders: DocumentFolder[];
};

type DialogMode =
  | { type: "template"; item?: DocumentTemplate }
  | { type: "folder"; item?: DocumentFolder }
  | null;

const folderColors = [
  "gray",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
];

const blankSettings: DocumentsSettings = {
  defaultVisibility: "workspace",
  autoLinkProjectDocuments: true,
  templates: [],
  folders: [],
};

export default function DocumentsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [settings, setSettings] = useState<DocumentsSettings>(blankSettings);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    content: "",
    color: "gray",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadDocuments() {
      try {
        const response = await fetch("/api/document-settings");
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "Failed to load");
        if (!cancelled) {
          setSettings((current) => ({
            ...current,
            templates: payload.documents?.templates ?? [],
            folders: payload.documents?.folders ?? [],
            defaultVisibility:
              payload.documents?.defaultVisibility ?? current.defaultVisibility,
            autoLinkProjectDocuments:
              payload.documents?.autoLinkProjectDocuments ??
              current.autoLinkProjectDocuments,
          }));
        }
      } catch {
        if (!cancelled) setLoadError("Unable to load document settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDocuments();
    return () => {
      cancelled = true;
    };
  }, []);

  async function updateSettings(next: Partial<DocumentsSettings>) {
    setSaving(true);
    setError("");
    setNotice("");

    const response = await fetch("/api/document-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      documents?: Partial<DocumentsSettings>;
      error?: string;
    };
    setSaving(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to save document settings");
      return;
    }

    if (payload.documents) {
      setSettings((current) => ({ ...current, ...payload.documents }));
    }
    setNotice("Document settings saved.");
  }

  function openTemplate(item?: DocumentTemplate) {
    setDialog({ type: "template", item });
    setForm({
      name: item?.name ?? "",
      description: item?.description ?? "",
      content: item?.content ?? "",
      color: "gray",
    });
    setError("");
    setNotice("");
  }

  function openFolder(item?: DocumentFolder) {
    setDialog({ type: "folder", item });
    setForm({
      name: item?.name ?? "",
      description: item?.description ?? "",
      content: "",
      color: item?.color ?? "gray",
    });
    setError("");
    setNotice("");
  }

  function closeDialog() {
    setDialog(null);
    setError("");
    setSaving(false);
  }

  async function saveItem() {
    if (!dialog) return;
    const name = form.name.trim();
    const description = form.description.trim();
    const content = form.content.trim();
    if (!name)
      return setError(
        dialog.type === "template"
          ? "Template name is required."
          : "Folder name is required.",
      );
    if (dialog.type === "template" && !content)
      return setError("Template content is required.");

    setSaving(true);
    setError("");
    const editing = Boolean(dialog.item);
    const endpoint =
      dialog.type === "template"
        ? editing
          ? `/api/document-templates/${dialog.item?.id}`
          : "/api/document-templates"
        : editing
          ? `/api/document-folders/${dialog.item?.id}`
          : "/api/document-folders";
    const body =
      dialog.type === "template"
        ? { name, description, content }
        : { name, description, color: form.color };

    try {
      const response = await fetch(endpoint, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return setError(
          payload.error ??
            (dialog.type === "template"
              ? "Failed to save document template."
              : "Failed to save document folder."),
        );
      }
      if (dialog.type === "template") {
        setSettings((current) => ({
          ...current,
          templates: editing
            ? current.templates.map((item) =>
                item.id === payload.template.id ? payload.template : item,
              )
            : [payload.template, ...current.templates],
        }));
        setNotice(editing ? "Template updated." : "Template created.");
      } else {
        setSettings((current) => ({
          ...current,
          folders: editing
            ? current.folders.map((item) =>
                item.id === payload.folder.id ? payload.folder : item,
              )
            : [payload.folder, ...current.folders],
        }));
        setNotice(editing ? "Folder updated." : "Folder created.");
      }
      closeDialog();
    } catch {
      setError(
        dialog.type === "template"
          ? "Failed to save document template."
          : "Failed to save document folder.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(template: DocumentTemplate) {
    const response = await fetch(`/api/document-templates/${template.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setSettings((current) => ({
        ...current,
        templates: current.templates.filter((item) => item.id !== template.id),
      }));
      setNotice("Template deleted.");
    }
  }

  async function deleteFolder(folder: DocumentFolder) {
    const response = await fetch(`/api/document-folders/${folder.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setSettings((current) => ({
        ...current,
        folders: current.folders.filter((item) => item.id !== folder.id),
      }));
      setNotice("Folder deleted.");
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
    <div className="max-w-[860px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
            Documents
          </h1>
          <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
            Configure document templates and workspace-wide document settings.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-md border border-[var(--color-border)] px-4 py-[8px] text-[13px] font-medium text-[var(--color-text-primary)]"
            type="button"
            onClick={() => openFolder()}
          >
            New folder
          </button>
          <button
            className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white"
            type="button"
            onClick={() => openTemplate()}
          >
            New template
          </button>
        </div>
      </div>

      {notice ? (
        <p className="mt-4 text-[13px] text-green-400">{notice}</p>
      ) : null}
      {error ? (
        <div
          className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-500"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <section className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
          Workspace defaults
        </h2>
        <label
          className="mt-5 block text-[13px] text-[var(--color-text-primary)]"
          htmlFor="document-visibility"
        >
          Default document visibility
        </label>
        <select
          id="document-visibility"
          value={settings.defaultVisibility}
          disabled={saving}
          onChange={(event) =>
            void updateSettings({
              defaultVisibility: event.target
                .value as DocumentsSettings["defaultVisibility"],
            })
          }
          className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
        >
          <option value="workspace">Visible to workspace</option>
          <option value="private">Private by default</option>
        </select>

        <label className="mt-5 flex items-start gap-3 text-[13px] text-[var(--color-text-primary)]">
          <input
            type="checkbox"
            checked={settings.autoLinkProjectDocuments}
            disabled={saving}
            onChange={(event) =>
              void updateSettings({
                autoLinkProjectDocuments: event.target.checked,
              })
            }
            className="mt-1"
          />
          <span>
            Auto-link project documents
            <span className="block text-[12px] text-[var(--color-text-tertiary)]">
              New project documents appear in the project resources list
              automatically.
            </span>
          </span>
        </label>
      </section>

      <section className="mt-8" aria-labelledby="document-templates-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2
              id="document-templates-heading"
              className="text-[16px] font-semibold text-[var(--color-text-primary)]"
            >
              Document templates
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Reusable starting points for workspace docs, specs, and processes.
            </p>
          </div>
        </div>
        {settings.templates.length === 0 ? (
          <EmptyState
            title="No document templates"
            description="Create your first template to standardize workspace documentation."
            action={{ label: "New template", onClick: () => openTemplate() }}
          />
        ) : (
          <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            {settings.templates.map((template) => (
              <article key={template.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                      {template.name}
                    </h3>
                    {template.description ? (
                      <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                        {template.description}
                      </p>
                    ) : null}
                    <p className="mt-2 whitespace-pre-wrap text-[12px] text-[var(--color-text-tertiary)]">
                      {template.content}
                    </p>
                  </div>
                  <div className="flex gap-2 text-[12px]">
                    <button
                      type="button"
                      onClick={() => openTemplate(template)}
                    >
                      Edit
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
      </section>

      <section className="mt-8" aria-labelledby="document-folders-heading">
        <h2
          id="document-folders-heading"
          className="text-[16px] font-semibold text-[var(--color-text-primary)]"
        >
          Common folders
        </h2>
        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
          Suggested folder categories for keeping shared documents organized.
        </p>
        <div className="mt-3">
          {settings.folders.length === 0 ? (
            <EmptyState
              title="No common folders"
              description="Add common folders for handbooks, specs, and operating docs."
              action={{ label: "New folder", onClick: () => openFolder() }}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {settings.folders.map((folder) => (
                <article
                  key={folder.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[15px] font-medium text-[var(--color-text-primary)]">
                        {folder.name}
                      </p>
                      <p className="mt-1 text-[12px] capitalize text-[var(--color-text-tertiary)]">
                        {folder.color} folder
                      </p>
                      {folder.description ? (
                        <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
                          {folder.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex gap-2 text-[12px]">
                      <button type="button" onClick={() => openFolder(folder)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-red-400"
                        onClick={() => void deleteFolder(folder)}
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
      </section>

      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <dialog
            open
            aria-labelledby="document-settings-dialog-title"
            className="w-full max-w-[560px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 shadow-xl"
          >
            <h2
              id="document-settings-dialog-title"
              className="text-[18px] font-semibold text-[var(--color-text-primary)]"
            >
              {dialog.type === "template"
                ? dialog.item
                  ? "Edit document template"
                  : "Create document template"
                : dialog.item
                  ? "Edit common folder"
                  : "Create common folder"}
            </h2>
            <div className="mt-5 grid gap-4">
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                {dialog.type === "template" ? "Template name" : "Folder name"}
                <input
                  aria-label={
                    dialog.type === "template" ? "Template name" : "Folder name"
                  }
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </label>
              <label className="block text-[13px] text-[var(--color-text-secondary)]">
                Description
                <input
                  aria-label="Description"
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                  value={form.description}
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </label>
              {dialog.type === "template" ? (
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Template content
                  <textarea
                    aria-label="Template content"
                    className="mt-1 min-h-[140px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                    value={form.content}
                    onChange={(event) =>
                      setForm({ ...form, content: event.target.value })
                    }
                  />
                </label>
              ) : (
                <label className="block text-[13px] text-[var(--color-text-secondary)]">
                  Folder color
                  <select
                    aria-label="Folder color"
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px]"
                    value={form.color}
                    onChange={(event) =>
                      setForm({ ...form, color: event.target.value })
                    }
                  >
                    {folderColors.map((color) => (
                      <option key={color} value={color}>
                        {color}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {error ? (
                <p className="text-[13px] text-red-400">{error}</p>
              ) : null}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-md px-4 py-[8px] text-[13px]"
                type="button"
                onClick={closeDialog}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white disabled:opacity-60"
                type="button"
                disabled={saving}
                onClick={() => void saveItem()}
              >
                {saving
                  ? "Saving..."
                  : dialog.type === "template"
                    ? "Save template"
                    : "Save folder"}
              </button>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
