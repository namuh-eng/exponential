import { isIP } from "node:net";
import { db } from "@/lib/db";
import { workspace } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type IpRestriction = {
  range: string;
  description?: string;
  enabled?: boolean;
  type?: "allow";
};

export type WorkspaceIpRestrictionDecision =
  | { allowed: true; reason: "no_enabled_restrictions" | "ip_allowed" }
  | {
      allowed: false;
      reason: "missing_client_ip" | "invalid_client_ip" | "ip_not_allowed";
      clientIp: string | null;
    };

type WorkspaceSettingsRow = { settings: unknown };

const TRUSTED_CLIENT_IP_HEADERS = [
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip",
  "x-forwarded-for",
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isValidIpOrCidrRange(value: string) {
  const trimmed = value.trim();
  const [address, prefix, extra] = trimmed.split("/");
  if (!address || extra !== undefined) return false;

  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;

  const prefixNumber = Number(prefix);
  return version === 4
    ? prefixNumber >= 0 && prefixNumber <= 32
    : prefixNumber >= 0 && prefixNumber <= 128;
}

export function normalizeIpRange(value: string) {
  return value.trim().toLowerCase();
}

export function readEnabledIpRestrictions(settings: unknown): IpRestriction[] {
  const security = asRecord(asRecord(settings).security);
  const rawRestrictions = security.ipRestrictions;
  if (!Array.isArray(rawRestrictions)) return [];

  return rawRestrictions.flatMap((entry): IpRestriction[] => {
    const record = asRecord(entry);
    const range =
      typeof record.range === "string" ? normalizeIpRange(record.range) : "";
    if (!range || !isValidIpOrCidrRange(range) || record.enabled === false) {
      return [];
    }

    return [
      {
        range,
        description:
          typeof record.description === "string"
            ? record.description
            : undefined,
        enabled: true,
        type: "allow",
      },
    ];
  });
}

function normalizeCandidateIp(value: string) {
  let candidate = value.trim();
  if (!candidate) return null;

  if (candidate.startsWith("[")) {
    const end = candidate.indexOf("]");
    if (end > 0) candidate = candidate.slice(1, end);
  } else {
    const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
    if (ipv4WithPort) candidate = ipv4WithPort[1];
  }

  if (candidate.startsWith("::ffff:") && isIP(candidate.slice(7)) === 4) {
    candidate = candidate.slice(7);
  }

  return isIP(candidate) ? candidate.toLowerCase() : null;
}

export function getTrustedClientIp(headerList: Headers) {
  for (const headerName of TRUSTED_CLIENT_IP_HEADERS) {
    const headerValue = headerList.get(headerName);
    if (!headerValue) continue;

    const candidate =
      headerName === "x-forwarded-for"
        ? headerValue.split(",")[0]
        : headerValue;
    const normalized = normalizeCandidateIp(candidate);
    if (normalized) return normalized;
    return null;
  }

  return null;
}

function parseIpv4(address: string) {
  if (isIP(address) !== 4) return null;
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255)) {
    return null;
  }
  return parts.reduce(
    (acc, part) => (acc << BigInt(8)) + BigInt(part),
    BigInt(0),
  );
}

function parseIpv6(address: string) {
  if (isIP(address) !== 6) return null;
  const normalized = address.toLowerCase();
  const [head = "", tail = "", extra] = normalized.split("::");
  if (extra !== undefined) return null;

  const parsePart = (part: string) => {
    if (!part) return [] as number[];
    const pieces = part.split(":");
    const groups: number[] = [];
    for (const piece of pieces) {
      if (!piece) return null;
      if (piece.includes(".")) {
        const ipv4 = parseIpv4(piece);
        if (ipv4 === null) return null;
        groups.push(
          Number((ipv4 >> BigInt(16)) & BigInt(0xffff)),
          Number(ipv4 & BigInt(0xffff)),
        );
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) {
        groups.push(Number.parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return groups;
  };

  const headGroups = parsePart(head);
  const tailGroups = parsePart(tail);
  if (!headGroups || !tailGroups) return null;

  const missingGroups = 8 - headGroups.length - tailGroups.length;
  if (normalized.includes("::")) {
    if (missingGroups < 0) return null;
  } else if (missingGroups !== 0) {
    return null;
  }

  const groups = normalized.includes("::")
    ? [
        ...headGroups,
        ...Array.from({ length: missingGroups }, () => 0),
        ...tailGroups,
      ]
    : headGroups;
  if (groups.length !== 8) return null;

  return groups.reduce(
    (acc, group) => (acc << BigInt(16)) + BigInt(group),
    BigInt(0),
  );
}

function parseIp(address: string) {
  const version = isIP(address);
  if (version === 4) return { version, value: parseIpv4(address) } as const;
  if (version === 6) return { version, value: parseIpv6(address) } as const;
  return { version: 0, value: null } as const;
}

export function ipMatchesRange(clientIp: string, range: string) {
  const normalizedClientIp = normalizeCandidateIp(clientIp);
  if (!normalizedClientIp) return false;

  const [rangeAddress, prefixText] = normalizeIpRange(range).split("/");
  if (!isValidIpOrCidrRange(range)) return false;

  const client = parseIp(normalizedClientIp);
  const network = parseIp(rangeAddress);
  if (
    client.value === null ||
    network.value === null ||
    client.version !== network.version
  ) {
    return false;
  }

  const bitCount = client.version === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? bitCount : Number(prefixText);
  if (prefix === 0) return true;

  const hostBits = BigInt(bitCount - prefix);
  const mask =
    ((BigInt(1) << BigInt(bitCount)) - BigInt(1)) ^
    ((BigInt(1) << hostBits) - BigInt(1));
  return (client.value & mask) === (network.value & mask);
}

export function evaluateWorkspaceIpRestrictions(input: {
  settings: unknown;
  headers: Headers;
}): WorkspaceIpRestrictionDecision {
  const enabledRestrictions = readEnabledIpRestrictions(input.settings);
  if (enabledRestrictions.length === 0) {
    return { allowed: true, reason: "no_enabled_restrictions" };
  }

  const clientIp = getTrustedClientIp(input.headers);
  if (!clientIp) {
    return {
      allowed: false,
      reason: "missing_client_ip",
      clientIp: null,
    };
  }

  if (!isIP(clientIp)) {
    return { allowed: false, reason: "invalid_client_ip", clientIp };
  }

  const allowed = enabledRestrictions.some((restriction) =>
    ipMatchesRange(clientIp, restriction.range),
  );

  return allowed
    ? { allowed: true, reason: "ip_allowed" }
    : { allowed: false, reason: "ip_not_allowed", clientIp };
}

export function createIpRestrictionApiResponse(
  decision: Exclude<WorkspaceIpRestrictionDecision, { allowed: true }>,
) {
  return Response.json(
    {
      error: "Access denied by workspace IP restrictions",
      reason: decision.reason,
    },
    { status: 403 },
  );
}

export async function evaluateWorkspaceIpRestrictionsByWorkspaceId(input: {
  workspaceId: string;
  headers: Headers;
}) {
  const [record] = await db
    .select({ settings: workspace.settings })
    .from(workspace)
    .where(eq(workspace.id, input.workspaceId))
    .limit(1);

  return evaluateWorkspaceIpRestrictions({
    settings: (record as WorkspaceSettingsRow | undefined)?.settings,
    headers: input.headers,
  });
}
