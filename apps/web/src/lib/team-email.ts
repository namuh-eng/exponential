const INBOUND_DOMAIN =
  process.env.EXPONENTIAL_INBOUND_DOMAIN?.trim() || "team.exponential.app";

export function buildTeamInboundEmailAddress(
  teamKey: string,
  workspaceSlug: string,
) {
  return `${teamKey.toLowerCase()}.${workspaceSlug.toLowerCase()}@${INBOUND_DOMAIN}`;
}

export function parseTeamInboundRecipient(recipient: string) {
  const normalized = recipient.trim().toLowerCase();
  const [localPart, domain] = normalized.split("@");
  if (!localPart || domain !== INBOUND_DOMAIN) {
    return null;
  }

  const [teamKey, ...workspaceParts] = localPart.split(".");
  if (!teamKey) {
    return null;
  }

  return {
    teamKey: teamKey.toUpperCase(),
    workspaceSlug: workspaceParts.join(".") || null,
  };
}

export function isInboundEmailRequestAuthorized(headers: Headers) {
  const configuredSecret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return process.env.NODE_ENV !== "production";
  }

  return headers.get("x-inbound-email-secret") === configuredSecret;
}
