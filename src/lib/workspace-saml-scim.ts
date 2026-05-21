import { createHash, randomBytes } from "node:crypto";
import { asRecord } from "@/lib/workspace-permissions";

export type SamlStatus = "not_configured" | "configured" | "verified" | "error";

export type WorkspaceSamlSettings = {
  enabled: boolean;
  domains: string[];
  idpSsoUrl: string;
  entityId: string;
  certificate: string;
  metadataUrl: string;
  lastTestedAt: string | null;
  status: SamlStatus;
  lastError: string | null;
};

export type WorkspaceScimToken = {
  id: string;
  name: string;
  prefix: string;
  tokenHash: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export type PublicWorkspaceScimToken = Omit<WorkspaceScimToken, "tokenHash">;

export type WorkspaceScimSettings = {
  enabled: boolean;
  baseUrl: string;
  tokens: WorkspaceScimToken[];
  lastSyncAt: string | null;
  status: "disabled" | "enabled";
};

export type PublicWorkspaceScimSettings = Omit<
  WorkspaceScimSettings,
  "tokens"
> & {
  tokens: PublicWorkspaceScimToken[];
};

export type WorkspaceSamlScimSettings = {
  saml: WorkspaceSamlSettings;
  scim: WorkspaceScimSettings;
};

export type PublicWorkspaceSamlScimSettings = {
  saml: WorkspaceSamlSettings;
  scim: PublicWorkspaceScimSettings;
};

export const DEFAULT_SAML_SETTINGS: WorkspaceSamlSettings = {
  enabled: false,
  domains: [],
  idpSsoUrl: "",
  entityId: "",
  certificate: "",
  metadataUrl: "",
  lastTestedAt: null,
  status: "not_configured",
  lastError: null,
};

export const DEFAULT_SCIM_SETTINGS: WorkspaceScimSettings = {
  enabled: false,
  baseUrl: "",
  tokens: [],
  lastSyncAt: null,
  status: "disabled",
};

export function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

export function normalizeDomains(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((domain): domain is string => typeof domain === "string")
        .map(normalizeDomain)
        .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)),
    ),
  );
}

export function readWorkspaceSamlSettings(
  settings: unknown,
): WorkspaceSamlSettings {
  const root = asRecord(settings);
  const security = asRecord(root.security);
  const saml = asRecord(security.saml ?? root.saml ?? root.sso);
  const url = stringOrEmpty(
    saml.idpSsoUrl ?? saml.ssoUrl ?? saml.ssoURL ?? saml.url,
  );
  const domains = normalizeDomains(saml.domains ?? saml.emailDomains);
  const hasConfig = Boolean(
    url ||
      stringOrEmpty(saml.entityId) ||
      stringOrEmpty(saml.certificate) ||
      stringOrEmpty(saml.metadataUrl),
  );

  return {
    enabled: typeof saml.enabled === "boolean" ? saml.enabled : false,
    domains,
    idpSsoUrl: url,
    entityId: stringOrEmpty(saml.entityId),
    certificate: stringOrEmpty(saml.certificate),
    metadataUrl: stringOrEmpty(saml.metadataUrl),
    lastTestedAt: nullableString(saml.lastTestedAt),
    status: readSamlStatus(saml.status, hasConfig),
    lastError: nullableString(saml.lastError),
  };
}

export function readWorkspaceScimSettings(
  settings: unknown,
  baseUrl = "",
): WorkspaceScimSettings {
  const root = asRecord(settings);
  const security = asRecord(root.security);
  const scim = asRecord(security.scim ?? root.scim);
  const enabled = typeof scim.enabled === "boolean" ? scim.enabled : false;

  return {
    enabled,
    baseUrl: stringOrEmpty(scim.baseUrl) || baseUrl,
    tokens: readScimTokens(scim.tokens),
    lastSyncAt: nullableString(scim.lastSyncAt),
    status: enabled ? "enabled" : "disabled",
  };
}

export function readWorkspaceSamlScimSettings(
  settings: unknown,
  baseUrl = "",
): WorkspaceSamlScimSettings {
  return {
    saml: readWorkspaceSamlSettings(settings),
    scim: readWorkspaceScimSettings(settings, baseUrl),
  };
}

export function toPublicSamlScim(
  settings: WorkspaceSamlScimSettings,
): PublicWorkspaceSamlScimSettings {
  return {
    saml: settings.saml,
    scim: {
      ...settings.scim,
      tokens: settings.scim.tokens.map(
        ({ tokenHash: _tokenHash, ...token }) => token,
      ),
    },
  };
}

export function validateUrl(value: string, label: string, required = false) {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? `${label} is required.` : null;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:"
      ? null
      : `${label} must be an http or https URL.`;
  } catch {
    return `${label} must be a valid URL.`;
  }
}

export function normalizeSamlInput(
  input: Record<string, unknown>,
  current: WorkspaceSamlSettings,
) {
  const enabled =
    typeof input.enabled === "boolean" ? input.enabled : current.enabled;
  const next: WorkspaceSamlSettings = {
    enabled,
    domains:
      input.domains === undefined
        ? current.domains
        : normalizeDomains(input.domains),
    idpSsoUrl:
      input.idpSsoUrl === undefined
        ? current.idpSsoUrl
        : stringOrEmpty(input.idpSsoUrl),
    entityId:
      input.entityId === undefined
        ? current.entityId
        : stringOrEmpty(input.entityId),
    certificate:
      input.certificate === undefined
        ? current.certificate
        : stringOrEmpty(input.certificate),
    metadataUrl:
      input.metadataUrl === undefined
        ? current.metadataUrl
        : stringOrEmpty(input.metadataUrl),
    lastTestedAt: current.lastTestedAt,
    status: current.status,
    lastError: current.lastError,
  };

  if (
    !next.idpSsoUrl &&
    !next.metadataUrl &&
    !next.entityId &&
    !next.certificate
  ) {
    next.status = "not_configured";
    next.lastError = null;
  } else if (input.status === "verified" || input.test === true) {
    next.status = "verified";
    next.lastTestedAt = new Date().toISOString();
    next.lastError = null;
  } else if (next.status === "not_configured") {
    next.status = "configured";
  }

  return next;
}

export function validateSamlSettings(settings: WorkspaceSamlSettings) {
  const ssoError = validateUrl(
    settings.idpSsoUrl,
    "IdP SSO URL",
    settings.enabled,
  );
  if (ssoError) return ssoError;
  const metadataError = validateUrl(settings.metadataUrl, "Metadata URL");
  if (metadataError) return metadataError;
  if (settings.enabled && settings.domains.length === 0) {
    return "At least one SAML email domain is required before enabling SAML.";
  }
  if (settings.enabled && !settings.entityId.trim()) {
    return "IdP entity ID is required before enabling SAML.";
  }
  if (
    settings.enabled &&
    !settings.certificate.trim() &&
    !settings.metadataUrl.trim()
  ) {
    return "Certificate or metadata URL is required before enabling SAML.";
  }
  return null;
}

export function createScimToken(name = "SCIM token") {
  const secret = `scim_${randomBytes(24).toString("base64url")}`;
  const token: WorkspaceScimToken = {
    id: randomBytes(12).toString("hex"),
    name: name.trim().slice(0, 80) || "SCIM token",
    prefix: secret.slice(0, 12),
    tokenHash: hashScimToken(secret),
    createdAt: new Date().toISOString(),
    revokedAt: null,
    lastUsedAt: null,
  };
  return { secret, token };
}

export function hashScimToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function stringOrEmpty(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function readSamlStatus(value: unknown, hasConfig: boolean): SamlStatus {
  return value === "configured" || value === "verified" || value === "error"
    ? value
    : hasConfig
      ? "configured"
      : "not_configured";
}

function readScimTokens(value: unknown): WorkspaceScimToken[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = stringOrEmpty(record.id);
    const tokenHash = stringOrEmpty(record.tokenHash);
    if (!id || !tokenHash) return [];
    return [
      {
        id,
        tokenHash,
        name: stringOrEmpty(record.name) || "SCIM token",
        prefix: stringOrEmpty(record.prefix) || "scim_••••••",
        createdAt:
          nullableString(record.createdAt) ?? new Date(0).toISOString(),
        revokedAt: nullableString(record.revokedAt),
        lastUsedAt: nullableString(record.lastUsedAt),
      },
    ];
  });
}
