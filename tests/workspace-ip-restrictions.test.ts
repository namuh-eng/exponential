import {
  evaluateWorkspaceIpRestrictions,
  getTrustedClientIp,
  ipMatchesRange,
  isValidIpOrCidrRange,
} from "@/lib/workspace-ip-restrictions";
import { describe, expect, it } from "vitest";

const restrictedSettings = {
  security: {
    ipRestrictions: [
      { range: "203.0.113.0/24", enabled: true, type: "allow" },
      { range: "2001:db8:abcd::/48", enabled: true, type: "allow" },
      { range: "198.51.100.10", enabled: false, type: "allow" },
    ],
  },
};

describe("workspace IP restrictions", () => {
  it.each([
    ["203.0.113.42", "203.0.113.0/24", true],
    ["198.51.100.10", "203.0.113.0/24", false],
    ["198.51.100.10", "198.51.100.10", true],
    ["2001:db8:abcd::1", "2001:db8:abcd::/48", true],
    ["2001:db8:ffff::1", "2001:db8:abcd::/48", false],
  ])("matches %s against %s", (ip, range, expected) => {
    expect(ipMatchesRange(ip, range)).toBe(expected);
  });

  it.each(["203.0.113.42", "203.0.113.0/24", "2001:db8::1", "2001:db8::/32"])(
    "validates %s as an IP range",
    (range) => {
      expect(isValidIpOrCidrRange(range)).toBe(true);
    },
  );

  it.each(["999.0.0.1", "203.0.113.0/33", "2001:db8::/129", "not-an-ip"])(
    "rejects invalid range %s",
    (range) => {
      expect(isValidIpOrCidrRange(range)).toBe(false);
    },
  );

  it("extracts the first trusted forwarded IP and rejects invalid spoofed values", () => {
    expect(
      getTrustedClientIp(
        new Headers({ "x-forwarded-for": "203.0.113.42, 10.0.0.1" }),
      ),
    ).toBe("203.0.113.42");
    expect(
      getTrustedClientIp(new Headers({ "x-forwarded-for": "garbage" })),
    ).toBeNull();
  });

  it("allows matching IPv4 and IPv6 clients and denies non-matching clients", () => {
    expect(
      evaluateWorkspaceIpRestrictions({
        settings: restrictedSettings,
        headers: new Headers({ "cf-connecting-ip": "203.0.113.42" }),
      }),
    ).toEqual({ allowed: true, reason: "ip_allowed" });

    expect(
      evaluateWorkspaceIpRestrictions({
        settings: restrictedSettings,
        headers: new Headers({ "x-real-ip": "2001:db8:abcd::f00" }),
      }),
    ).toEqual({ allowed: true, reason: "ip_allowed" });

    expect(
      evaluateWorkspaceIpRestrictions({
        settings: restrictedSettings,
        headers: new Headers({ "x-real-ip": "198.51.100.10" }),
      }),
    ).toEqual({
      allowed: false,
      reason: "ip_not_allowed",
      clientIp: "198.51.100.10",
    });
  });

  it("leaves access unchanged when no restrictions are enabled", () => {
    expect(
      evaluateWorkspaceIpRestrictions({
        settings: { security: { ipRestrictions: [] } },
        headers: new Headers(),
      }),
    ).toEqual({ allowed: true, reason: "no_enabled_restrictions" });
  });
});
