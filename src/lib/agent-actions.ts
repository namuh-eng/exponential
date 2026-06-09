import type {
  AgentActionType,
  AgentActorContext,
  AgentSourceContext,
  ExternalAgentProvider,
} from "@/lib/agent-runs";

export const EXTERNAL_AGENT_PROVIDERS = [
  "slack",
  "teams",
  "zendesk",
  "intercom",
  "front",
] as const satisfies readonly ExternalAgentProvider[];

export const AGENT_ACTION_TYPES = [
  "summarize_thread",
  "create_issue",
  "propose_updates",
  "route_request",
  "answer_workspace_question",
] as const satisfies readonly AgentActionType[];

export type AgentActionsDisabledState = {
  status: "disabled";
  code:
    | "ai_provider_missing"
    | "unsupported_provider"
    | "provider_missing"
    | "invalid_action";
  message: string;
  provider?: ExternalAgentProvider;
};

export type ParsedExternalAgentAction = {
  actionType: AgentActionType;
  title: string;
  prompt: string;
  teamKey: string;
  source: AgentSourceContext;
  actor: AgentActorContext;
};

const providerSet = new Set<string>(EXTERNAL_AGENT_PROVIDERS);
const actionTypeSet = new Set<string>(AGENT_ACTION_TYPES);

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown) {
  const normalized = readString(value);
  return normalized || undefined;
}

function readRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function getAgentActionsProviderState():
  | { status: "enabled" }
  | AgentActionsDisabledState {
  const provider = process.env.AGENT_ACTIONS_PROVIDER?.trim().toLowerCase();
  if (!provider || provider === "deterministic" || provider === "mock") {
    return { status: "enabled" };
  }

  if (provider === "openai") {
    return process.env.OPENAI_API_KEY?.trim()
      ? { status: "enabled" }
      : {
          status: "disabled",
          code: "ai_provider_missing",
          message:
            "AI agent actions are disabled because OPENAI_API_KEY is not configured.",
        };
  }

  return {
    status: "disabled",
    code: "ai_provider_missing",
    message: `AI agent actions are disabled because AGENT_ACTIONS_PROVIDER=${provider} is not supported.`,
  };
}

export function providerMissingState(
  provider: ExternalAgentProvider,
): AgentActionsDisabledState {
  return {
    status: "disabled",
    code: "provider_missing",
    provider,
    message: `${provider} is not connected for this workspace.`,
  };
}

export function parseExternalAgentAction(
  body: Record<string, unknown>,
): ParsedExternalAgentAction | AgentActionsDisabledState {
  const actionType = readString(body.actionType);
  if (!actionTypeSet.has(actionType)) {
    return {
      status: "disabled",
      code: "invalid_action",
      message: "Agent action type is not supported.",
    };
  }

  const sourceRecord = readRecord(body.source);
  const provider = readString(sourceRecord.provider);
  if (!providerSet.has(provider)) {
    return {
      status: "disabled",
      code: "unsupported_provider",
      message: "External agent source provider is not supported.",
    };
  }

  const conversationId = readString(sourceRecord.conversationId);
  if (!conversationId) {
    return {
      status: "disabled",
      code: "invalid_action",
      message: "External conversationId is required.",
    };
  }

  const actorRecord = readRecord(body.actor);
  const externalUserId = readString(actorRecord.externalUserId);
  if (!externalUserId) {
    return {
      status: "disabled",
      code: "invalid_action",
      message: "External actor externalUserId is required.",
    };
  }

  const prompt = readString(body.prompt);
  if (prompt.length < 12) {
    return {
      status: "disabled",
      code: "invalid_action",
      message: "Agent action prompt must be at least 12 characters.",
    };
  }

  return {
    actionType: actionType as AgentActionType,
    title:
      readString(body.title) ||
      `External ${actionType.replaceAll("_", " ")} request`,
    prompt,
    teamKey: readString(body.teamKey),
    source: {
      provider: provider as ExternalAgentProvider,
      conversationId,
      threadId: readOptionalString(sourceRecord.threadId),
      messageId: readOptionalString(sourceRecord.messageId),
      channelId: readOptionalString(sourceRecord.channelId),
      channelName: readOptionalString(sourceRecord.channelName),
      ticketId: readOptionalString(sourceRecord.ticketId),
      customerId: readOptionalString(sourceRecord.customerId),
      permalink: readOptionalString(sourceRecord.permalink),
      excerpt: readOptionalString(sourceRecord.excerpt),
    },
    actor: {
      externalUserId,
      displayName: readOptionalString(actorRecord.displayName),
      email: readOptionalString(actorRecord.email),
    },
  };
}
