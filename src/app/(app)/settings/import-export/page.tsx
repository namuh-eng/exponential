"use client";

import { EmptyState } from "@/components/empty-state";
import { useEffect, useMemo, useState } from "react";

type Provider = "csv" | "github" | "jira";
type Job = {
  id: string;
  type: "import" | "export";
  provider?: Provider;
  status: "queued" | "processing" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  fileName?: string;
  message: string;
  rowCount?: number;
  importedCount?: number;
  errorCount?: number;
  downloadUrl?: string;
};

type TeamOption = { id: string; key: string; name: string };
type CsvPreview = {
  headers: string[];
  rowCount: number;
  validCount: number;
  errorCount: number;
  rows: Array<{
    rowNumber: number;
    values: Record<string, string>;
    errors: string[];
  }>;
};
type CsvMapping = {
  title: string;
  description?: string;
  priority?: string;
  teamKey?: string;
};
type ImportExportPayload = {
  teams: TeamOption[];
  imports: Job[];
  exports: Job[];
};

const providerCopy: Record<Provider, { name: string; description: string }> = {
  csv: {
    name: "CSV",
    description:
      "Upload a CSV file, map fields, preview row validation, and create issues.",
  },
  github: {
    name: "GitHub",
    description:
      "Connect GitHub, choose repositories, and prepare an issue import.",
  },
  jira: {
    name: "Jira",
    description:
      "Connect Jira, choose projects, and prepare a guided migration.",
  },
};

async function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read CSV file"));
    reader.readAsText(file);
  });
}

function JobList({ title, jobs }: { title: string; jobs: Job[] }) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
        {title}
      </h2>
      {jobs.length === 0 ? (
        <p className="mt-2 text-[13px] text-[var(--color-text-tertiary)]">
          No jobs have been started yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-[var(--color-text-primary)]">
                    {job.message}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                    {new Date(job.createdAt).toLocaleString()} · {job.status}
                    {typeof job.rowCount === "number"
                      ? ` · ${job.rowCount} rows`
                      : ""}
                  </p>
                </div>
                {job.downloadUrl ? (
                  <a
                    className="rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#4F5ABF]"
                    href={job.downloadUrl}
                  >
                    Download
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProviderPicker({
  onSelect,
}: { onSelect: (provider: Provider) => void }) {
  return (
    <div className="space-y-3" aria-label="Import providers">
      {(Object.keys(providerCopy) as Provider[]).map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => onSelect(provider)}
          aria-describedby={`${provider}-description`}
          className="flex w-full items-start justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <span>
            <span className="block text-[14px] font-medium text-[var(--color-text-primary)]">
              {providerCopy[provider].name}
            </span>
            <span
              id={`${provider}-description`}
              className="mt-1 block text-[13px] text-[var(--color-text-secondary)]"
            >
              {providerCopy[provider].description}
            </span>
          </span>
          <span className="shrink-0 rounded-full border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)]">
            Actionable
          </span>
        </button>
      ))}
    </div>
  );
}

function ImportModal({
  teams,
  onClose,
  onJobCreated,
}: {
  teams: TeamOption[];
  onClose: () => void;
  onJobCreated: (job: Job) => void;
}) {
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(
    null,
  );
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [mapping, setMapping] = useState<CsvMapping>({ title: "" });
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [defaultTeamId, setDefaultTeamId] = useState(teams[0]?.id ?? "");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const headerOptions = useMemo(() => preview?.headers ?? [], [preview]);

  const previewCsv = async (file: File) => {
    setError("");
    setMessage("");
    const text = await readFileAsText(file);
    const response = await fetch("/api/workspaces/current/import-export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "preview_csv",
        fileName: file.name,
        csv: text,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to preview CSV");
    setFileName(file.name);
    setCsv(text);
    setMapping(data.mapping);
    setPreview(data.preview);
  };

  const startCsvImport = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/workspaces/current/import-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "start_csv_import",
          fileName,
          csv,
          mapping,
          defaultTeamId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPreview(data.preview ?? preview);
        throw new Error(data.error ?? "Unable to start CSV import");
      }
      onJobCreated(data.import);
      setMessage(data.import.message);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to start CSV import",
      );
    } finally {
      setSaving(false);
    }
  };

  const prepareProvider = async (provider: "github" | "jira") => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/workspaces/current/import-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "prepare_provider", provider }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Unable to prepare provider import");
      onJobCreated(data.import);
      setMessage(
        `${providerCopy[provider].name} setup queued. Open integrations to connect the source.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to prepare provider import",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <dialog
        open
        aria-label="Start import"
        className="m-0 max-h-[90vh] w-full max-w-[640px] overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-[var(--color-text-primary)] shadow-2xl"
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
        ) : null}

        {selectedProvider === "csv" ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <button
              type="button"
              onClick={() => setSelectedProvider(null)}
              className="mb-4 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              ← Back to providers
            </button>
            <h3 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              CSV import
            </h3>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Upload a CSV, map columns, preview validation, and create issues
              in this workspace.
            </p>
            <label className="mt-4 block text-[13px] text-[var(--color-text-primary)]">
              CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void previewCsv(file).catch((err) =>
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Unable to preview CSV",
                      ),
                    );
                }}
                className="mt-2 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] file:mr-3 file:rounded-md file:border-0 file:bg-[#5E6AD2] file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-white"
              />
            </label>

            {preview ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    ["title", "description", "priority", "teamKey"] as const
                  ).map((field) => (
                    <label
                      key={field}
                      className="text-[13px] text-[var(--color-text-primary)]"
                    >
                      {field === "teamKey"
                        ? "Team key"
                        : field[0].toUpperCase() + field.slice(1)}{" "}
                      column
                      <select
                        value={mapping[field] ?? ""}
                        onChange={(event) =>
                          setMapping((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-[13px]"
                      >
                        <option value="">None</option>
                        {headerOptions.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <label className="block text-[13px] text-[var(--color-text-primary)]">
                  Default team
                  <select
                    value={defaultTeamId}
                    onChange={(event) => setDefaultTeamId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] px-2 py-1.5 text-[13px]"
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name} ({team.key})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-3 text-[13px]">
                  <p className="font-medium text-[var(--color-text-primary)]">
                    Preview: {preview.validCount} valid, {preview.errorCount}{" "}
                    with errors, {preview.rowCount} total
                  </p>
                  <ul className="mt-2 max-h-28 space-y-1 overflow-auto text-[12px] text-[var(--color-text-secondary)]">
                    {preview.rows.slice(0, 5).map((row) => (
                      <li key={row.rowNumber}>
                        Row {row.rowNumber}:{" "}
                        {row.errors.length
                          ? row.errors.join(", ")
                          : row.values[mapping.title] || "Ready"}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

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
                onClick={onClose}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={startCsvImport}
                disabled={!preview || saving}
                className="rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Start import job
              </button>
            </div>
          </div>
        ) : null}

        {selectedProvider === "github" || selectedProvider === "jira" ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <button
              type="button"
              onClick={() => setSelectedProvider(null)}
              className="mb-4 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              ← Back to providers
            </button>
            <h3 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              {providerCopy[selectedProvider].name} import setup
            </h3>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Create a reload-safe setup record, then connect the integration to
              select source projects and mappings.
            </p>
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
              <a
                href="/settings/integrations"
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
              >
                Open integrations
              </a>
              <button
                type="button"
                disabled={saving}
                onClick={() => prepareProvider(selectedProvider)}
                className="rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:opacity-60"
              >
                Save setup
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}

export default function ImportExportPage() {
  const [loading, setLoading] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [imports, setImports] = useState<Job[]>([]);
  const [exports, setExports] = useState<Job[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspaces/current/import-export")
      .then(async (response) => {
        const data = (await response.json()) as ImportExportPayload & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            data.error ?? "Unable to load import/export settings",
          );
        if (!cancelled) {
          setTeams(data.teams);
          setImports(data.imports);
          setExports(data.exports);
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load import/export settings",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestExport = async () => {
    setError("");
    setStatusMessage("Preparing workspace export...");
    try {
      const response = await fetch("/api/workspaces/current/import-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request_export" }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Unable to export workspace data");
      setExports((current) => [
        data.export,
        ...current.filter((job) => job.id !== data.export.id),
      ]);
      setStatusMessage(data.export.message);
    } catch (err) {
      setStatusMessage("");
      setError(
        err instanceof Error ? err.message : "Unable to export workspace data",
      );
    }
  };

  if (loading)
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">
        Loading import/export settings...
      </div>
    );

  return (
    <div className="max-w-[760px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Import & export
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Move workspace data in and out with admin-controlled CSV import jobs,
        provider setup records, and downloadable workspace exports.
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-[13px] text-red-300"
        >
          {error}
        </p>
      ) : null}
      {statusMessage ? (
        <output className="mt-4 block rounded-md border border-green-500/40 bg-green-500/10 p-3 text-[13px] text-green-300">
          {statusMessage}
        </output>
      ) : null}

      <div className="mt-8">
        <EmptyState
          title="Data management"
          description="Start a guided CSV import, prepare a GitHub/Jira importer, or request a JSON workspace export that can be downloaded from history."
          action={{
            label: "Start import",
            onClick: () => setShowImportModal(true),
          }}
        />
      </div>

      <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              Export workspace data
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Generate a downloadable JSON bundle with workspace, teams,
              members, projects, labels, issues, and comments.
            </p>
          </div>
          <button
            type="button"
            onClick={requestExport}
            className="rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF]"
          >
            Request export
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        <JobList title="Export history" jobs={exports} />
        <JobList title="Import history" jobs={imports} />
      </div>

      {showImportModal ? (
        <ImportModal
          teams={teams}
          onClose={() => setShowImportModal(false)}
          onJobCreated={(job) =>
            setImports((current) => [
              job,
              ...current.filter((candidate) => candidate.id !== job.id),
            ])
          }
        />
      ) : null}
    </div>
  );
}
