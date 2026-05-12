import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import { sendMagicLinkEmail } from "@/lib/email";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";

const PRODUCTION_BUILD_PHASE = "phase-production-build";

function getBetterAuthUrl() {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
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
  if (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET) {
    return {};
  }

  return {
    google: {
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    },
  };
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
  ],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  trustedOrigins: [getBetterAuthUrl()],
});
