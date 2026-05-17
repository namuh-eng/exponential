"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

type IssueTemplate = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
};

export default function IssueTemplatesPage() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<IssueTemplate[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadTemplates() {
      try {
        const response = await fetch("/api/issue-templates");
        if (!response.ok) {
          throw new Error("Failed to load issue templates");
        }
        const payload = await response.json();
        if (!cancelled) {
          setTemplates(payload.templates ?? []);
        }
      } catch {
        if (!cancelled) {
          setLoadError("Unable to load issue templates.");
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

  async function saveTemplate() {
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();
    if (!trimmedName) {
      setError("Template name is required.");
      return;
    }

    if (!trimmedDescription) {
      setError("Issue description is required.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/issue-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: trimmedDescription,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Failed to create issue template.");
        return;
      }

      setTemplates((current) => [payload.template, ...current]);
      setDialogOpen(false);
      setName("");
      setDescription("");
    } catch {
      setError("Failed to create issue template.");
    } finally {
      setSaving(false);
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
    <div className="max-w-[720px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
            Issue templates
          </h1>
          <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
            Create and manage reusable templates for issue descriptions and
            properties.
          </p>
        </div>
        {templates.length > 0 ? (
          <button
            className="rounded-md bg-[#5E6AD2] px-4 py-[8px] text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF]"
            type="button"
            onClick={() => setDialogOpen(true)}
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
            action={{
              label: "Create template",
              onClick: () => setDialogOpen(true),
            }}
          />
        ) : (
          <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            {templates.map((template) => (
              <article key={template.id} className="p-4">
                <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                  {template.name}
                </h2>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-[var(--color-text-secondary)]">
                  {template.description}
                </p>
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
            className="w-full max-w-[420px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 shadow-xl"
          >
            <h2
              id="issue-template-dialog-title"
              className="text-[18px] font-semibold text-[var(--color-text-primary)]"
            >
              Create issue template
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
                Issue description
                <textarea
                  className="mt-1 min-h-[120px] w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[#5E6AD2]"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
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
                  setError("");
                  setName("");
                  setDescription("");
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
                {saving ? "Saving..." : "Save template"}
              </button>
            </div>
          </dialog>
        </div>
      ) : null}
    </div>
  );
}
