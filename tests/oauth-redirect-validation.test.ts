import { validateOAuthRedirectUrl } from "@/lib/api-settings";
import { describe, expect, it } from "vitest";

describe("validateOAuthRedirectUrl", () => {
  it.each([
    ["empty redirect URL", "", "Redirect URL is required."],
    [
      "relative URL",
      "/oauth/callback",
      "Redirect URL must be a valid absolute URL.",
    ],
    [
      "invalid protocol",
      "ftp://example.com/callback",
      "Redirect URL must use HTTPS.",
    ],
    [
      "non-HTTPS callback",
      "http://example.com/callback",
      "Redirect URL must use HTTPS.",
    ],
    [
      "localhost callback",
      "https://localhost:3015/oauth/callback",
      "Redirect URL must not use localhost, loopback, private, or link-local hosts.",
    ],
    [
      "localhost subdomain callback",
      "https://app.localhost/oauth/callback",
      "Redirect URL must not use localhost, loopback, private, or link-local hosts.",
    ],
    [
      "loopback IPv4 callback",
      "https://127.0.0.1/oauth/callback",
      "Redirect URL must not use localhost, loopback, private, or link-local hosts.",
    ],
    [
      "loopback IPv6 callback",
      "https://[::1]/oauth/callback",
      "Redirect URL must not use localhost, loopback, private, or link-local hosts.",
    ],
    [
      "private 10/8 callback",
      "https://10.0.0.8/oauth/callback",
      "Redirect URL must not use localhost, loopback, private, or link-local hosts.",
    ],
    [
      "private 172.16/12 callback",
      "https://172.20.1.10/oauth/callback",
      "Redirect URL must not use localhost, loopback, private, or link-local hosts.",
    ],
    [
      "private 192.168/16 callback",
      "https://192.168.1.10/oauth/callback",
      "Redirect URL must not use localhost, loopback, private, or link-local hosts.",
    ],
    [
      "link-local callback",
      "https://169.254.10.20/oauth/callback",
      "Redirect URL must not use localhost, loopback, private, or link-local hosts.",
    ],
    [
      "fragment callback",
      "https://ever.test/callback#token",
      "Redirect URL must not include a fragment.",
    ],
  ])("rejects %s", (_caseName, redirectUrl, error) => {
    expect(validateOAuthRedirectUrl(redirectUrl)).toEqual({ ok: false, error });
  });

  it("accepts and normalizes valid HTTPS callbacks", () => {
    expect(
      validateOAuthRedirectUrl(" https://ever.test/oauth/callback?x=1 "),
    ).toEqual({
      ok: true,
      url: "https://ever.test/oauth/callback?x=1",
    });
  });
});
