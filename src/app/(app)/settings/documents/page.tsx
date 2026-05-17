"use client";

import { EmptyState } from "@/components/empty-state";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

type DocumentTemplate = {
  id: string;
  name: string;
  description: string;
};

type DocumentsSettings = {
  defaultVisibility: "workspace" | "private";
  autoLinkProjectDocuments: boolean;
  templates: DocumentTemplate[];
};

const blankSettings: DocumentsSettings = {
  defaultVisibility: "workspace",
  autoLinkProjectDocuments: true,
  templates: [],
};

export default function DocumentsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [settings, setSettings] = useState<DocumentsSettings>(blankSettings);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const response = await fetch("/api/workspaces/current/documents");
        if (!response.ok) throw new Error("Unable to load document settings");
        const payload = (await response.json()) as {
          documents: DocumentsSettings;
        };
        if (!cancelled) setSettings(payload.documents);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load document settings",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  async function updateSettings(next: Partial<DocumentsSettings>) {
    setSaving(true);
    setError(null);
    setStatus(null);

    const response = await fetch("/api/workspaces/current/documents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      documents?: DocumentsSettings;
      error?: string;
    };
    setSaving(false);

    if (!response.ok || !payload.documents) {
      setError(payload.error ?? "Unable to save document settings");
      return;
    }

    setSettings(payload.documents);
    setStatus("Document settings saved.");
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = templateName.trim();
    if (!name) {
      setError("Template name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);
    const response = await fetch("/api/workspaces/current/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: templateDescription }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      documents?: DocumentsSettings;
      error?: string;
    };
    setSaving(false);

    if (!response.ok || !payload.documents) {
      setError(payload.error ?? "Unable to create document template");
      return;
    }

    setSettings(payload.documents);
    setTemplateName("");
    setTemplateDescription("");
    setStatus("Document template created.");
  }

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  return (
    <div className="max-w-[760px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Documents
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Configure document templates and workspace-wide document settings.
      </p>

      {error ? (
        <div
          className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-500"
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {status ? (
        <output className="mt-4 block rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-[13px] text-green-600">
          {status}
        </output>
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

      <section className="mt-8">
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
          Document templates
        </h2>
        <form
          className="mt-4 grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4"
          onSubmit={createTemplate}
        >
          <input
            aria-label="Template name"
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder="Template name"
            className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
          />
          <textarea
            aria-label="Template description"
            value={templateDescription}
            onChange={(event) => setTemplateDescription(event.target.value)}
            placeholder="Description or usage guidance"
            rows={3}
            className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-[13px] text-[var(--color-text-primary)]"
          />
          <button
            type="submit"
            disabled={saving}
            className="justify-self-start rounded-md bg-[#5E6AD2] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-60"
          >
            Create document template
          </button>
        </form>

        <div className="mt-4">
          {settings.templates.length === 0 ? (
            <EmptyState
              title="No document templates"
              description="Create templates for specs, decisions, retrospectives, and other repeatable workspace documents."
            />
          ) : (
            <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
              {settings.templates.map((template) => (
                <article key={template.id} className="p-4">
                  <h3 className="text-[14px] font-medium text-[var(--color-text-primary)]">
                    {template.name}
                  </h3>
                  <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                    {template.description || "No description"}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
