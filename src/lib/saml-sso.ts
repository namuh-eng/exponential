import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import { readWorkspaceSamlSettings } from "@/lib/workspace-saml-scim";

export const SAML_NO_WORKSPACE_MESSAGE =
  "No SAML SSO enabled workspace could be found.";
export const SAML_INVALID_EMAIL_MESSAGE = "Enter a valid email address.";

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

function getConfiguredSamlUrl(
  settings: ReturnType<typeof readWorkspaceSamlSettings>,
): string | null {
  if (!settings.idpSsoUrl) {
    return null;
  }

  try {
    const url = new URL(settings.idpSsoUrl);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
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
    const saml = readWorkspaceSamlSettings(record.settings);
    if (!saml.enabled) {
      continue;
    }

    const url = getConfiguredSamlUrl(saml);
    if (!url) {
      continue;
    }

    if (saml.domains.includes(domain)) {
      return { ok: true, url };
    }
  }

  return { ok: false, status: 404, error: SAML_NO_WORKSPACE_MESSAGE };
}
