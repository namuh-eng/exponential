import type { EffectiveAgentGuidance } from "@/lib/agent-guidance";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "needs_review"
  | "completed";
export type AgentSuggestionStatus = "open" | "accepted" | "declined";
export type AgentActionType =
  | "summarize_thread"
  | "create_issue"
  | "propose_updates"
  | "route_request"
  | "answer_workspace_question";
export type ExternalAgentProvider =
  | "slack"
  | "teams"
  | "zendesk"
  | "intercom"
  | "front";

export interface AgentSourceContext {
  provider: ExternalAgentProvider;
  conversationId: string;
  threadId?: string;
  messageId?: string;
  channelId?: string;
  channelName?: string;
  ticketId?: string;
  customerId?: string;
  permalink?: string;
  excerpt?: string;
}

export interface AgentActorContext {
  externalUserId: string;
  displayName?: string;
  email?: string;
  mappedUserId?: string | null;
}

export interface AgentReviewGate {
  required: boolean;
  reason: string;
  policy: "external_mutation_requires_approval" | "read_only_action";
}

export interface AgentSuggestion {
  id: string;
  title: string;
  summary: string;
  target: string;
  contextUrl: string;
  isExternalContext?: boolean;
  actionType?: AgentActionType;
  requiresApproval?: boolean;
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
  actionType?: AgentActionType;
  source?: AgentSourceContext;
  actor?: AgentActorContext;
  reviewGate?: AgentReviewGate;
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

interface CreateExternalAgentRunInput {
  actionType: AgentActionType;
  title: string;
  prompt: string;
  teamKey: string;
  source: AgentSourceContext;
  actor: AgentActorContext;
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
        autoFixEnabled: false,
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
    source: run.source ? { ...run.source } : undefined,
    actor: run.actor ? { ...run.actor } : undefined,
    reviewGate: run.reviewGate ? { ...run.reviewGate } : undefined,
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
        autoFixEnabled: false,
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
      input.guidance?.autoFixEnabled
        ? "Account personalization requested proactive lint/type fix suggestions for this run."
        : "Account personalization left proactive lint/type fixes off for this run.",
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

function providerLabel(provider: ExternalAgentProvider) {
  const labels: Record<ExternalAgentProvider, string> = {
    slack: "Slack",
    teams: "Microsoft Teams",
    zendesk: "Zendesk",
    intercom: "Intercom",
    front: "Front",
  };

  return labels[provider];
}

function isMutationAction(actionType: AgentActionType) {
  return (
    actionType === "create_issue" ||
    actionType === "propose_updates" ||
    actionType === "route_request"
  );
}

function externalContextTarget(source: AgentSourceContext) {
  return (
    source.permalink ??
    source.ticketId ??
    source.threadId ??
    source.messageId ??
    source.conversationId
  );
}

function suggestionTitleForAction(
  actionType: AgentActionType,
  provider: string,
) {
  if (actionType === "create_issue") {
    return `Create issue from ${provider} conversation`;
  }
  if (actionType === "propose_updates") {
    return `Propose workspace updates from ${provider}`;
  }
  if (actionType === "route_request") {
    return `Route ${provider} request`;
  }
  if (actionType === "answer_workspace_question") {
    return `Answer ${provider} workspace question`;
  }
  return `Summarize ${provider} thread`;
}

function outputForExternalAction(input: CreateExternalAgentRunInput) {
  const provider = providerLabel(input.source.provider);
  if (!isMutationAction(input.actionType)) {
    return `${provider} conversation context captured. The agent action is read-only and ready for review in history.`;
  }

  return `${provider} conversation context captured. A proposed mutation was prepared and requires explicit user approval before applying changes.`;
}

export function createExternalAgentRun(
  workspaceId: string,
  input: CreateExternalAgentRunInput,
) {
  const runs = workspaceRuns(workspaceId);
  const now = new Date().toISOString();
  const sequence = runs.length + 1;
  const teamKey = input.teamKey.trim().toUpperCase() || "EXP";
  const provider = providerLabel(input.source.provider);
  const mutationAction = isMutationAction(input.actionType);
  const target = externalContextTarget(input.source);
  const id = `agent-run-${workspaceId.slice(0, 8)}-${sequence}`;
  const reviewGate: AgentReviewGate = mutationAction
    ? {
        required: true,
        policy: "external_mutation_requires_approval",
        reason:
          "External chat and support-provider mutation proposals require explicit user approval before changes are applied.",
      }
    : {
        required: false,
        policy: "read_only_action",
        reason:
          "Read-only external agent actions do not mutate workspace data.",
      };
  const suggestion = suggestionWithContext(
    {
      id: `${id}-external-action`,
      title: suggestionTitleForAction(input.actionType, provider),
      summary:
        input.source.excerpt?.trim() ||
        input.prompt.trim() ||
        `Review captured ${provider} source context before acting.`,
      target,
      actionType: input.actionType,
      requiresApproval: reviewGate.required,
      status: "open",
    },
    teamKey,
  );
  const run: AgentRun = {
    id,
    title: input.title.trim(),
    prompt: input.prompt.trim(),
    teamKey,
    promptConfig: {
      guidance: input.guidance ?? {
        entries: [],
        effectiveInstructions: "",
        autoFixEnabled: false,
        teamKey,
      },
    },
    context: target,
    actionType: input.actionType,
    source: { ...input.source },
    actor: { ...input.actor },
    reviewGate,
    status: mutationAction ? "needs_review" : "completed",
    owner:
      input.actor.displayName?.trim() ||
      input.actor.email?.trim() ||
      input.actor.externalUserId,
    target: `${provider} · ${input.source.channelName ?? input.source.conversationId}`,
    createdAt: now,
    updatedAt: now,
    output: outputForExternalAction(input),
    logs: [
      `Received ${input.actionType} from ${provider}.`,
      `Captured provider source ${input.source.provider}:${input.source.conversationId}.`,
      `Captured actor ${input.actor.externalUserId}${input.actor.mappedUserId ? ` mapped to ${input.actor.mappedUserId}` : ""}.`,
      reviewGate.required
        ? "Review gate enabled before applying external mutation."
        : "Read-only action recorded without mutation review gate.",
    ],
    suggestions: [suggestion],
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
