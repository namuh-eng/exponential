import { db } from "@/lib/db";
import {
  initiative,
  initiativeProject,
  initiativeTeam,
  issue,
  project,
  projectTeam,
  team,
  workflowState,
  workspace,
  workspaceIntegration,
} from "@/lib/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getGoogleOAuthConfig } from "./auth-providers";

export const GOOGLE_SHEETS_PROVIDER = "google_sheets";
export const GOOGLE_SHEETS_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export const GOOGLE_SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
] as const;

const GOOGLE_SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKEN_REFRESH_SKEW_MS = 60 * 1000;

export type GoogleSheetsExportScope = "issues" | "projects" | "initiatives";

export type GoogleSheetsSyncSettings = {
  scopes: Record<GoogleSheetsExportScope, boolean>;
  includePrivateTeams: boolean;
  schedule: "hourly";
  enabled: boolean;
};

export type GoogleSheetsMetadata = GoogleSheetsSyncSettings & {
  spreadsheetId: string;
  spreadsheetUrl: string;
  spreadsheetTitle: string;
  googleSpreadsheetCreated: boolean;
  connectedMode: "workspace_oauth" | "development";
  oauthScopes: string[];
  accessToken: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
  rowCounts: Record<GoogleSheetsExportScope, number>;
  sheetSchemas: Record<GoogleSheetsExportScope, string[]>;
  updatedAt: string;
};

export const GOOGLE_SHEETS_SHEET_SCHEMAS: Record<
  GoogleSheetsExportScope,
  string[]
> = {
  issues: [
    "Issue ID",
    "Identifier",
    "Title",
    "Team",
    "Team Name",
    "State",
    "State Category",
    "Priority",
    "Estimate",
    "Project ID",
    "Project",
    "Assignee ID",
    "Created At",
    "Updated At",
    "Completed At",
    "Canceled At",
    "Archived At",
  ],
  projects: [
    "Project ID",
    "Name",
    "Slug",
    "Status",
    "Priority",
    "Team Keys",
    "Lead ID",
    "Start Date",
    "Target Date",
    "Completed At",
    "Canceled At",
    "Created At",
    "Updated At",
  ],
  initiatives: [
    "Initiative ID",
    "Name",
    "Status",
    "Health",
    "Team Keys",
    "Project Slugs",
    "Owner ID",
    "Start Date",
    "Target Date",
    "Timeframe",
    "Created At",
    "Updated At",
  ],
};

type WorkspaceAccess = {
  workspaceId: string;
  workspaceSlug: string;
};

type SheetWriteResult = {
  spreadsheetId: string;
  spreadsheetUrl: string;
  spreadsheetTitle: string;
  metadataPatch?: Partial<GoogleSheetsMetadata>;
  rowCounts: Record<GoogleSheetsExportScope, number>;
  sheetSchemas: Record<GoogleSheetsExportScope, string[]>;
};

type SheetRows = Record<GoogleSheetsExportScope, string[][]>;

const GOOGLE_SHEETS_TITLES: Record<GoogleSheetsExportScope, string> = {
  issues: "Issues",
  projects: "Projects",
  initiatives: "Initiatives",
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asIsoString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function formatCell(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return "";
  return String(value);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function nextHourlyRun(now: Date) {
  return new Date(now.getTime() + GOOGLE_SHEETS_REFRESH_INTERVAL_MS);
}

function makeSpreadsheetId(workspaceId: string) {
  return `exp_${workspaceId.replaceAll("-", "").slice(0, 24)}`;
}

export function normalizeGoogleSheetsSettings(
  value: unknown,
): GoogleSheetsSyncSettings {
  const raw = asRecord(value);
  const rawScopes = asRecord(raw.scopes);
  return {
    scopes: {
      issues: asBoolean(rawScopes.issues, true),
      projects: asBoolean(rawScopes.projects, true),
      initiatives: asBoolean(rawScopes.initiatives, true),
    },
    includePrivateTeams: asBoolean(raw.includePrivateTeams, false),
    schedule: "hourly",
    enabled: asBoolean(raw.enabled, true),
  };
}

export function hasEnabledGoogleSheetsScope(
  settings: Pick<GoogleSheetsSyncSettings, "scopes">,
) {
  return (
    settings.scopes.issues ||
    settings.scopes.projects ||
    settings.scopes.initiatives
  );
}

export function normalizeGoogleSheetsMetadata(
  value: unknown,
  access: WorkspaceAccess,
): GoogleSheetsMetadata {
  const raw = asRecord(value);
  const settings = normalizeGoogleSheetsSettings(raw);
  const spreadsheetId =
    typeof raw.spreadsheetId === "string" && raw.spreadsheetId
      ? raw.spreadsheetId
      : makeSpreadsheetId(access.workspaceId);
  const rowCounts = asRecord(raw.rowCounts);
  return {
    ...settings,
    spreadsheetId,
    spreadsheetUrl:
      typeof raw.spreadsheetUrl === "string" && raw.spreadsheetUrl
        ? raw.spreadsheetUrl
        : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    spreadsheetTitle:
      typeof raw.spreadsheetTitle === "string" && raw.spreadsheetTitle
        ? raw.spreadsheetTitle
        : `${access.workspaceSlug} analytics`,
    googleSpreadsheetCreated: asBoolean(raw.googleSpreadsheetCreated, false),
    connectedMode:
      raw.connectedMode === "workspace_oauth"
        ? "workspace_oauth"
        : "development",
    oauthScopes: Array.isArray(raw.oauthScopes)
      ? raw.oauthScopes.filter(
          (scope): scope is string => typeof scope === "string",
        )
      : [...GOOGLE_SHEETS_SCOPES],
    accessToken:
      typeof raw.accessToken === "string" && raw.accessToken
        ? raw.accessToken
        : null,
    refreshToken:
      typeof raw.refreshToken === "string" && raw.refreshToken
        ? raw.refreshToken
        : null,
    accessTokenExpiresAt: asIsoString(raw.accessTokenExpiresAt),
    lastSuccessAt: asIsoString(raw.lastSuccessAt),
    lastErrorAt: asIsoString(raw.lastErrorAt),
    lastError: asIsoString(raw.lastError),
    nextRunAt: asIsoString(raw.nextRunAt),
    rowCounts: {
      issues: typeof rowCounts.issues === "number" ? rowCounts.issues : 0,
      projects: typeof rowCounts.projects === "number" ? rowCounts.projects : 0,
      initiatives:
        typeof rowCounts.initiatives === "number" ? rowCounts.initiatives : 0,
    },
    sheetSchemas: GOOGLE_SHEETS_SHEET_SCHEMAS,
    updatedAt: asIsoString(raw.updatedAt) ?? new Date().toISOString(),
  };
}

export function serializeGoogleSheetsIntegration(
  integration: {
    id: string;
    provider: string;
    status: string;
    displayName: string | null;
    externalId: string | null;
    connectedAt: Date | string | null;
    metadata: unknown;
  },
  access: WorkspaceAccess,
) {
  const metadata = normalizeGoogleSheetsMetadata(integration.metadata, access);
  return {
    id: integration.id,
    provider: integration.provider,
    status: integration.status,
    displayName: integration.displayName,
    externalId: integration.externalId,
    connectedAt: integration.connectedAt
      ? new Date(integration.connectedAt).toISOString()
      : null,
    details: {
      spreadsheetId: metadata.spreadsheetId,
      spreadsheetUrl: metadata.spreadsheetUrl,
      spreadsheetTitle: metadata.spreadsheetTitle,
      scopes: metadata.scopes,
      includePrivateTeams: metadata.includePrivateTeams,
      schedule: metadata.schedule,
      enabled: metadata.enabled,
      lastSuccessAt: metadata.lastSuccessAt,
      lastErrorAt: metadata.lastErrorAt,
      lastError: metadata.lastError,
      nextRunAt: metadata.nextRunAt,
      rowCounts: metadata.rowCounts,
      sheetSchemas: metadata.sheetSchemas,
    },
  };
}

async function collectSheetRows(
  workspaceId: string,
  settings: GoogleSheetsSyncSettings,
): Promise<SheetRows> {
  const teams = await db
    .select({
      id: team.id,
      key: team.key,
      name: team.name,
      isPrivate: team.isPrivate,
    })
    .from(team)
    .where(eq(team.workspaceId, workspaceId))
    .orderBy(asc(team.key));
  const visibleTeams = settings.includePrivateTeams
    ? teams
    : teams.filter((record) => !record.isPrivate);
  const visibleTeamIds = visibleTeams.map((record) => record.id);
  const visibleTeamById = new Map(
    visibleTeams.map((record) => [record.id, record]),
  );

  const needsProjectMetadata =
    settings.scopes.issues ||
    settings.scopes.projects ||
    settings.scopes.initiatives;

  const issueRows = settings.scopes.issues
    ? visibleTeamIds.length
      ? await db
          .select({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            teamId: issue.teamId,
            teamKey: team.key,
            teamName: team.name,
            stateName: workflowState.name,
            stateCategory: workflowState.category,
            priority: issue.priority,
            estimate: issue.estimate,
            projectId: issue.projectId,
            projectName: project.name,
            assigneeId: issue.assigneeId,
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
            completedAt: issue.completedAt,
            canceledAt: issue.canceledAt,
            archivedAt: issue.archivedAt,
          })
          .from(issue)
          .innerJoin(team, eq(issue.teamId, team.id))
          .innerJoin(workflowState, eq(issue.stateId, workflowState.id))
          .leftJoin(project, eq(issue.projectId, project.id))
          .where(inArray(issue.teamId, visibleTeamIds))
          .orderBy(asc(team.key), asc(issue.number))
      : []
    : [];

  const projects = needsProjectMetadata
    ? await db
        .select({
          id: project.id,
          name: project.name,
          slug: project.slug,
          status: project.status,
          priority: project.priority,
          leadId: project.leadId,
          startDate: project.startDate,
          targetDate: project.targetDate,
          completedAt: project.completedAt,
          canceledAt: project.canceledAt,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })
        .from(project)
        .where(eq(project.workspaceId, workspaceId))
        .orderBy(asc(project.name))
    : [];

  const projectLinks = needsProjectMetadata
    ? await db
        .select({
          projectId: projectTeam.projectId,
          teamId: team.id,
          teamKey: team.key,
          isPrivate: team.isPrivate,
        })
        .from(projectTeam)
        .innerJoin(team, eq(projectTeam.teamId, team.id))
        .where(eq(team.workspaceId, workspaceId))
    : [];

  const projectTeams = new Map<
    string,
    Array<{ teamId: string; teamKey: string; isPrivate: boolean | null }>
  >();
  for (const link of projectLinks) {
    const list = projectTeams.get(link.projectId) ?? [];
    list.push(link);
    projectTeams.set(link.projectId, list);
  }

  const visibleProjectIds = new Set(
    projects
      .filter((record) => {
        const links = projectTeams.get(record.id) ?? [];
        if (settings.includePrivateTeams || links.length === 0) return true;
        return links.some((link) => !link.isPrivate);
      })
      .map((record) => record.id),
  );
  const visibleProjectSlugById = new Map(
    projects
      .filter((record) => visibleProjectIds.has(record.id))
      .map((record) => [record.id, record.slug]),
  );

  const initiatives = settings.scopes.initiatives
    ? await db
        .select({
          id: initiative.id,
          name: initiative.name,
          status: initiative.status,
          health: initiative.health,
          ownerId: initiative.ownerId,
          startDate: initiative.startDate,
          targetDate: initiative.targetDate,
          timeframe: initiative.timeframe,
          createdAt: initiative.createdAt,
          updatedAt: initiative.updatedAt,
        })
        .from(initiative)
        .where(eq(initiative.workspaceId, workspaceId))
        .orderBy(asc(initiative.name))
    : [];

  const initiativeTeamLinks = settings.scopes.initiatives
    ? await db
        .select({
          initiativeId: initiativeTeam.initiativeId,
          teamId: team.id,
          teamKey: team.key,
          isPrivate: team.isPrivate,
        })
        .from(initiativeTeam)
        .innerJoin(team, eq(initiativeTeam.teamId, team.id))
        .where(eq(team.workspaceId, workspaceId))
    : [];
  const initiativeProjectLinks = settings.scopes.initiatives
    ? await db
        .select({
          initiativeId: initiativeProject.initiativeId,
          projectId: initiativeProject.projectId,
        })
        .from(initiativeProject)
        .innerJoin(project, eq(initiativeProject.projectId, project.id))
        .where(eq(project.workspaceId, workspaceId))
    : [];

  const initiativeTeams = new Map<
    string,
    Array<{ teamId: string; teamKey: string; isPrivate: boolean | null }>
  >();
  for (const link of initiativeTeamLinks) {
    const list = initiativeTeams.get(link.initiativeId) ?? [];
    list.push(link);
    initiativeTeams.set(link.initiativeId, list);
  }
  const initiativeProjects = new Map<string, string[]>();
  for (const link of initiativeProjectLinks) {
    const slug = visibleProjectSlugById.get(link.projectId);
    if (!slug) continue;
    const list = initiativeProjects.get(link.initiativeId) ?? [];
    list.push(slug);
    initiativeProjects.set(link.initiativeId, list);
  }

  return {
    issues: issueRows.map((record) => {
      const canExposeProject =
        record.projectId === null || visibleProjectIds.has(record.projectId);
      return [
        formatCell(record.id),
        formatCell(record.identifier),
        formatCell(record.title),
        formatCell(record.teamKey),
        formatCell(record.teamName),
        formatCell(record.stateName),
        formatCell(record.stateCategory),
        formatCell(record.priority),
        formatCell(record.estimate),
        canExposeProject ? formatCell(record.projectId) : "",
        canExposeProject ? formatCell(record.projectName) : "",
        formatCell(record.assigneeId),
        formatCell(record.createdAt),
        formatCell(record.updatedAt),
        formatCell(record.completedAt),
        formatCell(record.canceledAt),
        formatCell(record.archivedAt),
      ];
    }),
    projects: settings.scopes.projects
      ? projects
          .filter((record) => visibleProjectIds.has(record.id))
          .map((record) => {
            const links = projectTeams.get(record.id) ?? [];
            const teamKeys = unique(
              links
                .filter(
                  (link) =>
                    settings.includePrivateTeams ||
                    visibleTeamById.has(link.teamId),
                )
                .map((link) => link.teamKey),
            );
            return [
              formatCell(record.id),
              formatCell(record.name),
              formatCell(record.slug),
              formatCell(record.status),
              formatCell(record.priority),
              teamKeys.join(", "),
              formatCell(record.leadId),
              formatCell(record.startDate),
              formatCell(record.targetDate),
              formatCell(record.completedAt),
              formatCell(record.canceledAt),
              formatCell(record.createdAt),
              formatCell(record.updatedAt),
            ];
          })
      : [],
    initiatives: initiatives
      .filter((record) => {
        const links = initiativeTeams.get(record.id) ?? [];
        if (settings.includePrivateTeams || links.length === 0) return true;
        return links.some((link) => !link.isPrivate);
      })
      .map((record) => {
        const links = initiativeTeams.get(record.id) ?? [];
        const teamKeys = unique(
          links
            .filter(
              (link) =>
                settings.includePrivateTeams ||
                visibleTeamById.has(link.teamId),
            )
            .map((link) => link.teamKey),
        );
        return [
          formatCell(record.id),
          formatCell(record.name),
          formatCell(record.status),
          formatCell(record.health),
          teamKeys.join(", "),
          unique(initiativeProjects.get(record.id) ?? []).join(", "),
          formatCell(record.ownerId),
          formatCell(record.startDate),
          formatCell(record.targetDate),
          formatCell(record.timeframe),
          formatCell(record.createdAt),
          formatCell(record.updatedAt),
        ];
      }),
  };
}

function enabledGoogleSheetsScopes(settings: GoogleSheetsSyncSettings) {
  return (
    Object.entries(settings.scopes) as Array<[GoogleSheetsExportScope, boolean]>
  )
    .filter(([, enabled]) => enabled)
    .map(([scope]) => scope);
}

function getGoogleAccessToken(metadata: GoogleSheetsMetadata) {
  if (metadata.connectedMode !== "workspace_oauth") return null;
  return metadata.accessToken;
}

async function refreshGoogleAccessTokenIfNeeded(
  metadata: GoogleSheetsMetadata,
  now: Date,
) {
  if (metadata.connectedMode !== "workspace_oauth") return metadata;

  const expiresAt = metadata.accessTokenExpiresAt
    ? Date.parse(metadata.accessTokenExpiresAt)
    : null;
  if (
    metadata.accessToken &&
    (!expiresAt || expiresAt - now.getTime() > GOOGLE_TOKEN_REFRESH_SKEW_MS)
  ) {
    return metadata;
  }

  if (!metadata.refreshToken) {
    if (metadata.accessToken) return metadata;
    throw new Error("Google Sheets refresh token is missing.");
  }

  const google = getGoogleOAuthConfig();
  if (!google) {
    throw new Error("Google OAuth is not configured.");
  }

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: google.clientId,
      client_secret: google.clientSecret,
      grant_type: "refresh_token",
      refresh_token: metadata.refreshToken,
    }),
  });
  if (!response.ok) {
    throw new Error("Google access token refresh failed.");
  }

  const token = (await response.json()) as GoogleTokenResponse;
  if (!token.access_token) {
    throw new Error("Google access token refresh returned no token.");
  }

  return {
    ...metadata,
    accessToken: token.access_token,
    accessTokenExpiresAt: new Date(
      now.getTime() + (token.expires_in ?? 3600) * 1000,
    ).toISOString(),
    oauthScopes: token.scope?.split(" ") ?? metadata.oauthScopes,
  };
}

async function fetchGoogleSheetsJson<T>(
  url: string,
  accessToken: string,
  init?: RequestInit,
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Google Sheets API request failed: ${response.status}`);
  }
  return (await response.json().catch(() => ({}))) as T;
}

async function createGoogleSpreadsheet(
  access: WorkspaceAccess,
  metadata: GoogleSheetsMetadata,
  accessToken: string,
) {
  const scopes = enabledGoogleSheetsScopes(metadata);
  const created = await fetchGoogleSheetsJson<{
    spreadsheetId?: string;
    spreadsheetUrl?: string;
  }>(GOOGLE_SHEETS_API_BASE, accessToken, {
    method: "POST",
    body: JSON.stringify({
      properties: { title: metadata.spreadsheetTitle },
      sheets: scopes.map((scope) => ({
        properties: { title: GOOGLE_SHEETS_TITLES[scope] },
      })),
    }),
  });
  if (!created.spreadsheetId) {
    throw new Error("Google Sheets API did not return a spreadsheet id.");
  }
  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl:
      created.spreadsheetUrl ??
      `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
    spreadsheetTitle:
      metadata.spreadsheetTitle || `${access.workspaceSlug} analytics`,
  };
}

async function updateGoogleSpreadsheet(
  spreadsheetId: string,
  metadata: GoogleSheetsMetadata,
  rows: SheetRows,
  accessToken: string,
) {
  const scopes = enabledGoogleSheetsScopes(metadata);
  const spreadsheet = await fetchGoogleSheetsJson<{
    sheets?: Array<{ properties?: { title?: string } }>;
  }>(
    `${GOOGLE_SHEETS_API_BASE}/${encodeURIComponent(
      spreadsheetId,
    )}?fields=sheets.properties.title`,
    accessToken,
  );
  const existingTitles = new Set(
    (spreadsheet.sheets ?? [])
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => typeof title === "string"),
  );
  const missingTitles = scopes
    .map((scope) => GOOGLE_SHEETS_TITLES[scope])
    .filter((title) => !existingTitles.has(title));

  if (missingTitles.length) {
    await fetchGoogleSheetsJson(
      `${GOOGLE_SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          requests: missingTitles.map((title) => ({
            addSheet: { properties: { title } },
          })),
        }),
      },
    );
  }

  const ranges = scopes.map(
    (scope) => `'${GOOGLE_SHEETS_TITLES[scope]}'!A:ZZZ`,
  );
  if (ranges.length) {
    await fetchGoogleSheetsJson(
      `${GOOGLE_SHEETS_API_BASE}/${encodeURIComponent(
        spreadsheetId,
      )}/values:batchClear`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({ ranges }),
      },
    );
  }

  await fetchGoogleSheetsJson(
    `${GOOGLE_SHEETS_API_BASE}/${encodeURIComponent(
      spreadsheetId,
    )}/values:batchUpdate`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        valueInputOption: "RAW",
        data: scopes.map((scope) => ({
          range: `'${GOOGLE_SHEETS_TITLES[scope]}'!A1`,
          majorDimension: "ROWS",
          values: [GOOGLE_SHEETS_SHEET_SCHEMAS[scope], ...rows[scope]],
        })),
      }),
    },
  );
}

async function writeSpreadsheet(
  access: WorkspaceAccess,
  metadata: GoogleSheetsMetadata,
  rows: SheetRows,
  now: Date,
): Promise<SheetWriteResult> {
  const enabledScopes = enabledGoogleSheetsScopes(metadata);
  if (!enabledScopes.length) {
    throw new Error("Select at least one Google Sheets export scope.");
  }
  const rowCounts = {
    issues: metadata.scopes.issues ? rows.issues.length : 0,
    projects: metadata.scopes.projects ? rows.projects.length : 0,
    initiatives: metadata.scopes.initiatives ? rows.initiatives.length : 0,
  };
  let metadataPatch: Partial<GoogleSheetsMetadata> = {};
  let spreadsheetId =
    metadata.spreadsheetId || makeSpreadsheetId(access.workspaceId);
  let spreadsheetUrl = metadata.spreadsheetUrl;
  let spreadsheetTitle = metadata.spreadsheetTitle;

  let googleMetadata = await refreshGoogleAccessTokenIfNeeded(metadata, now);
  const accessToken = getGoogleAccessToken(googleMetadata);
  if (accessToken) {
    if (!googleMetadata.googleSpreadsheetCreated) {
      const created = await createGoogleSpreadsheet(
        access,
        googleMetadata,
        accessToken,
      );
      spreadsheetId = created.spreadsheetId;
      spreadsheetUrl = created.spreadsheetUrl;
      spreadsheetTitle = created.spreadsheetTitle;
      googleMetadata = {
        ...googleMetadata,
        spreadsheetId,
        spreadsheetUrl,
        spreadsheetTitle,
        googleSpreadsheetCreated: true,
      };
    }

    await updateGoogleSpreadsheet(
      spreadsheetId,
      googleMetadata,
      rows,
      accessToken,
    );
    metadataPatch = {
      accessToken: googleMetadata.accessToken,
      accessTokenExpiresAt: googleMetadata.accessTokenExpiresAt,
      oauthScopes: googleMetadata.oauthScopes,
      spreadsheetId,
      spreadsheetUrl,
      spreadsheetTitle,
      googleSpreadsheetCreated: googleMetadata.googleSpreadsheetCreated,
    };
  }

  return {
    spreadsheetId,
    spreadsheetUrl,
    spreadsheetTitle,
    metadataPatch,
    rowCounts,
    sheetSchemas: Object.fromEntries(
      enabledScopes.map((scope) => [scope, GOOGLE_SHEETS_SHEET_SCHEMAS[scope]]),
    ) as Record<GoogleSheetsExportScope, string[]>,
  };
}

export async function refreshGoogleSheetsIntegration(
  access: WorkspaceAccess,
  integration: { id: string; metadata: unknown },
  now = new Date(),
) {
  const metadata = normalizeGoogleSheetsMetadata(integration.metadata, access);

  try {
    const rows = await collectSheetRows(access.workspaceId, metadata);
    const { metadataPatch, ...writeResult } = await writeSpreadsheet(
      access,
      metadata,
      rows,
      now,
    );
    const updated: GoogleSheetsMetadata = {
      ...metadata,
      ...metadataPatch,
      ...writeResult,
      lastSuccessAt: now.toISOString(),
      lastErrorAt: null,
      lastError: null,
      nextRunAt: nextHourlyRun(now).toISOString(),
      updatedAt: now.toISOString(),
    };

    await db
      .update(workspaceIntegration)
      .set({
        status: "connected",
        externalId: updated.spreadsheetId,
        displayName: updated.spreadsheetTitle,
        metadata: updated,
        updatedAt: now,
      })
      .where(eq(workspaceIntegration.id, integration.id));

    return { metadata: updated, rows };
  } catch (error) {
    const updated: GoogleSheetsMetadata = {
      ...metadata,
      lastErrorAt: now.toISOString(),
      lastError:
        error instanceof Error ? error.message : "Google Sheets refresh failed",
      nextRunAt: nextHourlyRun(now).toISOString(),
      updatedAt: now.toISOString(),
    };
    await db
      .update(workspaceIntegration)
      .set({ status: "connected", metadata: updated, updatedAt: now })
      .where(eq(workspaceIntegration.id, integration.id));
    throw error;
  }
}

export async function upsertGoogleSheetsIntegration(
  access: WorkspaceAccess,
  userId: string,
  settingsInput: unknown,
  connectedMode: GoogleSheetsMetadata["connectedMode"],
) {
  const now = new Date();
  const settings = normalizeGoogleSheetsSettings(settingsInput);
  if (!hasEnabledGoogleSheetsScope(settings)) {
    throw new Error("Select at least one Google Sheets export scope.");
  }
  const raw = asRecord(settingsInput);
  const accessToken =
    typeof raw.accessToken === "string" && raw.accessToken
      ? raw.accessToken
      : null;
  const refreshToken =
    typeof raw.refreshToken === "string" && raw.refreshToken
      ? raw.refreshToken
      : null;
  const accessTokenExpiresAt = asIsoString(raw.accessTokenExpiresAt);
  const spreadsheetId = makeSpreadsheetId(access.workspaceId);
  const metadata: GoogleSheetsMetadata = {
    ...settings,
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    spreadsheetTitle: `${access.workspaceSlug} analytics`,
    googleSpreadsheetCreated: false,
    connectedMode,
    oauthScopes: Array.isArray(raw.oauthScopes)
      ? raw.oauthScopes.filter(
          (scope): scope is string => typeof scope === "string",
        )
      : [...GOOGLE_SHEETS_SCOPES],
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    nextRunAt: now.toISOString(),
    rowCounts: { issues: 0, projects: 0, initiatives: 0 },
    sheetSchemas: GOOGLE_SHEETS_SHEET_SCHEMAS,
    updatedAt: now.toISOString(),
  };

  const [integration] = await db
    .insert(workspaceIntegration)
    .values({
      workspaceId: access.workspaceId,
      provider: GOOGLE_SHEETS_PROVIDER,
      status: "connected",
      externalId: spreadsheetId,
      displayName: metadata.spreadsheetTitle,
      metadata,
      connectedByUserId: userId,
      connectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [workspaceIntegration.workspaceId, workspaceIntegration.provider],
      set: {
        status: "connected",
        externalId: spreadsheetId,
        displayName: metadata.spreadsheetTitle,
        metadata,
        connectedByUserId: userId,
        connectedAt: now,
        updatedAt: now,
      },
    })
    .returning({
      id: workspaceIntegration.id,
      metadata: workspaceIntegration.metadata,
    });

  return refreshGoogleSheetsIntegration(access, integration, now);
}

export async function findGoogleSheetsIntegration(workspaceId: string) {
  const [integration] = await db
    .select({
      id: workspaceIntegration.id,
      provider: workspaceIntegration.provider,
      status: workspaceIntegration.status,
      displayName: workspaceIntegration.displayName,
      externalId: workspaceIntegration.externalId,
      connectedAt: workspaceIntegration.connectedAt,
      metadata: workspaceIntegration.metadata,
    })
    .from(workspaceIntegration)
    .where(
      and(
        eq(workspaceIntegration.workspaceId, workspaceId),
        eq(workspaceIntegration.provider, GOOGLE_SHEETS_PROVIDER),
      ),
    )
    .limit(1);
  return integration ?? null;
}

export async function refreshDueGoogleSheetsIntegrations(now = new Date()) {
  const integrations = await db
    .select({
      id: workspaceIntegration.id,
      workspaceId: workspaceIntegration.workspaceId,
      provider: workspaceIntegration.provider,
      status: workspaceIntegration.status,
      displayName: workspaceIntegration.displayName,
      externalId: workspaceIntegration.externalId,
      connectedAt: workspaceIntegration.connectedAt,
      metadata: workspaceIntegration.metadata,
      workspaceSlug: workspace.urlSlug,
    })
    .from(workspaceIntegration)
    .innerJoin(workspace, eq(workspaceIntegration.workspaceId, workspace.id))
    .where(
      and(
        eq(workspaceIntegration.provider, GOOGLE_SHEETS_PROVIDER),
        eq(workspaceIntegration.status, "connected"),
      ),
    );

  const summary = {
    checked: integrations.length,
    refreshed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const integration of integrations) {
    const access = {
      workspaceId: integration.workspaceId,
      workspaceSlug: integration.workspaceSlug,
    };
    const metadata = normalizeGoogleSheetsMetadata(
      integration.metadata,
      access,
    );
    const nextRunAt = metadata.nextRunAt ? Date.parse(metadata.nextRunAt) : 0;
    if (!metadata.enabled || nextRunAt > now.getTime()) {
      summary.skipped += 1;
      continue;
    }

    try {
      await refreshGoogleSheetsIntegration(access, integration, now);
      summary.refreshed += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}
