import { randomInt } from "node:crypto";
import { getConfiguredAppUrl } from "@/lib/app-url";
import {
  getGitHubOAuthConfig,
  getGitLabOAuthConfig,
  getGoogleOAuthConfig,
  getSlackOAuthConfig,
} from "@/lib/auth-providers";
import { db } from "@/lib/db";
import { sendMagicLinkEmail } from "@/lib/email";
import {
  getPasskeyOrigin,
  getPasskeyRpID,
  isPasskeyAuthEnabled,
} from "@/lib/passkeys";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";

const PRODUCTION_BUILD_PHASE = "phase-production-build";

function getBetterAuthUrl() {
  return getConfiguredAppUrl();
}

function getBetterAuthSecret() {
  if (process.env.BETTER_AUTH_SECRET) {
    return process.env.BETTER_AUTH_SECRET;
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== PRODUCTION_BUILD_PHASE
  ) {
    throw new Error("BETTER_AUTH_SECRET must be set in production");
  }

  return "dev-only-better-auth-secret-not-for-production";
}

function getSocialProviders() {
  const providers: Record<string, { clientId: string; clientSecret: string }> =
    {};
  const google = getGoogleOAuthConfig();
  const github = getGitHubOAuthConfig();
  const gitlab = getGitLabOAuthConfig();
  const slack = getSlackOAuthConfig();

  if (google) {
    providers.google = google;
  }
  if (github) {
    providers.github = github;
  }
  if (gitlab) {
    providers.gitlab = gitlab;
  }
  if (slack) {
    providers.slack = slack;
  }

  return providers;
}

export const auth = betterAuth({
  baseURL: getBetterAuthUrl(),
  secret: getBetterAuthSecret(),
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: false },
  socialProviders: getSocialProviders(),
  plugins: [
    magicLink({
      generateToken: async () =>
        randomInt(0, 1_000_000).toString().padStart(6, "0"),
      sendMagicLink: async ({ email, url, token }) => {
        await sendMagicLinkEmail(email, token, url);
      },
      expiresIn: 600, // 10 minutes
    }),
    ...(isPasskeyAuthEnabled()
      ? [
          passkey({
            rpID: getPasskeyRpID(),
            rpName: "Whetline",
            origin: getPasskeyOrigin(),
          }),
        ]
      : []),
  ],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  trustedOrigins: [getBetterAuthUrl()],
});
