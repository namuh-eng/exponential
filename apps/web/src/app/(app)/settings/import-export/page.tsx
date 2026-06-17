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

type GithubSnapshotIssue = {
  externalId: string;
  repository: string;
  number: number;
  title: string;
  state: "open" | "closed";
  labels?: Array<{ name: string }>;
  assignees?: Array<{ login: string }>;
};

type GithubSnapshot = {
  totals?: {
    issues?: number;
    comments?: number;
    open?: number;
    closed?: number;
  };
  repositories?: Array<{ fullName: string }>;
  issues?: GithubSnapshotIssue[];
};

type JiraProjectOption = {
  id: string;
  key: string;
  name: string;
};

type JiraPreviewIssue = {
  id: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  labels: string[];
  commentCount: number;
  sourceUrl: string;
  errors: string[];
};

type JiraPreviewResponse = {
  projects?: JiraProjectOption[];
  projectKey?: string;
  issues?: JiraPreviewIssue[];
  statusOptions?: string[];
  mapping?: { teamId?: string; statuses?: Record<string, string> };
  error?: string;
  message?: string;
};

type Provider = "csv" | "github" | "jira";
type CsvStep = "upload" | "map" | "preview" | "complete";
type GithubStep = "setup" | "review" | "complete";

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
      "Fetch GitHub issues, review scope, map teams/statuses/labels, and import.",
  },
  jira: {
    name: "Jira",
    description:
      "Connect Jira, choose projects, and prepare a guided migration.",
  },
};

function preferredStateId(
  team: TeamOption | undefined,
  categories: string[],
  fallbackIndex = 0,
) {
  return (
    team?.states.find((state) => categories.includes(state.category))?.id ??
    team?.states[fallbackIndex]?.id ??
    ""
  );
}

function splitRepositories(value: string) {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim().replace(/^https:\/\/github\.com\//, ""))
    .filter((item) => item.includes("/"));
}

function uniqueGithubLabels(snapshot: GithubSnapshot | null) {
  return Array.from(
    new Set(
      (snapshot?.issues ?? []).flatMap((issue) =>
        (issue.labels ?? []).map((label) => label.name),
      ),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

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
  const [githubStep, setGithubStep] = useState<GithubStep>("setup");
  const [githubToken, setGithubToken] = useState("");
  const [githubRepositories, setGithubRepositories] = useState("");
  const [githubScope, setGithubScope] = useState<"open" | "all">("open");
  const [githubJobId, setGithubJobId] = useState("");
  const [githubSnapshot, setGithubSnapshot] = useState<GithubSnapshot | null>(
    null,
  );
  const [githubOpenStateId, setGithubOpenStateId] = useState("");
  const [githubClosedStateId, setGithubClosedStateId] = useState("");
  const [githubImportLabels, setGithubImportLabels] = useState(true);
  const [jiraStep, setJiraStep] = useState<
    "connect" | "project" | "preview" | "complete"
  >("connect");
  const [jiraDeployment, setJiraDeployment] = useState<"cloud" | "server">(
    "cloud",
  );
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraProjects, setJiraProjects] = useState<JiraProjectOption[]>([]);
  const [jiraProjectKey, setJiraProjectKey] = useState("");
  const [jiraPreview, setJiraPreview] = useState<JiraPreviewIssue[]>([]);
  const [jiraStatuses, setJiraStatuses] = useState<string[]>([]);
  const [jiraStatusMapping, setJiraStatusMapping] = useState<
    Record<string, string>
  >({});
  const [jiraForwardSync, setJiraForwardSync] = useState(false);

  useEffect(() => {
    fetch("/api/workspaces/imports")
      .then((r) => r.json())
      .then((data) => {
        const nextTeams: TeamOption[] = data.teams ?? [];
        setTeams(nextTeams);
        setTeamId(nextTeams[0]?.id ?? "");
        setGithubOpenStateId(
          preferredStateId(nextTeams[0], ["triage", "backlog", "unstarted"]),
        );
        setGithubClosedStateId(
          preferredStateId(
            nextTeams[0],
            ["done", "completed", "canceled"],
            nextTeams[0]?.states.length ? nextTeams[0].states.length - 1 : 0,
          ),
        );
      })
      .catch(() => setError("Unable to load workspace import settings."));
  }, []);

  const selectedTeam = teams.find((team) => team.id === teamId);

  useEffect(() => {
    setGithubOpenStateId(
      (current) =>
        current ||
        preferredStateId(selectedTeam, ["triage", "backlog", "unstarted"]),
    );
    setGithubClosedStateId(
      (current) =>
        current ||
        preferredStateId(
          selectedTeam,
          ["done", "completed", "canceled"],
          selectedTeam?.states.length ? selectedTeam.states.length - 1 : 0,
        ),
    );
  }, [selectedTeam]);

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
    const nextMapping = guessMapping(parsedHeaders);
    setMapping(nextMapping);
    if (nextMapping.title && teamId) {
      await validateCsv(text, nextMapping, teamId);
    } else {
      setStep("map");
    }
  };

  const validateCsv = useCallback(
    async (
      nextCsvText = csvText,
      nextMapping = mapping,
      nextTeamId = teamId,
    ) => {
      setBusy(true);
      setError("");
      const res = await fetch("/api/workspaces/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: nextCsvText,
          mapping: nextMapping,
          teamId: nextTeamId,
        }),
      });
      const data = await res.json();
      setBusy(false);
      if (!res.ok) {
        setError(data.error ?? "CSV validation failed.");
        return;
      }
      setPreview(data.preview ?? []);
      setStep("preview");
    },
    [csvText, mapping, teamId],
  );

  const validate = async () => {
    await validateCsv();
  };

  useEffect(() => {
    if (
      provider === "csv" &&
      step === "map" &&
      csvText &&
      mapping.title &&
      teamId &&
      preview.length === 0 &&
      !busy
    ) {
      void validateCsv(csvText, mapping, teamId);
    }
  }, [
    busy,
    csvText,
    mapping,
    preview.length,
    provider,
    step,
    teamId,
    validateCsv,
  ]);

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
    setMessage(
      data.import?.message ??
        `CSV import completed with ${data.import?.importedCount ?? 0} issues created.`,
    );
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

  const fetchGithubSnapshot = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const repositories = splitRepositories(githubRepositories);
      const response = await fetch("/api/workspaces/current/import-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "fetch_provider_snapshot",
          provider: "github",
          jobId: githubJobId || undefined,
          token: githubToken,
          repositories,
          scope: githubScope,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to fetch GitHub issues");
      }
      setGithubJobId(data.import?.id ?? "");
      setGithubSnapshot(data.snapshot ?? null);
      setMessage(data.import?.message ?? "GitHub issues are ready to review.");
      setGithubStep("review");
      onComplete();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to fetch GitHub issues",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmGithubImport = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    const labels = Object.fromEntries(
      uniqueGithubLabels(githubSnapshot).map((label) => [
        label,
        githubImportLabels ? "create" : "skip",
      ]),
    );
    const repoTeams = Object.fromEntries(
      (githubSnapshot?.repositories ?? []).map((repo) => [
        repo.fullName,
        teamId,
      ]),
    );
    try {
      const response = await fetch("/api/workspaces/current/import-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "confirm_provider_import",
          provider: "github",
          jobId: githubJobId,
          includeClosed: githubScope === "all",
          mapping: {
            defaultTeamId: teamId,
            repoTeams,
            statuses: { open: githubOpenStateId, closed: githubClosedStateId },
            labels,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to import GitHub issues");
      }
      setMessage(data.import?.message ?? "GitHub import completed.");
      setGithubStep("complete");
      onComplete();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to import GitHub issues",
      );
    } finally {
      setBusy(false);
    }
  };

  const configureJira = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workspaces/current/import-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "configure_jira",
          deployment: jiraDeployment,
          baseUrl: jiraBaseUrl,
          email: jiraDeployment === "cloud" ? jiraEmail : undefined,
          token: jiraToken,
        }),
      });
      const data = (await response.json()) as JiraPreviewResponse;
      if (!response.ok) throw new Error(data.error ?? "Jira setup failed.");
      const projects = data.projects ?? [];
      setJiraProjects(projects);
      setJiraProjectKey(projects[0]?.key ?? "");
      setJiraToken("");
      setJiraStep("project");
      setMessage("Jira connected. Choose a project to preview.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jira setup failed.");
    } finally {
      setBusy(false);
    }
  };

  const previewJira = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workspaces/current/import-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "preview_jira_import",
          projectKey: jiraProjectKey,
          teamId,
        }),
      });
      const data = (await response.json()) as JiraPreviewResponse;
      if (!response.ok) throw new Error(data.error ?? "Jira preview failed.");
      setJiraProjects(data.projects ?? jiraProjects);
      setJiraPreview(data.issues ?? []);
      setJiraStatuses(data.statusOptions ?? []);
      setJiraStatusMapping(data.mapping?.statuses ?? {});
      setJiraStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jira preview failed.");
    } finally {
      setBusy(false);
    }
  };

  const startJiraImport = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workspaces/current/import-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "start_jira_import",
          projectKey: jiraProjectKey,
          teamId,
          statusMapping: jiraStatusMapping,
          importComments: true,
          importLabels: true,
          forwardSyncEnabled: jiraForwardSync,
        }),
      });
      const data = (await response.json()) as {
        import?: ImportJob;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Jira import failed.");
      setMessage(data.import?.message ?? "Jira import completed.");
      setJiraStep("complete");
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jira import failed.");
    } finally {
      setBusy(false);
    }
  };

  const pauseJiraSync = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workspaces/current/import-export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "pause_jira_sync",
          projectKey: jiraProjectKey,
          teamId,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(data.error ?? "Unable to pause Jira sync.");
      setMessage("Jira forward sync paused for this project.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to pause Jira sync.",
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
        ) : provider === "github" ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <button
              type="button"
              onClick={() => setProvider(null)}
              className="mb-4 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              ← Back to providers
            </button>
            <h3 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              GitHub Issues guided import
            </h3>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Add a GitHub token, choose repositories, fetch a review snapshot,
              map scope/status/labels, then confirm the import.
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
            {githubStep === "setup" ? (
              <div className="mt-4 space-y-3">
                <label className="block text-[13px]">
                  GitHub token
                  <input
                    aria-label="GitHub token"
                    type="password"
                    value={githubToken}
                    onChange={(event) => setGithubToken(event.target.value)}
                    placeholder="ghp_..."
                    className="mt-1 block w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] p-2"
                  />
                </label>
                <label className="block text-[13px]">
                  Repositories
                  <textarea
                    aria-label="GitHub repositories"
                    value={githubRepositories}
                    onChange={(event) =>
                      setGithubRepositories(event.target.value)
                    }
                    placeholder="namuh-eng/exponential"
                    className="mt-1 block min-h-20 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] p-2"
                  />
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={githubScope === "all"}
                    onChange={(event) =>
                      setGithubScope(event.target.checked ? "all" : "open")
                    }
                  />
                  Include closed issues
                </label>
                <button
                  type="button"
                  disabled={
                    busy || splitRepositories(githubRepositories).length === 0
                  }
                  onClick={fetchGithubSnapshot}
                  className="rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:opacity-60"
                >
                  Fetch GitHub issues
                </button>
              </div>
            ) : null}
            {githubStep === "review" ? (
              <div className="mt-4 space-y-4">
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  Review GitHub snapshot: {githubSnapshot?.totals?.issues ?? 0}{" "}
                  issues, {githubSnapshot?.totals?.comments ?? 0} comments,{" "}
                  {githubSnapshot?.totals?.open ?? 0} open,{" "}
                  {githubSnapshot?.totals?.closed ?? 0} closed.
                </p>
                <label className="block text-[13px]">
                  Target team
                  <select
                    className="mt-1 block w-full rounded-md bg-[var(--color-panel)] p-2"
                    value={teamId}
                    onChange={(event) => setTeamId(event.target.value)}
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name} ({team.key})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-[13px]">
                    Open issues status
                    <select
                      className="mt-1 block w-full rounded-md bg-[var(--color-panel)] p-2"
                      value={githubOpenStateId}
                      onChange={(event) =>
                        setGithubOpenStateId(event.target.value)
                      }
                    >
                      {selectedTeam?.states.map((state) => (
                        <option key={state.id} value={state.id}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-[13px]">
                    Closed issues status
                    <select
                      className="mt-1 block w-full rounded-md bg-[var(--color-panel)] p-2"
                      value={githubClosedStateId}
                      onChange={(event) =>
                        setGithubClosedStateId(event.target.value)
                      }
                    >
                      {selectedTeam?.states.map((state) => (
                        <option key={state.id} value={state.id}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={githubImportLabels}
                    onChange={(event) =>
                      setGithubImportLabels(event.target.checked)
                    }
                  />
                  Create and attach mapped GitHub labels
                </label>
                <div className="max-h-48 overflow-auto rounded border border-[var(--color-border)]">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr>
                        <th>Source</th>
                        <th>Title</th>
                        <th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(githubSnapshot?.issues ?? [])
                        .slice(0, 10)
                        .map((issue) => (
                          <tr key={issue.externalId}>
                            <td>
                              {issue.repository}#{issue.number}
                            </td>
                            <td>{issue.title}</td>
                            <td>{issue.state}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  disabled={
                    busy || !githubJobId || !teamId || !githubOpenStateId
                  }
                  onClick={confirmGithubImport}
                  className="rounded-md bg-[#5E6AD2] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#4F5ABF] disabled:opacity-60"
                >
                  Confirm GitHub import
                </button>
              </div>
            ) : null}
            {githubStep === "complete" ? (
              <p className="mt-4 text-[13px] text-[var(--color-text-secondary)]">
                The final summary is saved to import history. Imported issues
                include GitHub source links and metadata.
              </p>
            ) : null}
          </div>
        ) : provider === "jira" ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <button
              type="button"
              onClick={() => {
                setProvider(null);
                setJiraStep("connect");
              }}
              className="mb-4 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              ← Back to providers
            </button>
            <h3 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              Jira guided import
            </h3>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Connect Jira Cloud or Server, preview a project, map statuses, and
              import issues with comments and source links.
            </p>
            {jiraStep === "connect" ? (
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-[13px]">
                  Deployment
                  <select
                    className="rounded-md bg-[var(--color-panel)] p-2"
                    value={jiraDeployment}
                    onChange={(event) =>
                      setJiraDeployment(
                        event.target.value === "server" ? "server" : "cloud",
                      )
                    }
                  >
                    <option value="cloud">Jira Cloud</option>
                    <option value="server">Jira Server/Data Center</option>
                  </select>
                </label>
                <label className="grid gap-1 text-[13px]">
                  Base URL
                  <input
                    className="rounded-md bg-[var(--color-panel)] p-2"
                    value={jiraBaseUrl}
                    onChange={(event) => setJiraBaseUrl(event.target.value)}
                    placeholder="https://acme.atlassian.net"
                    type="url"
                  />
                </label>
                {jiraDeployment === "cloud" ? (
                  <label className="grid gap-1 text-[13px]">
                    Atlassian email
                    <input
                      className="rounded-md bg-[var(--color-panel)] p-2"
                      value={jiraEmail}
                      onChange={(event) => setJiraEmail(event.target.value)}
                      placeholder="admin@example.com"
                      type="email"
                    />
                  </label>
                ) : null}
                <label className="grid gap-1 text-[13px]">
                  API token or PAT
                  <input
                    className="rounded-md bg-[var(--color-panel)] p-2"
                    value={jiraToken}
                    onChange={(event) => setJiraToken(event.target.value)}
                    type="password"
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    busy ||
                    jiraBaseUrl.trim() === "" ||
                    jiraToken.trim() === "" ||
                    (jiraDeployment === "cloud" && jiraEmail.trim() === "")
                  }
                  onClick={configureJira}
                  className="w-fit rounded-md bg-[#5E6AD2] px-3 py-1.5 text-white disabled:opacity-50"
                >
                  Connect Jira
                </button>
              </div>
            ) : null}
            {jiraStep === "project" ? (
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1 text-[13px]">
                  Jira project
                  <select
                    className="rounded-md bg-[var(--color-panel)] p-2"
                    value={jiraProjectKey}
                    onChange={(event) => setJiraProjectKey(event.target.value)}
                  >
                    {jiraProjects.map((project) => (
                      <option key={project.id} value={project.key}>
                        {project.name} ({project.key})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[13px]">
                  Target team
                  <select
                    className="rounded-md bg-[var(--color-panel)] p-2"
                    value={teamId}
                    onChange={(event) => setTeamId(event.target.value)}
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name} ({team.key})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy || jiraProjectKey === "" || teamId === ""}
                  onClick={previewJira}
                  className="w-fit rounded-md bg-[#5E6AD2] px-3 py-1.5 text-white disabled:opacity-50"
                >
                  Preview Jira import
                </button>
              </div>
            ) : null}
            {jiraStep === "preview" ? (
              <div className="mt-4 grid gap-4">
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  Preview:{" "}
                  {
                    jiraPreview.filter((issue) => issue.errors.length === 0)
                      .length
                  }{" "}
                  ready, {jiraPreview.length} total issues.
                </p>
                <div className="grid gap-2">
                  {jiraStatuses.map((status) => (
                    <label key={status} className="grid gap-1 text-[13px]">
                      Jira status: {status}
                      <select
                        className="rounded-md bg-[var(--color-panel)] p-2"
                        value={jiraStatusMapping[status] ?? ""}
                        onChange={(event) =>
                          setJiraStatusMapping({
                            ...jiraStatusMapping,
                            [status]: event.target.value,
                          })
                        }
                      >
                        {selectedTeam?.states.map((state) => (
                          <option key={state.id} value={state.id}>
                            {state.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="max-h-56 overflow-auto rounded border border-[var(--color-border)]">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr>
                        <th>Key</th>
                        <th>Title</th>
                        <th>Status</th>
                        <th>Comments</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jiraPreview.map((issue) => (
                        <tr key={issue.id}>
                          <td>{issue.key}</td>
                          <td>{issue.title}</td>
                          <td>{issue.status}</td>
                          <td>{issue.commentCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    checked={jiraForwardSync}
                    onChange={(event) =>
                      setJiraForwardSync(event.target.checked)
                    }
                    type="checkbox"
                  />
                  Enable forward sync for this Jira project/team
                </label>
                <button
                  type="button"
                  disabled={
                    busy || jiraPreview.some((issue) => issue.errors.length > 0)
                  }
                  onClick={startJiraImport}
                  className="w-fit rounded-md bg-[#5E6AD2] px-3 py-1.5 text-white disabled:opacity-50"
                >
                  Confirm Jira import
                </button>
              </div>
            ) : null}
            {jiraStep === "complete" ? (
              <div className="mt-4 grid gap-3">
                <p className="text-[13px] text-green-400">{message}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={pauseJiraSync}
                  className="w-fit rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[13px]"
                >
                  Pause project sync
                </button>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 text-[13px] text-red-400">
                {error}
              </p>
            ) : null}
            {message && jiraStep !== "complete" ? (
              <output className="mt-3 block text-[13px] text-green-400">
                {message}
              </output>
            ) : null}
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
                  Preview: {preview.filter((r) => r.errors.length === 0).length}{" "}
                  valid, {preview.filter((r) => r.errors.length > 0).length}{" "}
                  with errors, {preview.length} total
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
                  {message ||
                    "Issues were created and the import job was saved to history."}
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
      setMessage(
        data.export?.message ?? "Workspace export is ready to download.",
      );
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
