import {
  type PermissionLevel,
  type WorkspaceMemberRole,
  asRecord,
  canPerformWorkspacePermission,
  isPermissionLevel,
  readPermissionLevel,
} from "@/lib/workspace-permissions";

export { asRecord, isPermissionLevel, readPermissionLevel };
export type { PermissionLevel, WorkspaceMemberRole };
export type WebhookEventType = "created" | "updated" | "deleted";

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  created: "Issue created",
  updated: "Issue updated",
  deleted: "Issue deleted",
};

export const OAUTH_SCOPE_OPTIONS = [
  "read",
  "write",
  "issues:read",
  "issues:write",
  "comments:write",
  "webhooks:write",
] as const;

export type OAuthScope = (typeof OAUTH_SCOPE_OPTIONS)[number];

export type OAuthApplicationRecord = {
  id: string;
  name: string;
  description?: string | null;
  clientId: string;
  clientSecretPreview: string;
  clientSecretHash?: string;
  redirectUrl: string;
  redirectUrls?: string[];
  scopes?: OAuthScope[];
  createdByUserId?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type OAuthAuthorizationCodeRecord = {
  codeHash: string;
  applicationId: string;
  clientId: string;
  workspaceId: string;
  userId: string;
  redirectUri: string;
  scopes: OAuthScope[];
  expiresAt: string;
  createdAt: string;
};

export type OAuthTokenRecord = {
  id: string;
  tokenHash: string;
  refreshTokenHash: string;
  applicationId: string;
  clientId: string;
  workspaceId: string;
  userId: string;
  scopes: OAuthScope[];
  revokedAt: string | null;
  createdAt: string;
  expiresAt: string;
};

export type WorkspaceWebhookRecord = {
  id: string;
  label: string | null;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceApiKeyRecord = {
  id: string;
  name: string;
  keyPrefix: string;
  accessLevel: "Member";
  createdAt: string;
  lastUsedAt: string | null;
  creator: {
    name: string;
    email: string;
    image: string | null;
  };
};

export type ApiSettingsPayload = {
  permissionLevel: PermissionLevel;
  viewerRole: WorkspaceMemberRole;
  canManageWorkspaceApi: boolean;
  canCreateApiKeys: boolean;
  docs: {
    graphql: string;
    oauthApplications: string;
    webhooks: string;
  };
  oauthApplications: OAuthApplicationRecord[];
  webhooks: WorkspaceWebhookRecord[];
  apiKeys: WorkspaceApiKeyRecord[];
};

export const GRAPHQL_DOCS_URL = "https://linear.app/developers/graphql";
export const OAUTH_APPLICATIONS_DOCS_URL =
  "https://linear.app/developers/oauth-2-0-authentication";
export const WEBHOOKS_DOCS_URL = "https://linear.app/developers/webhooks";

const WEBHOOK_EVENT_TYPES = new Set<WebhookEventType>([
  "created",
  "updated",
  "deleted",
]);

export type WorkspaceApiSettingsState = {
  oauthApplications: OAuthApplicationRecord[];
  oauthAuthorizationCodes: OAuthAuthorizationCodeRecord[];
  oauthTokens: OAuthTokenRecord[];
};

const DEFAULT_WORKSPACE_API_SETTINGS: WorkspaceApiSettingsState = {
  oauthApplications: [],
  oauthAuthorizationCodes: [],
  oauthTokens: [],
};

export function normalizeWebhookEvents(value: unknown): WebhookEventType[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value.filter(
        (eventName): eventName is WebhookEventType =>
          typeof eventName === "string" &&
          WEBHOOK_EVENT_TYPES.has(eventName as WebhookEventType),
      ),
    ),
  );
}

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type OAuthRedirectValidationResult = UrlValidationResult;

function parseIpv4Address(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return Number.NaN;
    }

    const value = Number(part);
    return value >= 0 && value <= 255 ? value : Number.NaN;
  });

  return octets.every((octet) => Number.isInteger(octet)) ? octets : null;
}

function isUnsafeIpv4Address(hostname: string) {
  const octets = parseIpv4Address(hostname);
  if (!octets) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isUnsafeIpv6Address(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function isUnsafeRedirectHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    isUnsafeIpv4Address(normalized) ||
    isUnsafeIpv6Address(normalized)
  );
}

function validateHttpsPublicUrl(
  value: unknown,
  label: string,
): UrlValidationResult {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: `${label} is required.` };
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return { ok: false, error: `${label} must be a valid absolute URL.` };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: `${label} must use HTTPS.` };
  }

  if (url.hash) {
    return { ok: false, error: `${label} must not include a fragment.` };
  }

  if (isUnsafeRedirectHostname(url.hostname)) {
    return {
      ok: false,
      error: `${label} must not use localhost, loopback, private, or link-local hosts.`,
    };
  }

  return { ok: true, url: url.toString() };
}

export function validateOAuthRedirectUrl(
  value: unknown,
): OAuthRedirectValidationResult {
  return validateHttpsPublicUrl(value, "Redirect URL");
}

export function validateWebhookUrl(value: unknown): UrlValidationResult {
  return validateHttpsPublicUrl(value, "Webhook URL");
}

export type OAuthRedirectListValidationResult =
  | { ok: true; urls: string[] }
  | { ok: false; error: string };

export function validateOAuthRedirectUrls(
  value: unknown,
): OAuthRedirectListValidationResult {
  const rawUrls = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]+/)
      : [];
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const rawUrl of rawUrls) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) {
      continue;
    }
    const validation = validateOAuthRedirectUrl(rawUrl);
    if (!validation.ok) {
      return validation;
    }
    if (seen.has(validation.url)) {
      return { ok: false, error: "Redirect URLs must be unique." };
    }
    seen.add(validation.url);
    urls.push(validation.url);
  }

  if (urls.length === 0) {
    return { ok: false, error: "At least one redirect URL is required." };
  }

  return { ok: true, urls };
}

export function normalizeOAuthScopes(value: unknown): OAuthScope[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowed = new Set<string>(OAUTH_SCOPE_OPTIONS);
  return Array.from(
    new Set(
      value.filter(
        (scope): scope is OAuthScope =>
          typeof scope === "string" && allowed.has(scope),
      ),
    ),
  );
}

export function parseRequestedOAuthScopes(value: unknown): OAuthScope[] {
  if (Array.isArray(value)) {
    return normalizeOAuthScopes(value);
  }
  if (typeof value !== "string") {
    return [];
  }
  return normalizeOAuthScopes(value.split(/[\s,]+/).filter(Boolean));
}

export function hasUnsupportedOAuthScopes(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,]+/).filter(Boolean)
      : [];
  const allowed = new Set<string>(OAUTH_SCOPE_OPTIONS);
  return raw.some((scope) => typeof scope !== "string" || !allowed.has(scope));
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function readOAuthApplication(value: unknown): OAuthApplicationRecord | null {
  const record = asRecord(value);
  const id = typeof record.id === "string" ? record.id : null;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const clientId =
    typeof record.clientId === "string" ? record.clientId.trim() : "";
  const clientSecretPreview =
    typeof record.clientSecretPreview === "string"
      ? record.clientSecretPreview.trim()
      : "";
  const clientSecretHash =
    typeof record.clientSecretHash === "string"
      ? record.clientSecretHash.trim()
      : "";
  const legacyRedirectUrl =
    typeof record.redirectUrl === "string" ? record.redirectUrl.trim() : "";
  const redirectUrls = Array.isArray(record.redirectUrls)
    ? record.redirectUrls.filter(
        (url): url is string => typeof url === "string" && Boolean(url.trim()),
      )
    : legacyRedirectUrl
      ? [legacyRedirectUrl]
      : [];
  const redirectUrl = redirectUrls[0] ?? legacyRedirectUrl;
  const scopes = normalizeOAuthScopes(record.scopes);
  const createdAt = isIsoDate(record.createdAt) ? record.createdAt : null;
  const updatedAt = isIsoDate(record.updatedAt) ? record.updatedAt : createdAt;
  const description =
    typeof record.description === "string" && record.description.trim()
      ? record.description.trim()
      : null;
  const createdByUserId =
    typeof record.createdByUserId === "string" ? record.createdByUserId : null;

  if (
    !id ||
    !name ||
    !clientId ||
    !clientSecretPreview ||
    !redirectUrl ||
    !createdAt
  ) {
    return null;
  }

  return {
    id,
    name,
    description,
    clientId,
    clientSecretPreview,
    clientSecretHash,
    redirectUrl,
    redirectUrls,
    scopes: scopes.length ? scopes : ["read"],
    createdByUserId,
    createdAt,
    updatedAt: updatedAt ?? createdAt,
  };
}

export function readWorkspaceApiSettings(
  settings: unknown,
): WorkspaceApiSettingsState {
  const apiSettings = asRecord(asRecord(settings).api);
  const oauthApplications = Array.isArray(apiSettings.oauthApplications)
    ? apiSettings.oauthApplications
        .map((application) => readOAuthApplication(application))
        .filter((application): application is OAuthApplicationRecord =>
          Boolean(application),
        )
    : DEFAULT_WORKSPACE_API_SETTINGS.oauthApplications;

  const oauthAuthorizationCodes = Array.isArray(
    apiSettings.oauthAuthorizationCodes,
  )
    ? apiSettings.oauthAuthorizationCodes.filter(
        (code): code is OAuthAuthorizationCodeRecord => {
          const record = asRecord(code);
          return (
            typeof record.codeHash === "string" &&
            typeof record.applicationId === "string"
          );
        },
      )
    : [];
  const oauthTokens = Array.isArray(apiSettings.oauthTokens)
    ? apiSettings.oauthTokens.filter((token): token is OAuthTokenRecord => {
        const record = asRecord(token);
        return (
          typeof record.tokenHash === "string" &&
          typeof record.applicationId === "string"
        );
      })
    : [];

  return {
    oauthApplications,
    oauthAuthorizationCodes,
    oauthTokens,
  };
}

export function serializeWorkspaceApiSettings(
  apiSettings: WorkspaceApiSettingsState,
) {
  return {
    oauthApplications: apiSettings.oauthApplications,
    ...(apiSettings.oauthAuthorizationCodes.length
      ? { oauthAuthorizationCodes: apiSettings.oauthAuthorizationCodes }
      : {}),
    ...(apiSettings.oauthTokens.length
      ? { oauthTokens: apiSettings.oauthTokens }
      : {}),
  };
}

export function canManageWorkspaceApi(role: WorkspaceMemberRole) {
  return role === "owner" || role === "admin";
}

export function canMemberCreateApiKeys(
  role: WorkspaceMemberRole,
  permissionLevel: PermissionLevel,
) {
  return canPerformWorkspacePermission(role, permissionLevel, {
    includeGuestsForAnyone: false,
  });
}
