"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useState } from "react";

type ImportProvider = "csv" | "github" | "jira";

const providers: Array<{
  id: ImportProvider;
  name: string;
  description: string;
  status: "available" | "comingSoon";
}> = [
  {
    id: "csv",
    name: "CSV",
    description:
      "Upload a CSV file of issues and map its columns before importing.",
    status: "available",
  },
  {
    id: "github",
    name: "GitHub",
    description:
      "Import issues from GitHub repositories after connecting an integration.",
    status: "comingSoon",
  },
  {
    id: "jira",
    name: "Jira",
    description:
      "Bring over Jira projects, issues, and labels with a guided migration.",
    status: "comingSoon",
  },
];

function ProviderPicker({
  onSelect,
}: {
  onSelect: (provider: ImportProvider) => void;
}) {
  return (
    <div className="space-y-3" aria-label="Import providers">
      {providers.map((provider) => {
        const unavailable = provider.status === "comingSoon";

        return (
          <button
            key={provider.id}
            type="button"
            onClick={() => onSelect(provider.id)}
            disabled={unavailable}
            aria-describedby={`${provider.id}-description`}
            className="flex w-full items-start justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:bg-[var(--color-surface)]"
          >
            <span>
              <span className="block text-[14px] font-medium text-[var(--color-text-primary)]">
                {provider.name}
              </span>
              <span
                id={`${provider.id}-description`}
                className="mt-1 block text-[13px] text-[var(--color-text-secondary)]"
              >
                {provider.description}
              </span>
            </span>
            <span className="shrink-0 rounded-full border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)]">
              {unavailable ? "Coming soon" : "Available"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const [selectedProvider, setSelectedProvider] =
    useState<ImportProvider | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const submitCsvImport = () => {
    setMessage("");

    if (!selectedFileName) {
      setError("Choose a CSV file before continuing with the import.");
      return;
    }

    if (!selectedFileName.toLowerCase().endsWith(".csv")) {
      setError("The selected file must use the .csv extension.");
      return;
    }

    setError("");
    setMessage(
      "CSV import setup is ready. Column mapping and job processing are coming next.",
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <dialog
        open
        aria-label="Start import"
        className="m-0 w-full max-w-[560px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-[var(--color-text-primary)] shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
              Start import
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Choose where your workspace data is coming from.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close import dialog"
            className="rounded-md px-2 py-1 text-[18px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            ×
          </button>
        </div>

        {selectedProvider === null ? (
          <ProviderPicker onSelect={setSelectedProvider} />
        ) : (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <button
              type="button"
              onClick={() => {
                setSelectedProvider(null);
                setError("");
                setMessage("");
              }}
              className="mb-4 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              ← Back to providers
            </button>

            <h3 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              CSV import
            </h3>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Upload a CSV file to validate the first import step. No data is
              imported until the mapping step is available.
            </p>

            <label className="mt-4 block text-[13px] text-[var(--color-text-primary)]">
              CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  setSelectedFileName(event.target.files?.[0]?.name ?? "");
                  setError("");
                  setMessage("");
                }}
                className="mt-2 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] file:mr-3 file:rounded-md file:border-0 file:bg-[#5E6AD2] file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-white"
              />
            </label>

            {error ? (
              <p role="alert" className="mt-3 text-[13px] text-red-400">
                {error}
              </p>
            ) : null}
            {message ? (
              <output className="mt-3 block text-[13px] text-green-400">
                {message}
              </output>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSelectedProvider(null)}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitCsvImport}
                className="rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF]"
              >
                Continue
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

export default function ImportExportPage() {
  const [loading, setLoading] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">Loading...</div>
    );
  }

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Import & export
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Migrate data from other tools. Workspace exports are not available yet.
      </p>

      <div className="mt-8">
        <EmptyState
          title="Data Management"
          description="Start a CSV import now, or review upcoming GitHub and Jira import options. Export support is coming soon."
          action={{
            label: "Start import",
            onClick: () => setShowImportModal(true),
          }}
        />
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              Export workspace data
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Exports are not implemented in this clone yet. We will show a
              download workflow here when it is ready.
            </p>
          </div>
          <span className="rounded-full border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)]">
            Coming soon
          </span>
        </div>
      </div>

      {showImportModal ? (
        <ImportModal onClose={() => setShowImportModal(false)} />
      ) : null}
    </div>
  );
}
