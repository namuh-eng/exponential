import {
  evaluateWorkspaceIpAccess,
  extractTrustedClientIp,
  ipMatchesCidr,
  isValidCidrRange,
  normalizeIpRestrictions,
} from "@/lib/workspace-ip-restrictions";
import { describe, expect, it } from "vitest";

const restrictedSettings = {
  security: {
    ipRestrictions: [
      { range: "203.0.113.0/24", enabled: true, description: "Office" },
      { range: "2001:db8:abcd::/48", enabled: true },
      { range: "198.51.100.0/24", enabled: false },
    ],
  },
};

describe("workspace IP restrictions", () => {
  it("validates IPv4, IPv6, and CIDR ranges", () => {
    expect(isValidCidrRange("203.0.113.42")).toBe(true);
    expect(isValidCidrRange("203.0.113.0/24")).toBe(true);
    expect(isValidCidrRange("2001:db8::/32")).toBe(true);
    expect(isValidCidrRange("2001:db8::1")).toBe(true);
    expect(isValidCidrRange("203.0.113.0/33")).toBe(false);
    expect(isValidCidrRange("2001:db8::/129")).toBe(false);
    expect(isValidCidrRange("not-an-ip")).toBe(false);
  });

  it("matches IPv4 and IPv6 CIDR ranges", () => {
    expect(ipMatchesCidr("203.0.113.42", "203.0.113.0/24")).toBe(true);
    expect(ipMatchesCidr("203.0.114.42", "203.0.113.0/24")).toBe(false);
    expect(ipMatchesCidr("2001:db8:abcd::1", "2001:db8:abcd::/48")).toBe(true);
    expect(ipMatchesCidr("2001:db8:abce::1", "2001:db8:abcd::/48")).toBe(false);
  });

  it("normalizes stored allowlist restrictions and drops invalid ranges", () => {
    expect(
      normalizeIpRestrictions([
        { range: " 203.0.113.0/24 ", description: " Office ", enabled: true },
        { range: "203.0.113.0/24", description: "Duplicate" },
        { range: "999.0.0.1/33" },
      ]),
    ).toEqual([
      {
        range: "203.0.113.0/24",
        description: "Office",
        enabled: true,
        type: "allow",
      },
    ]);
  });

  it("extracts the first trusted forwarded client IP", () => {
    expect(
      extractTrustedClientIp(
        new Headers({ "x-forwarded-for": "203.0.113.42, 10.0.0.2" }),
      ),
    ).toBe("203.0.113.42");
    expect(extractTrustedClientIp(new Headers({ "x-real-ip": "bad-ip" }))).toBe(
      null,
    );
  });

  it("allows requests from enabled ranges and denies disallowed IPs", () => {
    expect(
      evaluateWorkspaceIpAccess(
        new Headers({ "x-forwarded-for": "203.0.113.42" }),
        restrictedSettings,
      ),
    ).toMatchObject({ allowed: true, matchedRange: "203.0.113.0/24" });

    expect(
      evaluateWorkspaceIpAccess(
        new Headers({ "x-forwarded-for": "198.51.100.42" }),
        restrictedSettings,
      ),
    ).toMatchObject({ allowed: false, reason: "ip_not_allowed" });
  });

  it("preserves no-restriction passthrough", () => {
    expect(evaluateWorkspaceIpAccess(new Headers(), { security: {} })).toEqual({
      allowed: true,
      clientIp: null,
      matchedRange: null,
    });
  });

  it("denies invalid or spoofed trusted header values when restrictions are enabled", () => {
    expect(
      evaluateWorkspaceIpAccess(
        new Headers({ "x-forwarded-for": "bad-ip, 203.0.113.42" }),
        restrictedSettings,
      ),
    ).toMatchObject({ allowed: false, reason: "invalid_client_ip" });
  });
});
