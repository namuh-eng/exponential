import { createHash, randomBytes } from "node:crypto";
import { getRequestAppUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import {
  customView,
  initiative,
  initiativeTeam,
  issue,
  member,
  project,
  projectTeam,
  team,
  teamMember,
  user,
  workflowState,
  workspace,
  workspaceIntegration,
} from "@/lib/db/schema";
import {
  getPathSegments,
  normalizeAppPath,
  withWorkspaceSlug,
} from "@/lib/workspace-paths";
import { and, eq, or } from "drizzle-orm";

const NOTION_TOKEN_PREFIX = "notion_unfurl_";
const DESCRIPTION_LIMIT = 220;

type NotionPreviewUser = {
  userId: string;
  tokenHash: string;
  createdAt?: string;
  revokedAt?: string | null;
};

type NotionIntegrationMetadata = {
  linkPreviews?: {
    users?: NotionPreviewUser[];
  };
};

type AuthorizedNotionPreviewUser = {
  userId: string;
  workspaceId: string;
  workspaceSlug: string;
  role: string;
};

export type ParsedExponentialResource =
  | {
      type: "issue";
      workspaceSlug: string | null;
      teamKey: string | null;
      identifier: string;
    }
  | { type: "project"; workspaceSlug: string | null; slug: string }
  | { type: "initiative"; workspaceSlug: string | null; id: string }
  | {
      type: "view";
      workspaceSlug: string | null;
      id: string | null;
      teamKey: string | null;
      tab: string | null;
    };

export type NotionUnfurlPayload = {
  type: "rich_preview" | "mention";
  provider: "Exponential";
  authorized: boolean;
  title: string;
  description: string;
  url: string;
  iconUrl: string;
  updatedAt: string | null;
  attributes: Array<{ label: string; value: string }>;
};

type NotionColor = {
  r: number;
  g: number;
  b: number;
};

type NotionUnfurlAttribute = {
  id: string;
  name: string;
  type: "inline";
  inline: {
    title?: { value: string; section: "title" };
    plain_text?: { value: string; section: "body" | "secondary" };
    enum?: {
      value: string;
      color?: NotionColor;
      section: "identifier" | "primary" | "secondary";
    };
    datetime?: { value: string; section: "secondary" };
  };
};

export type NotionUnfurlResponse = {
  uri: string;
  operations: Array<
    | { path: ["attributes"]; set: NotionUnfurlAttribute[] }
    | { path: ["error"]; set: { status: number; message: string } }
  >;
};

export function createNotionPreviewToken() {
  return `${NOTION_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function hashNotionPreviewToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeMetadata(value: unknown): NotionIntegrationMetadata {
  if (!isRecord(value)) return {};
  const linkPreviews = value.linkPreviews;
  if (!isRecord(linkPreviews)) return {};
  const users = Array.isArray(linkPreviews.users)
    ? linkPreviews.users.filter((entry): entry is NotionPreviewUser => {
        if (!isRecord(entry)) return false;
        return (
          typeof entry.userId === "string" &&
          typeof entry.tokenHash === "string"
        );
      })
    : [];
  return { linkPreviews: { users } };
}

export function upsertNotionPreviewUser(
  metadata: unknown,
  userId: string,
  tokenHash: string,
  createdAt = new Date().toISOString(),
): NotionIntegrationMetadata {
  const current = normalizeMetadata(metadata);
  const users = current.linkPreviews?.users ?? [];
  return {
    ...current,
    linkPreviews: {
      ...current.linkPreviews,
      users: [
        {
          userId,
          tokenHash,
          createdAt,
          revokedAt: null,
        },
        ...users.filter((entry) => entry.userId !== userId),
      ],
    },
  };
}

export function revokeNotionPreviewUser(metadata: unknown, userId: string) {
  const current = normalizeMetadata(metadata);
  const users = current.linkPreviews?.users ?? [];
  const revokedAt = new Date().toISOString();
  return {
    ...current,
    linkPreviews: {
      ...current.linkPreviews,
      users: users.map((entry) =>
        entry.userId === userId ? { ...entry, revokedAt } : entry,
      ),
    },
  };
}

export function hasActiveNotionPreviewUser(metadata: unknown, userId: string) {
  return Boolean(
    normalizeMetadata(metadata).linkPreviews?.users?.some(
      (entry) => entry.userId === userId && !entry.revokedAt,
    ),
  );
}

export function hasActiveNotionPreviewUsers(metadata: unknown) {
  return Boolean(
    normalizeMetadata(metadata).linkPreviews?.users?.some(
      (entry) => !entry.revokedAt,
    ),
  );
}

export function findNotionPreviewUser(metadata: unknown, token: string) {
  const tokenHash = hashNotionPreviewToken(token);
  return (
    normalizeMetadata(metadata).linkPreviews?.users?.find(
      (entry) => entry.tokenHash === tokenHash && !entry.revokedAt,
    ) ?? null
  );
}

export function parseExponentialResourceUrl(
  rawUrl: string,
): ParsedExponentialResource | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const segments = getPathSegments(url.pathname);
  const normalizedPath = normalizeAppPath(url.pathname);
  const normalizedSegments = getPathSegments(normalizedPath);
  const workspaceSlug =
    normalizedSegments.length === segments.length ? null : segments[0] || null;

  const [first, second, third, fourth] = normalizedSegments;
  if (first === "team" && second && third === "issue" && fourth) {
    return {
      type: "issue",
      workspaceSlug,
      teamKey: second,
      identifier: fourth,
    };
  }

  if (first === "issue" && second) {
    return {
      type: "issue",
      workspaceSlug,
      teamKey: null,
      identifier: second,
    };
  }

  if (first === "project" && second) {
    return { type: "project", workspaceSlug, slug: second };
  }

  if (first === "initiatives" && second) {
    return { type: "initiative", workspaceSlug, id: second };
  }

  if (first === "team" && second && third === "views") {
    return {
      type: "view",
      workspaceSlug,
      id: url.searchParams.get("viewId") ?? url.searchParams.get("id"),
      teamKey: second,
      tab: fourth ?? null,
    };
  }

  if (first === "views") {
    return {
      type: "view",
      workspaceSlug,
      id:
        url.searchParams.get("viewId") ??
        url.searchParams.get("id") ??
        (second && !["all", "issues", "projects"].includes(second)
          ? second
          : null),
      teamKey: null,
      tab:
        second && ["all", "issues", "projects"].includes(second)
          ? second
          : null,
    };
  }

  return null;
}

export function isSupportedExponentialPreviewUrl(
  rawUrl: string,
  request: Request,
) {
  try {
    return new URL(rawUrl).origin === new URL(getRequestAppUrl(request)).origin;
  } catch {
    return false;
  }
}

function stripRichText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[#*_>\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function previewDescription(
  fallback: string,
  richText?: string | null,
  limit = DESCRIPTION_LIMIT,
) {
  const text = stripRichText(richText) || fallback;
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}...` : text;
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function buildIconUrl(request: Request) {
  return new URL("/favicon.ico", getRequestAppUrl(request)).toString();
}

export function buildUnauthorizedNotionPreview(
  rawUrl: string,
  request: Request,
): NotionUnfurlPayload {
  return {
    type: "mention",
    provider: "Exponential",
    authorized: false,
    title: "Exponential link",
    description: "Sign in to Exponential to preview this private link.",
    url: rawUrl,
    iconUrl: buildIconUrl(request),
    updatedAt: null,
    attributes: [],
  };
}

function buildPreview(
  payload: Omit<NotionUnfurlPayload, "provider" | "iconUrl">,
  request: Request,
) {
  return {
    ...payload,
    provider: "Exponential" as const,
    iconUrl: buildIconUrl(request),
  };
}

function slugifyAttributeId(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "attribute";
}

export function toNotionUnfurlResponse(
  uri: string,
  preview: NotionUnfurlPayload,
): NotionUnfurlResponse {
  const attributes: NotionUnfurlAttribute[] = [
    {
      id: "title",
      name: "Title",
      type: "inline",
      inline: {
        title: {
          value: preview.title,
          section: "title",
        },
      },
    },
    {
      id: "dev",
      name: "Developer Name",
      type: "inline",
      inline: {
        plain_text: {
          value: preview.provider,
          section: "secondary",
        },
      },
    },
  ];

  if (preview.description) {
    attributes.push({
      id: "description",
      name: "Description",
      type: "inline",
      inline: {
        plain_text: {
          value: preview.description,
          section: "body",
        },
      },
    });
  }

  for (const attribute of preview.attributes) {
    attributes.push({
      id: slugifyAttributeId(attribute.label),
      name: attribute.label,
      type: "inline",
      inline: {
        enum: {
          value: attribute.value,
          section: attribute.label === "Type" ? "identifier" : "primary",
        },
      },
    });
  }

  if (preview.updatedAt) {
    attributes.push({
      id: "updated_at",
      name: "Updated At",
      type: "inline",
      inline: {
        datetime: {
          value: preview.updatedAt,
          section: "secondary",
        },
      },
    });
  }

  return {
    uri,
    operations: [{ path: ["attributes"], set: attributes }],
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function authorizeNotionToken(
  token: string | null,
): Promise<AuthorizedNotionPreviewUser | null> {
  if (!token?.startsWith(NOTION_TOKEN_PREFIX)) {
    return null;
  }

  const integrations = await db
    .select({
      workspaceId: workspaceIntegration.workspaceId,
      workspaceSlug: workspace.urlSlug,
      metadata: workspaceIntegration.metadata,
    })
    .from(workspaceIntegration)
    .innerJoin(workspace, eq(workspaceIntegration.workspaceId, workspace.id))
    .where(
      and(
        eq(workspaceIntegration.provider, "notion"),
        eq(workspaceIntegration.status, "connected"),
      ),
    )
    .limit(1000);

  for (const integration of integrations) {
    const previewUser = findNotionPreviewUser(integration.metadata, token);
    if (previewUser) {
      const [membership] = await db
        .select({ role: member.role })
        .from(member)
        .where(
          and(
            eq(member.userId, previewUser.userId),
            eq(member.workspaceId, integration.workspaceId),
          ),
        )
        .limit(1);

      if (!membership) {
        return null;
      }

      return {
        userId: previewUser.userId,
        workspaceId: integration.workspaceId,
        workspaceSlug: integration.workspaceSlug,
        role: membership.role,
      };
    }
  }

  return null;
}

async function hasPrivateTeamAccess(userId: string, teamId: string) {
  const rows = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.userId, userId), eq(teamMember.teamId, teamId)))
    .limit(1);
  return rows.length > 0;
}

function hasWorkspaceAdminAccess(access: { role: string }) {
  return access.role === "owner" || access.role === "admin";
}

export function canPreviewNotionView(
  access: Pick<AuthorizedNotionPreviewUser, "role" | "userId">,
  view: {
    isPersonal: boolean | null;
    ownerId: string;
    teamId: string | null;
    teamIsPrivate: boolean | null;
  },
  hasPrivateTeamMembership: boolean,
) {
  if (view.isPersonal && view.ownerId !== access.userId) {
    return false;
  }

  return (
    !view.teamId ||
    !view.teamIsPrivate ||
    hasWorkspaceAdminAccess(access) ||
    hasPrivateTeamMembership
  );
}

async function hasProjectTeamAccess(userId: string, projectId: string) {
  const rows = await db
    .select({
      teamId: team.id,
      isPrivate: team.isPrivate,
      memberId: teamMember.id,
    })
    .from(projectTeam)
    .innerJoin(team, eq(projectTeam.teamId, team.id))
    .leftJoin(
      teamMember,
      and(eq(teamMember.teamId, team.id), eq(teamMember.userId, userId)),
    )
    .where(eq(projectTeam.projectId, projectId));

  return rows.every((row) => !row.isPrivate || Boolean(row.memberId));
}

async function hasInitiativeTeamAccess(userId: string, initiativeId: string) {
  const rows = await db
    .select({
      teamId: team.id,
      isPrivate: team.isPrivate,
      memberId: teamMember.id,
    })
    .from(initiativeTeam)
    .innerJoin(team, eq(initiativeTeam.teamId, team.id))
    .leftJoin(
      teamMember,
      and(eq(teamMember.teamId, team.id), eq(teamMember.userId, userId)),
    )
    .where(eq(initiativeTeam.initiativeId, initiativeId));

  return rows.every((row) => !row.isPrivate || Boolean(row.memberId));
}

async function resolveIssuePreview(
  resource: Extract<ParsedExponentialResource, { type: "issue" }>,
  access: AuthorizedNotionPreviewUser,
  rawUrl: string,
  request: Request,
) {
  const identityCondition = isUuid(resource.identifier)
    ? or(
        eq(issue.id, resource.identifier),
        eq(issue.identifier, resource.identifier),
      )
    : eq(issue.identifier, resource.identifier);
  const conditions = [
    eq(team.workspaceId, access.workspaceId),
    identityCondition,
    resource.teamKey ? eq(team.key, resource.teamKey) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      priority: issue.priority,
      dueDate: issue.dueDate,
      updatedAt: issue.updatedAt,
      teamId: team.id,
      teamKey: team.key,
      teamName: team.name,
      teamIsPrivate: team.isPrivate,
      stateName: workflowState.name,
      stateCategory: workflowState.category,
      projectName: project.name,
      assigneeName: user.name,
    })
    .from(issue)
    .innerJoin(team, eq(issue.teamId, team.id))
    .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
    .leftJoin(project, eq(issue.projectId, project.id))
    .leftJoin(user, eq(issue.assigneeId, user.id))
    .where(and(...conditions))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (
    row.teamIsPrivate &&
    !hasWorkspaceAdminAccess(access) &&
    !(await hasPrivateTeamAccess(access.userId, row.teamId))
  ) {
    return buildUnauthorizedNotionPreview(rawUrl, request);
  }

  return buildPreview(
    {
      type: "rich_preview",
      authorized: true,
      title: `${row.identifier} ${row.title}`,
      description: previewDescription(
        `${row.teamName} issue in ${row.stateName}`,
        row.description,
      ),
      url: withWorkspaceSlug(
        `/team/${encodeURIComponent(row.teamKey)}/issue/${encodeURIComponent(row.identifier)}`,
        access.workspaceSlug,
      ),
      updatedAt: isoDate(row.updatedAt),
      attributes: [
        { label: "Type", value: "Issue" },
        { label: "Status", value: row.stateName },
        { label: "Team", value: row.teamName },
        { label: "Priority", value: row.priority },
        ...(row.assigneeName
          ? [{ label: "Assignee", value: row.assigneeName }]
          : []),
        ...(row.projectName
          ? [{ label: "Project", value: row.projectName }]
          : []),
        ...(row.dueDate
          ? [{ label: "Due", value: row.dueDate.toISOString().slice(0, 10) }]
          : []),
      ],
    },
    request,
  );
}

async function resolveProjectPreview(
  resource: Extract<ParsedExponentialResource, { type: "project" }>,
  access: AuthorizedNotionPreviewUser,
  rawUrl: string,
  request: Request,
) {
  const rows = await db
    .select({
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      priority: project.priority,
      targetDate: project.targetDate,
      updatedAt: project.updatedAt,
      leadName: user.name,
    })
    .from(project)
    .leftJoin(user, eq(project.leadId, user.id))
    .where(
      and(
        eq(project.workspaceId, access.workspaceId),
        eq(project.slug, resource.slug),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (
    !hasWorkspaceAdminAccess(access) &&
    !(await hasProjectTeamAccess(access.userId, row.id))
  ) {
    return buildUnauthorizedNotionPreview(rawUrl, request);
  }

  return buildPreview(
    {
      type: "rich_preview",
      authorized: true,
      title: row.name,
      description: previewDescription(
        `Project status: ${row.status}`,
        row.description,
      ),
      url: withWorkspaceSlug(
        `/project/${encodeURIComponent(resource.slug)}/overview`,
        access.workspaceSlug,
      ),
      updatedAt: isoDate(row.updatedAt),
      attributes: [
        { label: "Type", value: "Project" },
        { label: "Status", value: row.status },
        { label: "Priority", value: row.priority },
        ...(row.leadName ? [{ label: "Lead", value: row.leadName }] : []),
        ...(row.targetDate
          ? [
              {
                label: "Target",
                value: row.targetDate.toISOString().slice(0, 10),
              },
            ]
          : []),
      ],
    },
    request,
  );
}

async function resolveInitiativePreview(
  resource: Extract<ParsedExponentialResource, { type: "initiative" }>,
  access: AuthorizedNotionPreviewUser,
  rawUrl: string,
  request: Request,
) {
  const rows = await db
    .select({
      id: initiative.id,
      name: initiative.name,
      description: initiative.description,
      status: initiative.status,
      health: initiative.health,
      timeframe: initiative.timeframe,
      targetDate: initiative.targetDate,
      updatedAt: initiative.updatedAt,
      ownerName: user.name,
    })
    .from(initiative)
    .leftJoin(user, eq(initiative.ownerId, user.id))
    .where(
      and(
        eq(initiative.workspaceId, access.workspaceId),
        eq(initiative.id, resource.id),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (
    !hasWorkspaceAdminAccess(access) &&
    !(await hasInitiativeTeamAccess(access.userId, row.id))
  ) {
    return buildUnauthorizedNotionPreview(rawUrl, request);
  }

  return buildPreview(
    {
      type: "rich_preview",
      authorized: true,
      title: row.name,
      description: previewDescription(
        `Initiative status: ${row.status}`,
        row.description,
      ),
      url: withWorkspaceSlug(`/initiatives/${row.id}`, access.workspaceSlug),
      updatedAt: isoDate(row.updatedAt),
      attributes: [
        { label: "Type", value: "Initiative" },
        { label: "Status", value: row.status },
        { label: "Health", value: row.health },
        ...(row.ownerName ? [{ label: "Owner", value: row.ownerName }] : []),
        ...(row.timeframe
          ? [{ label: "Timeframe", value: row.timeframe }]
          : []),
        ...(row.targetDate
          ? [
              {
                label: "Target",
                value: row.targetDate.toISOString().slice(0, 10),
              },
            ]
          : []),
      ],
    },
    request,
  );
}

async function resolveViewPreview(
  resource: Extract<ParsedExponentialResource, { type: "view" }>,
  access: AuthorizedNotionPreviewUser,
  rawUrl: string,
  request: Request,
) {
  if (!resource.id) {
    const label =
      resource.tab === "projects"
        ? "Project views"
        : resource.tab === "issues"
          ? "Issue views"
          : "Views";
    return buildPreview(
      {
        type: "rich_preview",
        authorized: true,
        title: resource.teamKey ? `${resource.teamKey} ${label}` : label,
        description:
          "Saved Exponential views for focused issue and project work.",
        url: withWorkspaceSlug(
          resource.teamKey
            ? `/team/${encodeURIComponent(resource.teamKey)}/views${resource.tab ? `/${resource.tab}` : ""}`
            : `/views${resource.tab ? `/${resource.tab}` : ""}`,
          access.workspaceSlug,
        ),
        updatedAt: null,
        attributes: [{ label: "Type", value: "View" }],
      },
      request,
    );
  }

  const rows = await db
    .select({
      id: customView.id,
      name: customView.name,
      layout: customView.layout,
      isPersonal: customView.isPersonal,
      ownerId: customView.ownerId,
      updatedAt: customView.updatedAt,
      teamId: customView.teamId,
      teamKey: team.key,
      teamName: team.name,
      teamIsPrivate: team.isPrivate,
      ownerName: user.name,
    })
    .from(customView)
    .leftJoin(team, eq(customView.teamId, team.id))
    .leftJoin(user, eq(customView.ownerId, user.id))
    .where(
      and(
        eq(customView.workspaceId, access.workspaceId),
        eq(customView.id, resource.id),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const hasPrivateTeamMembership =
    row.teamId && row.teamIsPrivate
      ? await hasPrivateTeamAccess(access.userId, row.teamId)
      : true;

  if (!canPreviewNotionView(access, row, hasPrivateTeamMembership)) {
    return buildUnauthorizedNotionPreview(rawUrl, request);
  }

  return buildPreview(
    {
      type: "rich_preview",
      authorized: true,
      title: row.name,
      description: `${row.isPersonal ? "Personal" : "Shared"} ${row.layout} view${row.teamName ? ` for ${row.teamName}` : ""}.`,
      url: withWorkspaceSlug(
        row.teamKey
          ? `/team/${encodeURIComponent(row.teamKey)}/views`
          : "/views",
        access.workspaceSlug,
      ),
      updatedAt: isoDate(row.updatedAt),
      attributes: [
        { label: "Type", value: "View" },
        { label: "Layout", value: row.layout },
        { label: "Visibility", value: row.isPersonal ? "Personal" : "Shared" },
        ...(row.ownerName ? [{ label: "Owner", value: row.ownerName }] : []),
        ...(row.teamName ? [{ label: "Team", value: row.teamName }] : []),
      ],
    },
    request,
  );
}

export function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return null;
  const [scheme, ...tokenParts] = authorization.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return null;
  return tokenParts.join(" ").trim() || null;
}

export async function resolveNotionUnfurl(
  rawUrl: string,
  token: string | null,
  request: Request,
) {
  const resource = parseExponentialResourceUrl(rawUrl);
  if (!resource || !isSupportedExponentialPreviewUrl(rawUrl, request)) {
    return buildUnauthorizedNotionPreview(rawUrl, request);
  }

  const access = await authorizeNotionToken(token);
  if (!access) {
    return buildUnauthorizedNotionPreview(rawUrl, request);
  }

  if (
    resource.workspaceSlug &&
    resource.workspaceSlug !== access.workspaceSlug
  ) {
    return buildUnauthorizedNotionPreview(rawUrl, request);
  }

  const preview =
    resource.type === "issue"
      ? await resolveIssuePreview(resource, access, rawUrl, request)
      : resource.type === "project"
        ? await resolveProjectPreview(resource, access, rawUrl, request)
        : resource.type === "initiative"
          ? await resolveInitiativePreview(resource, access, rawUrl, request)
          : await resolveViewPreview(resource, access, rawUrl, request);

  return preview ?? buildUnauthorizedNotionPreview(rawUrl, request);
}
