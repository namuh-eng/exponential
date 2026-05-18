export type TeamSettingsFlags = {
  emailEnabled: boolean;
  detailedHistory: boolean;
  agentGuidance: string;
  autoAssignment: boolean;
  autoAssignMode: "creator" | "team_lead" | "round_robin" | "none";
  defaultAssigneeId: string | null;
  gitBranchFormat: string;
  gitPrAutomationEnabled: boolean;
  gitPrMergeTargetStatusId: string | null;
  gitBranchCreateTargetStatusId: string | null;
  statusTransitionRules: StatusTransitionRule[];
  discussionSummariesEnabled: boolean;
  discussionSummaryMinComments: number;
  discussionSummaryRefreshMode: "manual" | "automatic";
  triageAcceptDestinationStateId: string | null;
  triageDeclineDestinationStateId: string | null;
};

export type StatusTransitionRule = {
  id: string;
  name: string;
  trigger:
    | "branch_created"
    | "pr_opened"
    | "pr_merged"
    | "issue_assigned"
    | "issue_unassigned";
  sourceCategory: "any" | "backlog" | "unstarted" | "started" | "completed";
  targetStatusId: string;
  enabled: boolean;
};

const transitionTriggers = new Set([
  "branch_created",
  "pr_opened",
  "pr_merged",
  "issue_assigned",
  "issue_unassigned",
]);
const transitionSources = new Set([
  "any",
  "backlog",
  "unstarted",
  "started",
  "completed",
]);

function readStatusTransitionRules(value: unknown): StatusTransitionRule[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index): StatusTransitionRule | null => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const trigger = typeof row.trigger === "string" ? row.trigger : "";
      const sourceCategory =
        typeof row.sourceCategory === "string" ? row.sourceCategory : "any";
      const targetStatusId =
        typeof row.targetStatusId === "string" ? row.targetStatusId : "";
      if (
        !transitionTriggers.has(trigger) ||
        !transitionSources.has(sourceCategory) ||
        !targetStatusId
      ) {
        return null;
      }
      return {
        id:
          typeof row.id === "string" && row.id.trim()
            ? row.id.trim()
            : `rule-${index + 1}`,
        name:
          typeof row.name === "string" && row.name.trim()
            ? row.name.trim()
            : "Status transition rule",
        trigger: trigger as StatusTransitionRule["trigger"],
        sourceCategory:
          sourceCategory as StatusTransitionRule["sourceCategory"],
        targetStatusId,
        enabled: row.enabled !== false,
      };
    })
    .filter((rule): rule is StatusTransitionRule => Boolean(rule));
}

export function readTeamSettings(settings: unknown): TeamSettingsFlags {
  const parsed =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>)
      : {};

  return {
    emailEnabled: parsed.emailEnabled === true,
    detailedHistory: parsed.detailedHistory !== false,
    agentGuidance:
      typeof parsed.agentGuidance === "string" ? parsed.agentGuidance : "",
    autoAssignment: parsed.autoAssignment === true,
    autoAssignMode:
      parsed.autoAssignMode === "creator" ||
      parsed.autoAssignMode === "team_lead" ||
      parsed.autoAssignMode === "round_robin" ||
      parsed.autoAssignMode === "none"
        ? parsed.autoAssignMode
        : parsed.autoAssignment === true
          ? "round_robin"
          : "none",
    defaultAssigneeId:
      typeof parsed.defaultAssigneeId === "string"
        ? parsed.defaultAssigneeId
        : null,
    gitBranchFormat:
      typeof parsed.gitBranchFormat === "string" && parsed.gitBranchFormat
        ? parsed.gitBranchFormat
        : "{team}-{number}-{title}",
    gitPrAutomationEnabled: parsed.gitPrAutomationEnabled === true,
    gitPrMergeTargetStatusId:
      typeof parsed.gitPrMergeTargetStatusId === "string"
        ? parsed.gitPrMergeTargetStatusId
        : null,
    gitBranchCreateTargetStatusId:
      typeof parsed.gitBranchCreateTargetStatusId === "string"
        ? parsed.gitBranchCreateTargetStatusId
        : null,
    statusTransitionRules: readStatusTransitionRules(
      parsed.statusTransitionRules,
    ),
    discussionSummariesEnabled: parsed.discussionSummariesEnabled === true,
    discussionSummaryMinComments:
      typeof parsed.discussionSummaryMinComments === "number" &&
      Number.isInteger(parsed.discussionSummaryMinComments) &&
      parsed.discussionSummaryMinComments >= 3 &&
      parsed.discussionSummaryMinComments <= 50
        ? parsed.discussionSummaryMinComments
        : 8,
    discussionSummaryRefreshMode:
      parsed.discussionSummaryRefreshMode === "automatic"
        ? "automatic"
        : "manual",
    triageAcceptDestinationStateId:
      typeof parsed.triageAcceptDestinationStateId === "string"
        ? parsed.triageAcceptDestinationStateId
        : null,
    triageDeclineDestinationStateId:
      typeof parsed.triageDeclineDestinationStateId === "string"
        ? parsed.triageDeclineDestinationStateId
        : null,
  };
}

export function getMutableTeamSettings(settings: unknown) {
  return settings && typeof settings === "object"
    ? (settings as Record<string, unknown>)
    : {};
}
