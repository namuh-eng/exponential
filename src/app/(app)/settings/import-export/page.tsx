"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useMemo, useState } from "react";

type ExportJob = {
  id: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  downloadUrl?: string;
  counts?: Record<string, number>;
};
type ImportJob = {
  id: string;
  status: string;
  createdAt: string;
  provider: string;
  fileName?: string;
  importedCount?: number;
  errorCount?: number;
  errors?: Array<{ row: number; message: string }>;
  message?: string;
};
type TeamOption = {
  id: string;
  name: string;
  key: string;
  states: Array<{ id: string; name: string; category: string }>;
};
type PreviewRow = {
  row: number;
  title: string;
  description: string;
  priority: string;
  status: string;
  errors: string[];
};

type Provider = "csv" | "github" | "jira";
type CsvStep = "upload" | "map" | "preview" | "complete";

const REQUIRED_COLUMNS = ["title"];
const OPTIONAL_COLUMNS = ["description", "status", "priority"];

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

function guessMapping(headers: string[]) {
  const find = (names: string[]) =>
    headers.find((h) => names.includes(h.trim().toLowerCase())) ?? "";
  return {
    title: find(["title", "summary", "name"]),
    description: find(["description", "body", "details"]),
    status: find(["status", "state"]),
    priority: find(["priority"]),
  };
}

function JobList({ title, jobs }: { title: string; jobs: ImportJob[] }) {
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
                    {job.message ??
                      `${job.provider} import — ${job.fileName ?? job.id.slice(0, 8)}`}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                    {new Date(job.createdAt).toLocaleString()} · {job.status}
                    {typeof job.importedCount === "number"
                      ? ` · ${job.importedCount} imported`
                      : ""}
                    {typeof job.errorCount === "number" && job.errorCount > 0
                      ? ` · ${job.errorCount} errors`
                      : ""}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ImportModal({
  onClose,
  onComplete,
}: { onClose: () => void; onComplete: () => void }) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [step, setStep] = useState<CsvStep>("upload");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState({
    title: "",
    description: "",
    status: "",
    priority: "",
  });
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamId, setTeamId] = useState("");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/workspaces/imports")
      .then((r) => r.json())
      .then((data) => {
        setTeams(data.teams ?? []);
        setTeamId(data.teams?.[0]?.id ?? "");
      })
      .catch(() => setError("Unable to load workspace import settings."));
  }, []);

  const selectedTeam = teams.find((team) => team.id === teamId);

  const uploadCsv = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a .csv file.");
      return;
    }
    const text = await file.text();
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    const parsedHeaders = firstLine
      .split(",")
      .map((h) => h.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    setFileName(file.name);
    setCsvText(text);
    setHeaders(parsedHeaders);
    setMapping(guessMapping(parsedHeaders));
    setStep("map");
  };

  const validate = async () => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/workspaces/imports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: csvText, mapping, teamId }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "CSV validation failed.");
      return;
    }
    setPreview(data.preview ?? []);
    setStep("preview");
  };

  const startImport = async () => {
    setBusy(true);
    setError("");
    const res = await fetch("/api/workspaces/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: csvText, mapping, teamId, fileName }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Import failed.");
      setPreview(data.preview ?? preview);
      return;
    }
    setStep("complete");
    onComplete();
  };

  const prepareProvider = async (p: "github" | "jira") => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workspaces/current/import-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "prepare_provider", provider: p }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Unable to prepare provider import");
      setMessage(
        `${providerCopy[p].name} setup queued. Open integrations to connect the source.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to prepare provider import",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <dialog
        open
        aria-label="Start import"
        className="m-0 max-h-[90vh] w-full max-w-[680px] overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-[var(--color-text-primary)] shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold">Start import</h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Import issues with validation, mapping, and reload-safe job
              history.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close import dialog"
            className="rounded-md px-2 py-1 text-[18px]"
          >
            ×
          </button>
        </div>

        {provider === null ? (
          <div className="space-y-3" aria-label="Import providers">
            {(Object.keys(providerCopy) as Provider[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                aria-describedby={`${p}-description`}
                className="flex w-full items-start justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                <span>
                  <span className="block text-[14px] font-medium text-[var(--color-text-primary)]">
                    {providerCopy[p].name}
                  </span>
                  <span
                    id={`${p}-description`}
                    className="mt-1 block text-[13px] text-[var(--color-text-secondary)]"
                  >
                    {providerCopy[p].description}
                  </span>
                </span>
                <span className="shrink-0 rounded-full border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)]">
                  {p === "csv" ? "Actionable" : "Connect integration"}
                </span>
              </button>
            ))}
          </div>
        ) : provider === "github" || provider === "jira" ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <button
              type="button"
              onClick={() => setProvider(null)}
              className="mb-4 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              ← Back to providers
            </button>
            <h3 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              {providerCopy[provider].name} import setup
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
                disabled={busy}
                onClick={() => prepareProvider(provider)}
                className="rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:opacity-60"
              >
                Save setup
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <button
              type="button"
              onClick={() => {
                setProvider(null);
                setStep("upload");
              }}
              className="mb-4 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              ← Back to providers
            </button>
            {step === "upload" && (
              <>
                <h3 className="font-medium">Upload CSV</h3>
                <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                  Required column: {REQUIRED_COLUMNS.join(", ")}. Optional:{" "}
                  {OPTIONAL_COLUMNS.join(", ")}.
                </p>
                <input
                  aria-label="CSV file"
                  className="mt-4 block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-[#5E6AD2] file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-white"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => void uploadCsv(e.target.files?.[0])}
                />
              </>
            )}
            {step === "map" && (
              <>
                <h3 className="font-medium">Map CSV columns</h3>
                <label className="mt-3 block text-[13px]">
                  Target team
                  <select
                    className="mt-1 block w-full rounded-md bg-[var(--color-panel)] p-2"
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                  >
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.key})
                      </option>
                    ))}
                  </select>
                </label>
                {Object.keys(mapping).map((field) => (
                  <label
                    key={field}
                    className="mt-3 block text-[13px] capitalize"
                  >
                    {field}
                    {field === "title" ? " *" : ""}
                    <select
                      className="mt-1 block w-full rounded-md bg-[var(--color-panel)] p-2"
                      value={mapping[field as keyof typeof mapping]}
                      onChange={(e) =>
                        setMapping({ ...mapping, [field]: e.target.value })
                      }
                    >
                      <option value="">Do not import</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <button
                  type="button"
                  disabled={busy}
                  onClick={validate}
                  className="mt-4 rounded-md bg-[#5E6AD2] px-3 py-1.5 text-white"
                >
                  Preview validation
                </button>
              </>
            )}
            {step === "preview" && (
              <>
                <h3 className="font-medium">Preview validation</h3>
                <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                  {preview.filter((r) => r.errors.length === 0).length} valid
                  rows, {preview.filter((r) => r.errors.length > 0).length} rows
                  with errors.
                </p>
                <div className="mt-3 max-h-64 overflow-auto rounded border border-[var(--color-border)]">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Title</th>
                        <th>Status</th>
                        <th>Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r) => (
                        <tr key={r.row}>
                          <td>{r.row}</td>
                          <td>{r.title}</td>
                          <td>{r.status || selectedTeam?.states[0]?.name}</td>
                          <td
                            className={
                              r.errors.length
                                ? "text-red-400"
                                : "text-green-400"
                            }
                          >
                            {r.errors.join("; ") || "Ready"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  disabled={busy || preview.some((r) => r.errors.length > 0)}
                  onClick={startImport}
                  className="mt-4 rounded-md bg-[#5E6AD2] px-3 py-1.5 text-white disabled:opacity-50"
                >
                  Start import job
                </button>
              </>
            )}
            {step === "complete" && (
              <>
                <h3 className="font-medium text-green-400">Import complete</h3>
                <p className="mt-2 text-[13px]">
                  Issues were created and the import job was saved to history.
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="mt-3 text-[13px] text-red-400">
                {error}
              </p>
            )}
          </div>
        )}
      </dialog>
    </div>
  );
}

export default function ImportExportPage() {
  const [showImportModal, setShowImportModal] = useState(false);
  const [exports, setExports] = useState<ExportJob[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const latestExport = useMemo(() => exports[0], [exports]);

  const load = useCallback(async () => {
    try {
      const [e, i] = await Promise.all([
        fetch("/api/workspaces/exports").then((r) => r.json()),
        fetch("/api/workspaces/imports").then((r) => r.json()),
      ]);
      setExports(e.exports ?? []);
      setImports(i.imports ?? []);
    } catch {
      setError("Unable to load import/export history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const requestExport = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/workspaces/exports", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Export failed.");
        return;
      }
      setExports(data.exports ?? [data.export]);
      setMessage("Workspace export is ready to download.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-[var(--color-text-tertiary)]">
        Loading import/export settings...
      </div>
    );
  }

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
      {message ? (
        <output className="mt-4 block rounded-md border border-green-500/40 bg-green-500/10 p-3 text-[13px] text-green-300">
          {message}
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
            <h2 className="text-[15px] font-medium">Export workspace data</h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Generate a downloadable JSON bundle with workspace, teams,
              members, projects, labels, issues, and comments.
            </p>
            {latestExport ? (
              <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">
                Latest export: {latestExport.status} ·{" "}
                {new Date(latestExport.createdAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={requestExport}
              className="rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:opacity-50"
            >
              Request export
            </button>
            {latestExport?.downloadUrl ? (
              <a
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px]"
                href={latestExport.downloadUrl}
              >
                Download
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        <JobList title="Import history" jobs={imports} />
      </div>

      {showImportModal ? (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onComplete={load}
        />
      ) : null}
    </div>
  );
}
