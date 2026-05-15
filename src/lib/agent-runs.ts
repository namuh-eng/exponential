export type AgentRunStatus =
  | "queued"
  | "running"
  | "needs_review"
  | "completed";
export type AgentSuggestionStatus = "open" | "accepted" | "declined";

export interface AgentSuggestion {
  id: string;
  title: string;
  summary: string;
  target: string;
  status: AgentSuggestionStatus;
}

export interface AgentRun {
  id: string;
  title: string;
  prompt: string;
  teamKey: string;
  context: string;
  status: AgentRunStatus;
  owner: string;
  target: string;
  createdAt: string;
  updatedAt: string;
  output: string;
  logs: string[];
  suggestions: AgentSuggestion[];
}

interface CreateAgentRunInput {
  title: string;
  prompt: string;
  teamKey: string;
  context: string;
  owner?: string;
}

const fallbackCreatedAt = "2026-05-15T12:00:00.000Z";

const seededRuns: AgentRun[] = [
  {
    id: "agent-run-seed-triage",
    title: "Review stale triage issues",
    prompt:
      "Find triage issues without an assignee and suggest the next owner or status.",
    teamKey: "EXP",
    context: "Team backlog",
    status: "needs_review",
    owner: "Linear Agent",
    target: "EXP triage queue",
    createdAt: fallbackCreatedAt,
    updatedAt: "2026-05-15T12:06:00.000Z",
    output:
      "Found two triage candidates with clear ownership signals. Review suggestions before applying changes.",
    logs: [
      "Queued workspace scan for EXP triage.",
      "Inspected issue metadata, assignees, labels, and recent comments.",
      "Prepared two suggestions for human review.",
    ],
    suggestions: [
      {
        id: "suggestion-assign-agent-sidebar",
        title: "Assign Agent sidebar follow-up",
        summary:
          "Route placeholder work to the product engineering queue and link it to issue #300.",
        target: "EXP-300",
        status: "open",
      },
      {
        id: "suggestion-prioritize-inbox",
        title: "Prioritize inbox notification regression",
        summary:
          "Move the unread count regression into the current cycle because it affects daily triage.",
        target: "EXP-297",
        status: "open",
      },
    ],
  },
];

const runsByWorkspace = new Map<string, AgentRun[]>();

function cloneRun(run: AgentRun): AgentRun {
  return {
    ...run,
    logs: [...run.logs],
    suggestions: run.suggestions.map((suggestion) => ({ ...suggestion })),
  };
}

function workspaceRuns(workspaceId: string) {
  if (!runsByWorkspace.has(workspaceId)) {
    runsByWorkspace.set(workspaceId, seededRuns.map(cloneRun));
  }

  return runsByWorkspace.get(workspaceId) ?? [];
}

export function listAgentRuns(workspaceId: string) {
  return workspaceRuns(workspaceId).map(cloneRun);
}

export function createAgentRun(
  workspaceId: string,
  input: CreateAgentRunInput,
) {
  const runs = workspaceRuns(workspaceId);
  const now = new Date().toISOString();
  const sequence = runs.length + 1;
  const normalizedTitle = input.title.trim();
  const normalizedPrompt = input.prompt.trim();
  const normalizedContext = input.context.trim() || "Workspace";
  const teamKey = input.teamKey.trim().toUpperCase() || "EXP";
  const id = `agent-run-${workspaceId.slice(0, 8)}-${sequence}`;
  const run: AgentRun = {
    id,
    title: normalizedTitle,
    prompt: normalizedPrompt,
    teamKey,
    context: normalizedContext,
    status: "queued",
    owner: input.owner?.trim() || "You",
    target: `${teamKey} · ${normalizedContext}`,
    createdAt: now,
    updatedAt: now,
    output:
      "Mock agent run queued. The next step is ready for review and can be promoted when a real executor is connected.",
    logs: [
      "Created run from Agent dashboard composer.",
      `Captured context: ${teamKey} · ${normalizedContext}.`,
      "Queued deterministic mock execution for product validation.",
    ],
    suggestions: [
      {
        id: `${id}-suggestion-open-issue`,
        title: "Open linked workspace context",
        summary:
          "Review the selected team and target context before handing this task to the real executor.",
        target: `${teamKey} workspace`,
        status: "open",
      },
    ],
  };

  runs.unshift(run);
  return cloneRun(run);
}

export function updateAgentSuggestion(
  workspaceId: string,
  runId: string,
  suggestionId: string,
  status: AgentSuggestionStatus,
) {
  const run = workspaceRuns(workspaceId).find((item) => item.id === runId);
  const suggestion = run?.suggestions.find((item) => item.id === suggestionId);

  if (!run || !suggestion) {
    return null;
  }

  suggestion.status = status;
  run.updatedAt = new Date().toISOString();
  run.logs.push(
    `${status === "accepted" ? "Accepted" : "Declined"} suggestion: ${suggestion.title}.`,
  );

  return cloneRun(run);
}
