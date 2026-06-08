// Load the monorepo-root .env into process.env before Next reads its own env.
// Next's loader only sees apps/web/.env* by default; this keeps a single
// source of truth at the repo root. apps/web/.env.local still wins for
// personal overrides because Next loads it after this runs (existing values
// in process.env are not overwritten).
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

{
  const rootEnv = path.resolve(__dirname, "../../.env");
  if (fs.existsSync(rootEnv)) {
    for (const line of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

function readWebPackageVersion() {
  try {
    const packageJsonPath = path.resolve(__dirname, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return packageJson.version ?? "version:unknown";
  } catch {
    return "version:unknown";
  }
}

function readGitValue(args, fallback) {
  try {
    const value = childProcess
      .execFileSync("git", args, {
        cwd: path.resolve(__dirname, "../.."),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();

    if (!value || value === "HEAD") {
      return fallback;
    }

    return value;
  } catch {
    return fallback;
  }
}

const publicBuildEnv = {
  NEXT_PUBLIC_EXPONENTIAL_VERSION:
    process.env.NEXT_PUBLIC_EXPONENTIAL_VERSION ?? readWebPackageVersion(),
  NEXT_PUBLIC_EXPONENTIAL_GIT_BRANCH:
    process.env.NEXT_PUBLIC_EXPONENTIAL_GIT_BRANCH ??
    readGitValue(["rev-parse", "--abbrev-ref", "HEAD"], "branch:unknown"),
  NEXT_PUBLIC_EXPONENTIAL_GIT_SHA:
    process.env.NEXT_PUBLIC_EXPONENTIAL_GIT_SHA ??
    readGitValue(["rev-parse", "--short=7", "HEAD"], "sha:unknown"),
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: publicBuildEnv,
  output: "standalone",
  async headers() {
    const securityHeaders = [
      {
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; form-action 'self'",
      },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=()",
      },
    ];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    if (process.env.EXPONENTIAL_HEADLESS_DIRECT_API_REWRITE === "false") {
      return [];
    }

    const apiUrl = process.env.EXPONENTIAL_API_URL?.replace(/\/$/, "");
    if (!apiUrl) {
      return [];
    }

    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${apiUrl}/:path*`,
        },
      ],
    };
  },
};

module.exports = nextConfig;
