#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Pool } from "pg";

const ENV_FILES = [".env", ".env.local"];
const REQUIRED_TABLES = ["user", "session", "workspace", "member", "team"];

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

    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
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

function printSetup() {
  console.error("  make dev-services");
  console.error("  npm run db:push");
}

if (process.env.SKIP_DB_PREFLIGHT === "true") {
  console.warn(
    "SKIP_DB_PREFLIGHT=true: skipping the dev Postgres preflight. Protected routes and Playwright setup still require a working database and will show setup errors if Postgres is unavailable or missing schema.",
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

  const { rows } = await pool.query(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
        and table_name = any($1::text[])`,
    [REQUIRED_TABLES],
  );
  const existingTables = new Set(rows.map((row) => row.table_name));
  const missingTables = REQUIRED_TABLES.filter(
    (tableName) => !existingTables.has(tableName),
  );

  if (missingTables.length > 0) {
    console.error(
      `\nLocal database schema is missing: ${redact(connectionString)}`,
    );
    console.error(
      `Missing required table${missingTables.length === 1 ? "" : "s"}: ${missingTables.join(", ")}`,
    );
    console.error(
      "Apply the Drizzle schema before npm run dev so authenticated routes and Playwright test sessions can work:",
    );
    printSetup();
    console.error(
      "\nIf Docker is unavailable, start/use a host Postgres instead, set DATABASE_URL in .env.local, then run npm run db:push.",
    );
    process.exitCode = 1;
  }

  await pool.end();
} catch (error) {
  await pool.end().catch(() => undefined);
  console.error(`\nLocal database is unavailable: ${redact(connectionString)}`);
  console.error(
    "Start the dev database and apply the schema before npm run dev:",
  );
  printSetup();
  console.error(
    "\nIf Docker is unavailable, start/use a host Postgres instead, set DATABASE_URL in .env.local, then run npm run db:push.",
  );
  console.error(
    "Only set SKIP_DB_PREFLIGHT=true when intentionally debugging non-database routes; it can leave the authenticated app half-working.",
  );
  console.error(`\nPostgres error: ${error.message}\n`);
  process.exit(1);
}
