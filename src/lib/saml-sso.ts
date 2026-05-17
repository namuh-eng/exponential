import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";

export const SAML_NO_WORKSPACE_MESSAGE =
  "No SAML SSO enabled workspace could be found.";
export const SAML_INVALID_EMAIL_MESSAGE = "Enter a valid email address.";

type SamlSettings = {
  enabled?: boolean;
  domains?: string[];
  emailDomains?: string[];
  ssoUrl?: string;
  ssoURL?: string;
  idpSsoUrl?: string;
  url?: string;
};

type WorkspaceSettings = {
  saml?: SamlSettings;
  sso?: SamlSettings;
};

export type SamlDiscoveryResult =
  | { ok: true; url: string }
  | { ok: false; status: 400 | 404; error: string };

export function extractEmailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }

  const domain = normalized.split("@").at(1);
  return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain : null;
}

function readSamlSettings(settings: unknown): SamlSettings | null {
  if (!settings || typeof settings !== "object") {
    return null;
  }

  const candidate = settings as WorkspaceSettings & {
    security?: WorkspaceSettings;
  };
  return candidate.security?.saml ?? candidate.saml ?? candidate.sso ?? null;
}

function getConfiguredSamlUrl(settings: SamlSettings): string | null {
  const configuredUrl =
    settings.idpSsoUrl ?? settings.ssoUrl ?? settings.ssoURL ?? settings.url;
  if (!configuredUrl || typeof configuredUrl !== "string") {
    return null;
  }

  try {
    const url = new URL(configuredUrl);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function samlDomains(settings: SamlSettings): string[] {
  const domains = settings.domains ?? settings.emailDomains ?? [];
  return Array.isArray(domains)
    ? domains
        .filter((domain): domain is string => typeof domain === "string")
        .map((domain) => domain.trim().toLowerCase())
    : [];
}

export async function discoverSamlUrlFromEmail(
  email: string,
): Promise<SamlDiscoveryResult> {
  const domain = extractEmailDomain(email);
  if (!domain) {
    return { ok: false, status: 400, error: SAML_INVALID_EMAIL_MESSAGE };
  }

  const workspaces = await db
    .select({ settings: workspace.settings })
    .from(workspace);

  for (const record of workspaces) {
    const saml = readSamlSettings(record.settings);
    if (!saml?.enabled) {
      continue;
    }

    const url = getConfiguredSamlUrl(saml);
    if (!url) {
      continue;
    }

    if (samlDomains(saml).includes(domain)) {
      return { ok: true, url };
    }
  }

  return { ok: false, status: 404, error: SAML_NO_WORKSPACE_MESSAGE };
}
