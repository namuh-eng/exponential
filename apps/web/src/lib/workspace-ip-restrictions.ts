import { isIP } from "node:net";

type IpVersion = 4 | 6;

export type IpRestriction = {
  range: string;
  description: string;
  enabled: boolean;
  type: "allow";
};

export type WorkspaceIpAccessDecision =
  | { allowed: true; clientIp: string | null; matchedRange: string | null }
  | {
      allowed: false;
      clientIp: string | null;
      matchedRange: null;
      reason: "missing_client_ip" | "invalid_client_ip" | "ip_not_allowed";
    };

const DEPLOYMENT_CLIENT_IP_HEADERS = [
  "cf-connecting-ip",
  "fly-client-ip",
  "x-vercel-forwarded-for",
  "x-real-ip",
  "x-forwarded-for",
] as const;

function trustedClientIpHeaders() {
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.PLAYWRIGHT_TEST === "true"
  ) {
    return ["x-test-client-ip", ...DEPLOYMENT_CLIENT_IP_HEADERS] as const;
  }

  return DEPLOYMENT_CLIENT_IP_HEADERS;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeIpAddress(value: string) {
  let ip = value.trim().toLowerCase();
  if (!ip) {
    return null;
  }

  if (ip.startsWith("[") && ip.includes("]")) {
    ip = ip.slice(1, ip.indexOf("]"));
  } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) {
    ip = ip.slice(0, ip.lastIndexOf(":"));
  }

  return isIP(ip) ? ip : null;
}

function firstForwardedValue(value: string) {
  return value.split(",")[0]?.trim() ?? "";
}

export function extractTrustedClientIp(headers: Headers): string | null {
  for (const header of trustedClientIpHeaders()) {
    const value = headers.get(header);
    if (!value) {
      continue;
    }

    return normalizeIpAddress(firstForwardedValue(value));
  }

  return null;
}

export function hasTrustedClientIpHeader(headers: Headers) {
  return trustedClientIpHeaders().some((header) => headers.has(header));
}

function parseIpv4(address: string) {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let value = BigInt(0);
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet < 0 || octet > 255) {
      return null;
    }
    value = value * BigInt(256) + BigInt(octet);
  }
  return value;
}

function parseIpv6(address: string) {
  const normalizedAddress = address.toLowerCase();
  const doubleColonCount = (normalizedAddress.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) {
    return null;
  }

  const expandSide = (side: string) => {
    if (!side) {
      return [] as number[];
    }

    const groups: number[] = [];
    for (const part of side.split(":")) {
      if (!part) {
        return null;
      }

      if (part.includes(".")) {
        const ipv4 = parseIpv4(part);
        if (ipv4 === null) {
          return null;
        }
        groups.push(Number((ipv4 >> BigInt(16)) & BigInt(0xffff)));
        groups.push(Number(ipv4 & BigInt(0xffff)));
        continue;
      }

      if (!/^[0-9a-f]{1,4}$/.test(part)) {
        return null;
      }
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  const [leftRaw, rightRaw = ""] = normalizedAddress.split("::");
  const left = expandSide(leftRaw);
  const right = expandSide(rightRaw);
  if (!left || !right) {
    return null;
  }

  const missingGroups =
    doubleColonCount === 1 ? 8 - left.length - right.length : 0;
  if (missingGroups < 0) {
    return null;
  }

  const groups =
    doubleColonCount === 1
      ? [...left, ...Array(missingGroups).fill(0), ...right]
      : left;

  if (groups.length !== 8) {
    return null;
  }

  return groups.reduce(
    (value, group) => value * BigInt(0x10000) + BigInt(group),
    BigInt(0),
  );
}

function parseIpAddress(
  address: string,
): { version: IpVersion; value: bigint } | null {
  const normalized = normalizeIpAddress(address);
  if (!normalized) {
    return null;
  }

  const version = isIP(normalized) as IpVersion;
  const value = version === 4 ? parseIpv4(normalized) : parseIpv6(normalized);
  return value === null ? null : { version, value };
}

export function isValidCidrRange(value: string) {
  const trimmed = value.trim();
  const [address, prefix, extra] = trimmed.split("/");
  if (!address || extra !== undefined) {
    return false;
  }

  const parsed = parseIpAddress(address);
  if (!parsed) {
    return false;
  }

  if (prefix === undefined) {
    return true;
  }

  if (!/^\d+$/.test(prefix)) {
    return false;
  }

  const prefixNumber = Number(prefix);
  return parsed.version === 4
    ? prefixNumber >= 0 && prefixNumber <= 32
    : prefixNumber >= 0 && prefixNumber <= 128;
}

function normalizeIpRange(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeIpRestrictions(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenRanges = new Set<string>();
  const restrictions: IpRestriction[] = [];

  for (const item of value) {
    const record = asRecord(item);
    const rawRange = typeof record.range === "string" ? record.range : "";
    const range = normalizeIpRange(rawRange);
    if (!range || !isValidCidrRange(range) || seenRanges.has(range)) {
      continue;
    }

    seenRanges.add(range);
    restrictions.push({
      range,
      description:
        typeof record.description === "string"
          ? record.description.trim().slice(0, 120)
          : "",
      enabled: typeof record.enabled === "boolean" ? record.enabled : true,
      type: "allow",
    });
  }

  return restrictions;
}

export function readWorkspaceIpRestrictions(settings: unknown) {
  return normalizeIpRestrictions(
    asRecord(asRecord(settings).security).ipRestrictions,
  );
}

export function ipMatchesCidr(ip: string, range: string) {
  const parsedIp = parseIpAddress(ip);
  const [rangeAddress, prefixRaw] = range.trim().toLowerCase().split("/");
  const parsedRange = parseIpAddress(rangeAddress);
  if (!parsedIp || !parsedRange || parsedIp.version !== parsedRange.version) {
    return false;
  }

  const bits = parsedIp.version === 4 ? 32 : 128;
  const prefix = prefixRaw === undefined ? bits : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) {
    return false;
  }

  if (prefix === 0) {
    return true;
  }

  const hostBits = bits - prefix;
  const mask = ((BigInt(1) << BigInt(prefix)) - BigInt(1)) << BigInt(hostBits);
  return (parsedIp.value & mask) === (parsedRange.value & mask);
}

export function evaluateWorkspaceIpAccess(
  headers: Headers,
  settings: unknown,
): WorkspaceIpAccessDecision {
  const restrictions = readWorkspaceIpRestrictions(settings).filter(
    (restriction) => restriction.enabled,
  );

  if (restrictions.length === 0) {
    return { allowed: true, clientIp: null, matchedRange: null };
  }

  const clientIp = extractTrustedClientIp(headers);
  if (!clientIp) {
    return {
      allowed: false,
      clientIp: null,
      matchedRange: null,
      reason: hasTrustedClientIpHeader(headers)
        ? "invalid_client_ip"
        : "missing_client_ip",
    };
  }

  const matchedRange = restrictions.find((restriction) =>
    ipMatchesCidr(clientIp, restriction.range),
  );

  if (matchedRange) {
    return { allowed: true, clientIp, matchedRange: matchedRange.range };
  }

  return {
    allowed: false,
    clientIp,
    matchedRange: null,
    reason: "ip_not_allowed",
  };
}

export function workspaceIpRestrictionError(
  decision: WorkspaceIpAccessDecision,
) {
  return {
    error: "Workspace access denied by IP restrictions",
    code: "workspace_ip_restricted",
    reason: decision.allowed ? undefined : decision.reason,
  };
}
