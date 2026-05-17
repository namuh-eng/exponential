import type { EffectiveAgentGuidance } from "@/lib/agent-guidance";

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
  contextUrl: string;
  isExternalContext?: boolean;
  status: AgentSuggestionStatus;
}

export interface AgentRun {
  id: string;
  title: string;
  prompt: string;
  teamKey: string;
  promptConfig: {
    guidance: EffectiveAgentGuidance;
  };
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
  guidance?: EffectiveAgentGuidance;
}

const fallbackCreatedAt = "2026-05-15T12:00:00.000Z";

function encodePathSegment(value: string) {
  return encodeURIComponent(value.trim());
}

function slugifyProjectContext(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveAgentContextLink(
  target: string,
  teamKey: string,
): { href: string; isExternal?: boolean } {
  const normalizedTarget = target.trim();
  const normalizedTeamKey = teamKey.trim().toUpperCase() || "EXP";

  if (!normalizedTarget) {
    return { href: "/search?q=context" };
  }

  if (/^https?:\/\//i.test(normalizedTarget)) {
    return { href: normalizedTarget, isExternal: true };
  }

  const issueMatch = normalizedTarget.match(/\b([A-Z][A-Z0-9]+-\d+)\b/i);
  if (issueMatch) {
    const identifier = issueMatch[1].toUpperCase();
    return {
      href: `/team/${encodePathSegment(normalizedTeamKey)}/issue/${encodePathSegment(identifier)}`,
    };
  }

  const projectMatch = normalizedTarget.match(/^project\s*:?\s*(.+)$/i);
  if (projectMatch) {
    const slug = slugifyProjectContext(projectMatch[1]);
    if (slug) {
      return { href: `/project/${encodePathSegment(slug)}/overview` };
    }
  }

  return { href: `/search?q=${encodeURIComponent(normalizedTarget)}` };
}

function suggestionWithContext(
  suggestion: Omit<AgentSuggestion, "contextUrl" | "isExternalContext">,
  teamKey: string,
): AgentSuggestion {
  const contextLink = resolveAgentContextLink(suggestion.target, teamKey);
  return {
    ...suggestion,
    contextUrl: contextLink.href,
    isExternalContext: contextLink.isExternal,
  };
}

const seededRuns: AgentRun[] = [
  {
    id: "agent-run-seed-triage",
    title: "Review stale triage issues",
    prompt:
      "Find triage issues without an assignee and suggest the next owner or status.",
    teamKey: "EXP",
    context: "Team backlog",
    promptConfig: {
      guidance: {
        entries: [],
        effectiveInstructions: "",
        teamKey: "EXP",
      },
    },
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
      suggestionWithContext(
        {
          id: "suggestion-assign-agent-sidebar",
          title: "Assign Agent sidebar follow-up",
          summary:
            "Route placeholder work to the product engineering queue and link it to issue #300.",
          target: "EXP-300",
          status: "open",
        },
        "EXP",
      ),
      suggestionWithContext(
        {
          id: "suggestion-prioritize-inbox",
          title: "Prioritize inbox notification regression",
          summary:
            "Move the unread count regression into the current cycle because it affects daily triage.",
          target: "EXP-297",
          status: "open",
        },
        "EXP",
      ),
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
    promptConfig: {
      guidance: input.guidance ?? {
        entries: [],
        effectiveInstructions: "",
        teamKey,
      },
    },
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
      input.guidance?.effectiveInstructions
        ? "Applied workspace/account/team agent guidance to the prompt configuration."
        : "No saved agent guidance was available for this request context.",
      "Queued deterministic mock execution for product validation.",
    ],
    suggestions: [
      suggestionWithContext(
        {
          id: `${id}-suggestion-open-issue`,
          title: "Open linked workspace context",
          summary:
            "Review the selected team and target context before handing this task to the real executor.",
          target: normalizedContext,
          status: "open",
        },
        teamKey,
      ),
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
