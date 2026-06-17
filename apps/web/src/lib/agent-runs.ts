import type { EffectiveAgentGuidance } from "@/lib/agent-guidance";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "needs_review"
  | "completed"
  | "failed";
export type AgentSuggestionStatus = "open" | "accepted" | "declined";

export interface AgentSuggestion {
  id: string;
  title: string;
  summary: string;
  target: string;
  contextUrl: string;
  isExternalContext?: boolean;
  status: AgentSuggestionStatus;
  reviewedBy?: string;
  reviewedAt?: string;
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
  failureReason?: string;
  logs: string[];
  suggestions: AgentSuggestion[];
}

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
