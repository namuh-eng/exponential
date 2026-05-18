"use client";

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

type CsvStep = "upload" | "map" | "preview" | "complete";

const REQUIRED_COLUMNS = ["title"];
const OPTIONAL_COLUMNS = ["description", "status", "priority"];

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

function ImportModal({
  onClose,
  onComplete,
}: { onClose: () => void; onComplete: () => void }) {
  const [provider, setProvider] = useState<"csv" | "github" | "jira" | null>(
    null,
  );
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <dialog
        open
        aria-label="Start import"
        className="m-0 w-full max-w-[680px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5 text-[var(--color-text-primary)] shadow-2xl"
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
        {!provider ? (
          <div className="space-y-3" aria-label="Import providers">
            <button
              type="button"
              onClick={() => setProvider("csv")}
              className="flex w-full items-start justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left"
            >
              <span>
                <b>CSV</b>
                <span className="mt-1 block text-[13px] text-[var(--color-text-secondary)]">
                  Upload, map columns, preview validation, then create issues.
                </span>
              </span>
              <span>Available</span>
            </button>
            {(["github", "jira"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className="flex w-full items-start justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left"
              >
                <span>
                  <b>{p === "github" ? "GitHub" : "Jira"}</b>
                  <span className="mt-1 block text-[13px] text-[var(--color-text-secondary)]">
                    Open integration setup to connect an account before
                    importing.
                  </span>
                </span>
                <span>Connect integration</span>
              </button>
            ))}
          </div>
        ) : provider !== "csv" ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h3 className="font-medium">
              Connect {provider === "github" ? "GitHub" : "Jira"}
            </h3>
            <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
              This importer starts with integration authorization. Connect the
              provider from workspace integrations, then return here to select
              repositories/projects and mappings.
            </p>
            <a
              className="mt-4 inline-flex rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[13px] font-medium text-white"
              href="/settings/integrations"
            >
              Open integration setup
            </a>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            {step === "upload" && (
              <>
                <h3 className="font-medium">Upload CSV</h3>
                <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                  Required column: {REQUIRED_COLUMNS.join(", ")}. Optional:{" "}
                  {OPTIONAL_COLUMNS.join(", ")}.
                </p>
                <input
                  aria-label="CSV file"
                  className="mt-4 block w-full"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => uploadCsv(e.target.files?.[0])}
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
                  disabled={busy || preview.some((r) => r.errors.length)}
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
  const [busy, setBusy] = useState(false);
  const latestExport = useMemo(() => exports[0], [exports]);
  const load = useCallback(async () => {
    const [e, i] = await Promise.all([
      fetch("/api/workspaces/exports").then((r) => r.json()),
      fetch("/api/workspaces/imports").then((r) => r.json()),
    ]);
    setExports(e.exports ?? []);
    setImports(i.imports ?? []);
  }, []);
  useEffect(() => {
    load().catch(() => setMessage("Unable to load import/export history."));
  }, [load]);
  const requestExport = async () => {
    setBusy(true);
    setMessage("");
    const res = await fetch("/api/workspaces/exports", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error ?? "Export failed.");
      return;
    }
    setExports(data.exports ?? [data.export]);
    setMessage("Workspace export is ready to download.");
  };
  return (
    <div className="max-w-[760px]">
      <h1 className="text-[28px] font-semibold text-[var(--color-text-primary)]">
        Import & export
      </h1>
      <p className="mt-3 text-[14px] text-[var(--color-text-secondary)]">
        Move workspace data with guided CSV imports and downloadable workspace
        exports.
      </p>
      <div className="mt-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-medium">Import data</h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Upload CSV issues, map fields, preview row-level validation, and
              start the import.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[13px] font-medium text-white"
          >
            Start import
          </button>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-medium">Export workspace data</h2>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Create a JSON archive of workspace, teams, projects, labels,
              members, and issues.
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
              className="rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
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
      {message && (
        <output className="mt-3 block text-[13px] text-green-400">
          {message}
        </output>
      )}
      <section className="mt-6">
        <h2 className="text-[15px] font-medium">Job history</h2>
        <ul className="mt-2 space-y-2 text-[13px] text-[var(--color-text-secondary)]">
          {exports.map((job) => (
            <li key={job.id}>
              Export {job.id.slice(0, 8)} · {job.status} ·{" "}
              {job.downloadUrl ? (
                <a className="text-[#8a93ff]" href={job.downloadUrl}>
                  download
                </a>
              ) : (
                "preparing"
              )}
            </li>
          ))}
          {imports.map((job) => (
            <li key={job.id}>
              CSV import {job.fileName} · {job.status} ·{" "}
              {job.importedCount ?? 0} imported · {job.errorCount ?? 0} errors
            </li>
          ))}
          {exports.length + imports.length === 0 ? (
            <li>No import or export jobs yet.</li>
          ) : null}
        </ul>
      </section>
      {showImportModal ? (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onComplete={load}
        />
      ) : null}
    </div>
  );
}
