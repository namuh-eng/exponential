import { resolveActiveWorkspaceId } from "@/lib/active-workspace";
import type { ApiSession } from "@/lib/api-auth";
import { getSlackOAuthConfig } from "@/lib/auth-providers";
import { db } from "@/lib/db";
import {
  member,
  team,
  teamNotificationIntegration,
  workspace,
  workspaceIntegration,
} from "@/lib/db/schema";
import { LINEAR_INTEGRATION_ROADMAP } from "@/lib/integration-roadmap";
import { getWorkspaceSlugFromPath } from "@/lib/workspace-paths";
import { isWorkspaceAdminRole } from "@/lib/workspace-permissions";
import { and, eq } from "drizzle-orm";

export type IntegrationProvider = string;

export type WorkspaceAccess = {
  workspaceId: string;
  workspaceSlug: string;
  role: string;
};

export const SLACK_NOTIFICATION_EVENTS = [
  {
    id: "issue_created",
    label: "New issues",
    description: "Broadcast when an issue is created in this team.",
  },
  {
    id: "issue_status_changed",
    label: "Status changes",
    description: "Broadcast when an issue moves between workflow statuses.",
  },
  {
    id: "issue_commented",
    label: "New comments",
    description: "Broadcast when a teammate comments on an issue.",
  },
  {
    id: "cycle_completed",
    label: "Cycle updates",
    description: "Broadcast when a team cycle starts or completes.",
  },
] as const;

export const DEFAULT_SLACK_NOTIFICATION_EVENTS = [
  "issue_created",
  "issue_status_changed",
];

export const INTEGRATION_CATALOG: Array<{
  provider: IntegrationProvider;
  name: string;
  description: string;
  roadmapIssue: number;
}> = Array.from(
  new Map(
    LINEAR_INTEGRATION_ROADMAP.filter((item) => item.provider).map((item) => [
      item.provider,
      {
        provider: item.provider as string,
        name: providerDisplayName(item.provider as string),
        description: providerDescription(item.provider as string, item.scope),
        roadmapIssue: item.issue.number,
      },
    ]),
  ).values(),
);

function providerDisplayName(provider: string) {
  const labels: Record<string, string> = {
    "ai-agents": "AI Agents",
    airbyte: "Airbyte",
    "customer-requests": "Customer Requests",
    discord: "Discord",
    figma: "Figma",
    front: "Front",
    github: "GitHub",
    "google-sheets": "Google Sheets",
    gitlab: "GitLab",
    gong: "Gong",
    intercom: "Intercom",
    jira: "Jira",
    mcp: "MCP",
    "microsoft-teams": "Microsoft Teams",
    notion: "Notion",
    salesforce: "Salesforce",
    sentry: "Sentry",
    slack: "Slack",
    webhooks: "Outbound webhooks",
    zapier: "Zapier",
    zendesk: "Zendesk",
  };
  return labels[provider] ?? provider;
}

function providerDescription(provider: string, fallback: string) {
  const descriptions: Record<string, string> = {
    github: "Sync pull requests, commits, repositories, and issue links.",
    slack: "Send issue updates and create issues or Asks from Slack messages.",
    zendesk: "Connect support tickets to product work and customer requests.",
  };
  return descriptions[provider] ?? fallback;
}

function getRequestedWorkspaceSlug(request?: Request) {
  const explicitSlug = request?.headers.get("x-workspace-slug");
  if (explicitSlug) return explicitSlug;

  const sourcePath = request?.headers.get("x-workspace-source-path");
  const slugFromSourcePath = sourcePath
    ? getWorkspaceSlugFromPath(sourcePath)
    : null;
  if (slugFromSourcePath) return slugFromSourcePath;

  const referer = request?.headers.get("referer");
  if (!referer) return null;

  try {
    return getWorkspaceSlugFromPath(new URL(referer).pathname);
  } catch {
    return null;
  }
}

export async function getWorkspaceAccess(
  session: ApiSession,
  request?: Request,
): Promise<WorkspaceAccess | null> {
  const apiWorkspaceId =
    "apiKey" in session ? session.apiKey.workspaceId : null;
  const apiMemberRole = "apiKey" in session ? session.apiKey.memberRole : null;
  const requestedSlug = getRequestedWorkspaceSlug(request);
  const workspaceId =
    apiWorkspaceId ?? (await resolveActiveWorkspaceId(session.user.id));

  const conditions = requestedSlug
    ? [eq(workspace.urlSlug, requestedSlug)]
    : workspaceId
      ? [eq(workspace.id, workspaceId)]
      : [];

  if (conditions.length === 0) return null;

  const [access] = await db
    .select({
      workspaceId: workspace.id,
      workspaceSlug: workspace.urlSlug,
      role: member.role,
    })
    .from(workspace)
    .innerJoin(
      member,
      and(
        eq(member.workspaceId, workspace.id),
        eq(member.userId, session.user.id),
      ),
    )
    .where(and(...conditions))
    .limit(1);

  if (access) return access;

  if (apiWorkspaceId) {
    const [apiWorkspace] = await db
      .select({ workspaceId: workspace.id, workspaceSlug: workspace.urlSlug })
      .from(workspace)
      .where(eq(workspace.id, apiWorkspaceId))
      .limit(1);
    return apiWorkspace
      ? {
          workspaceId: apiWorkspace.workspaceId,
          workspaceSlug: apiWorkspace.workspaceSlug,
          role: apiMemberRole ?? "member",
        }
      : null;
  }

  return null;
}

export function canManageIntegrations(role: string | undefined) {
  return isWorkspaceAdminRole(role);
}

export function isSlackInstallConfigured() {
  return Boolean(getSlackOAuthConfig());
}

export function normalizeSlackEvents(value: unknown) {
  const allowed = new Set<string>(
    SLACK_NOTIFICATION_EVENTS.map((event) => event.id),
  );
  if (!Array.isArray(value)) return DEFAULT_SLACK_NOTIFICATION_EVENTS;
  const events = value.filter(
    (event): event is string => typeof event === "string" && allowed.has(event),
  );
  return events.length
    ? Array.from(new Set(events))
    : DEFAULT_SLACK_NOTIFICATION_EVENTS;
}

export async function findSlackWorkspaceIntegration(workspaceId: string) {
  const [integration] = await db
    .select({
      id: workspaceIntegration.id,
      provider: workspaceIntegration.provider,
      status: workspaceIntegration.status,
      displayName: workspaceIntegration.displayName,
      externalId: workspaceIntegration.externalId,
      metadata: workspaceIntegration.metadata,
      connectedAt: workspaceIntegration.connectedAt,
    })
    .from(workspaceIntegration)
    .where(
      and(
        eq(workspaceIntegration.workspaceId, workspaceId),
        eq(workspaceIntegration.provider, "slack"),
      ),
    )
    .limit(1);

  return integration ?? null;
}

export async function findTeamForSlackSettings(
  key: string,
  workspaceId: string,
) {
  const [teamRecord] = await db
    .select({ id: team.id, key: team.key, name: team.name })
    .from(team)
    .where(and(eq(team.workspaceId, workspaceId), eq(team.key, key)))
    .limit(1);
  return teamRecord ?? null;
}

export async function findTeamSlackSettings(teamId: string) {
  const [settings] = await db
    .select({
      id: teamNotificationIntegration.id,
      workspaceIntegrationId:
        teamNotificationIntegration.workspaceIntegrationId,
      channelId: teamNotificationIntegration.channelId,
      channelName: teamNotificationIntegration.channelName,
      enabled: teamNotificationIntegration.enabled,
      events: teamNotificationIntegration.events,
      updatedAt: teamNotificationIntegration.updatedAt,
    })
    .from(teamNotificationIntegration)
    .where(
      and(
        eq(teamNotificationIntegration.teamId, teamId),
        eq(teamNotificationIntegration.provider, "slack"),
      ),
    )
    .limit(1);
  return settings ?? null;
}
