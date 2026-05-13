#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Pool } from "pg";

const ENV_FILES = [".env", ".env.local"];

function applyEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

for (const file of ENV_FILES) {
  applyEnvFile(path.resolve(process.cwd(), file));
}

function databaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const user = process.env.DB_USER ?? "postgres";
  const password = process.env.DB_PASSWORD ?? "password";
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const name = process.env.DB_NAME ?? "whetline";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(
    password,
  )}@${host}:${port}/${name}`;
}

function redact(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return url.replace(/:\/\/([^:/]+):[^@]+@/, "://$1:***@");
  }
}

if (process.env.SKIP_DB_PREFLIGHT === "true") {
  console.warn(
    "SKIP_DB_PREFLIGHT=true: skipping the dev Postgres preflight. Protected routes and Playwright setup still require a working database and will show setup errors if Postgres is unavailable.",
  );
  process.exit(0);
}

const connectionString = databaseUrl();
const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 1500,
  ssl:
    process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

try {
  await pool.query("select 1");
  await pool.end();
} catch (error) {
  await pool.end().catch(() => undefined);
  console.error(`\nLocal database is unavailable: ${redact(connectionString)}`);
  console.error(
    "Start the dev database and apply the schema before npm run dev:",
  );
  console.error("  make dev-services");
  console.error("  npm run db:push");
  console.error(
    "\nIf Docker is unavailable, start/use a host Postgres instead, set DATABASE_URL in .env.local, then run npm run db:push.",
  );
  console.error(
    "Only set SKIP_DB_PREFLIGHT=true when intentionally debugging non-database routes; it can leave the authenticated app half-working.",
  );
  console.error(`\nPostgres error: ${error.message}\n`);
  process.exit(1);
}
