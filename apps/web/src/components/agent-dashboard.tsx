"use client";

import { useAppShellContext } from "@/app/(app)/app-shell";
import type {
  AgentRun,
  AgentSuggestion,
  AgentSuggestionStatus,
} from "@/lib/agent-runs";
import {
  apiErrorMessage,
  createBrowserApiClient,
} from "@/lib/browser-api-client";
import { withWorkspaceSlug } from "@/lib/workspace-paths";
import Link from "next/link";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

interface AgentRunsResponse {
  runs: AgentRun[];
  canCreateRuns: boolean;
}

const apiClient = createBrowserApiClient();

const statusLabels: Record<AgentRun["status"], string> = {
  queued: "Queued",
  running: "Running",
  needs_review: "Needs review",
  completed: "Completed",
};

const suggestionActionLabels: Record<AgentSuggestionStatus, string> = {
  open: "Open",
  accepted: "Accepted",
  declined: "Declined",
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function contextHrefForSuggestion(
  suggestion: AgentSuggestion,
  workspaceSlug?: string | null,
) {
  if (suggestion.isExternalContext) {
    return suggestion.contextUrl;
  }

  return withWorkspaceSlug(
    suggestion.contextUrl || "/search?q=context",
    workspaceSlug,
  );
}

function statusClassName(status: AgentRun["status"]) {
  if (status === "needs_review") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (status === "completed") {
    return "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300";
  }
  if (status === "running") {
    return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  }
  return "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]";
}

export function AgentDashboard() {
  const shellContext = useAppShellContext();
  const workspaceSlug = shellContext?.workspaceSlug;
  const teams = useMemo(
    () =>
      shellContext?.teams && shellContext.teams.length > 0
        ? shellContext.teams
        : [
            {
              id: shellContext?.teamId,
              name: shellContext?.teamName ?? "Exponential",
              key: shellContext?.teamKey ?? "EXP",
            },
          ],
    [shellContext],
  );
  const defaultTeamKey = teams[0]?.key ?? "EXP";

  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [canCreateRuns, setCanCreateRuns] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState("Investigate workspace issue");
  const [prompt, setPrompt] = useState(
    "Inspect the linked issue, summarize likely causes, and propose the smallest safe fix.",
  );
  const [teamKey, setTeamKey] = useState(defaultTeamKey);
  const [context, setContext] = useState("Issue or project URL");

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0];

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await apiClient.GET("/agent/runs");
      if (error) {
        throw new Error(apiErrorMessage(error, "Unable to load agent runs"));
      }

      const response = data as AgentRunsResponse | undefined;
      const nextRuns = response?.runs ?? [];
      setRuns(nextRuns);
      setCanCreateRuns(response?.canCreateRuns ?? false);
      setSelectedRunId((current) =>
        current && nextRuns.some((run) => run.id === current)
          ? current
          : (nextRuns[0]?.id ?? null),
      );
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Unable to load agent runs",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    setTeamKey(defaultTeamKey);
  }, [defaultTeamKey]);

  async function createRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!canCreateRuns) {
      setFormError(
        "You do not have permission to create agent runs in this workspace.",
      );
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await apiClient.POST("/agent/runs", {
        body: { title, prompt, teamKey, context },
      });
      if (error || !data?.run) {
        throw new Error(apiErrorMessage(error, "Unable to create agent run"));
      }

      const run = data.run as AgentRun;
      setRuns((current) => [run, ...current]);
      setSelectedRunId(run.id);
      setTitle("Follow up on agent output");
      setPrompt(
        "Review the previous run output and prepare the next concrete action.",
      );
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Unable to create agent run",
      );
    } finally {
      setCreating(false);
    }
  }

  async function updateSuggestion(
    runId: string,
    suggestionId: string,
    status: Exclude<AgentSuggestionStatus, "open">,
  ) {
    setLoadError(null);
    try {
      const { data, error } = await apiClient.PATCH("/agent/runs/{id}", {
        params: { path: { id: runId } },
        body: { suggestionId, status },
      });
      if (error || !data?.run) {
        throw new Error(apiErrorMessage(error, "Unable to update suggestion"));
      }

      const updatedRun = data.run as AgentRun;
      setRuns((current) =>
        current.map((run) => (run.id === updatedRun.id ? updatedRun : run)),
      );
      setSelectedRunId(updatedRun.id);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Unable to update suggestion",
      );
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b border-[var(--color-border)] px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[12px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
              Agent
            </h1>
            <h2 className="mt-1 text-[24px] font-semibold text-[var(--color-text-primary)]">
              Agent workspace
            </h2>
            <p className="mt-2 max-w-[760px] text-[13px] leading-5 text-[var(--color-text-secondary)]">
              Start deterministic agent runs, review history, and accept or
              decline suggested actions from the current workspace context.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={withWorkspaceSlug(
                "/settings/account/agents",
                workspaceSlug,
              )}
              className="rounded-md border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Agent settings
            </Link>
            <Link
              href={withWorkspaceSlug("/settings/ai", workspaceSlug)}
              className="rounded-md border border-[var(--color-border)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Workspace AI settings
            </Link>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[380px_1fr]">
        <aside className="flex min-h-0 flex-col border-b border-[var(--color-border)] lg:border-r lg:border-b-0">
          <section className="border-b border-[var(--color-border)] p-4">
            <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
              Start an agent run
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
              Mock execution is enabled for this workspace so the route remains
              actionable until a live executor is wired in.
            </p>
            {!canCreateRuns && (
              <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] leading-5 text-amber-700 dark:text-amber-300">
                Permission state: your role can view agent history but cannot
                create or manage runs.
              </div>
            )}
            <form className="mt-4 space-y-3" onSubmit={createRun}>
              <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
                Task title
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-secondary)]"
                  placeholder="Investigate issue"
                  disabled={!canCreateRuns || creating}
                  required
                />
              </label>
              <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
                Team context
                <select
                  value={teamKey}
                  onChange={(event) => setTeamKey(event.target.value)}
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-secondary)]"
                  disabled={!canCreateRuns || creating}
                >
                  {teams.map((team) => (
                    <option key={team.key} value={team.key}>
                      {team.name} ({team.key})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
                Issue, PR, or project context
                <input
                  value={context}
                  onChange={(event) => setContext(event.target.value)}
                  className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-secondary)]"
                  placeholder="EXP-300, PR URL, project"
                  disabled={!canCreateRuns || creating}
                />
              </label>
              <label className="block text-[12px] font-medium text-[var(--color-text-secondary)]">
                Instructions
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  className="mt-1 min-h-[104px] w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-content-bg)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-text-secondary)]"
                  placeholder="Describe the work the agent should perform"
                  disabled={!canCreateRuns || creating}
                  required
                />
              </label>
              {formError && (
                <p className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[12px] text-red-700 dark:text-red-300">
                  {formError}
                </p>
              )}
              <button
                type="submit"
                disabled={!canCreateRuns || creating}
                className="w-full rounded-md bg-[var(--color-text-primary)] px-3 py-2 text-[13px] font-medium text-[var(--color-content-bg)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? "Creating run..." : "Start mock agent run"}
              </button>
            </form>
          </section>

          <section className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                Active and recent runs
              </h2>
              <button
                type="button"
                onClick={() => void loadRuns()}
                className="text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                Refresh
              </button>
            </div>
            {loading && (
              <div className="mt-4 rounded-lg border border-[var(--color-border)] p-4 text-[13px] text-[var(--color-text-secondary)]">
                Loading agent runs...
              </div>
            )}
            {loadError && (
              <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-[13px] text-red-700 dark:text-red-300">
                <p>{loadError}</p>
                <button
                  type="button"
                  onClick={() => void loadRuns()}
                  className="mt-3 rounded-md border border-red-500/30 px-3 py-1 text-[12px]"
                >
                  Retry
                </button>
              </div>
            )}
            {!loading && !loadError && runs.length === 0 && (
              <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] p-4 text-[13px] leading-5 text-[var(--color-text-secondary)]">
                No agent runs yet. Create the first run with a title, workspace
                context, and instructions.
              </div>
            )}
            <div className="mt-3 space-y-2">
              {runs.map((run) => (
                <button
                  type="button"
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${selectedRun?.id === run.id ? "border-[var(--color-text-secondary)] bg-[var(--color-surface)]" : "border-[var(--color-border)]"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
                      {run.title}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${statusClassName(run.status)}`}
                    >
                      {statusLabels[run.status]}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[12px] text-[var(--color-text-secondary)]">
                    {run.target} · {formatTimestamp(run.updatedAt)}
                  </p>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="min-h-0 overflow-y-auto p-6">
          {selectedRun ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-semibold text-[var(--color-text-primary)]">
                      {selectedRun.title}
                    </h2>
                    <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
                      {selectedRun.owner} · {selectedRun.teamKey} · Created{" "}
                      {formatTimestamp(selectedRun.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[12px] ${statusClassName(selectedRun.status)}`}
                  >
                    {statusLabels[selectedRun.status]}
                  </span>
                </div>
                <p className="mt-4 text-[13px] leading-5 text-[var(--color-text-secondary)]">
                  {selectedRun.prompt}
                </p>
                <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-content-bg)] p-4">
                  <h3 className="text-[13px] font-medium text-[var(--color-text-primary)]">
                    Latest output
                  </h3>
                  <p className="mt-2 text-[13px] leading-5 text-[var(--color-text-secondary)]">
                    {selectedRun.output}
                  </p>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <section className="rounded-xl border border-[var(--color-border)] p-5">
                  <h3 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                    Suggestions
                  </h3>
                  <div className="mt-3 space-y-3">
                    {selectedRun.suggestions.map((suggestion) => (
                      <article
                        key={suggestion.id}
                        className="rounded-lg border border-[var(--color-border)] p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-[13px] font-medium text-[var(--color-text-primary)]">
                              {suggestion.title}
                            </h4>
                            <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
                              {suggestion.target}
                            </p>
                          </div>
                          <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                            {suggestionActionLabels[suggestion.status]}
                          </span>
                        </div>
                        <p className="mt-2 text-[13px] leading-5 text-[var(--color-text-secondary)]">
                          {suggestion.summary}
                        </p>
                        {suggestion.status === "open" && (
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void updateSuggestion(
                                  selectedRun.id,
                                  suggestion.id,
                                  "accepted",
                                )
                              }
                              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void updateSuggestion(
                                  selectedRun.id,
                                  suggestion.id,
                                  "declined",
                                )
                              }
                              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                            >
                              Decline
                            </button>
                            <Link
                              href={contextHrefForSuggestion(
                                suggestion,
                                workspaceSlug,
                              )}
                              target={
                                suggestion.isExternalContext
                                  ? "_blank"
                                  : undefined
                              }
                              rel={
                                suggestion.isExternalContext
                                  ? "noreferrer"
                                  : undefined
                              }
                              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                            >
                              Open context
                            </Link>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-[var(--color-border)] p-5">
                  <h3 className="text-[15px] font-medium text-[var(--color-text-primary)]">
                    Run history
                  </h3>
                  <ol className="mt-3 space-y-3">
                    {selectedRun.logs.map((entry, index) => (
                      <li
                        key={`${selectedRun.id}-${entry}-${index}`}
                        className="flex gap-3 text-[13px] leading-5 text-[var(--color-text-secondary)]"
                      >
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-text-tertiary)]" />
                        <span>{entry}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center">
              <div>
                <h2 className="text-[16px] font-medium text-[var(--color-text-primary)]">
                  Create your first agent run
                </h2>
                <p className="mt-2 max-w-[420px] text-[13px] leading-5 text-[var(--color-text-secondary)]">
                  The composer starts a persisted mock run and this panel shows
                  the detail, output, suggestions, and history.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
