#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ status: null, stdout, stderr, error });
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr, error: null });
    });
  });
}

function printDockerUnavailable(result) {
  const detail = [result.error?.message, result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n")
    .trim();

  console.error(
    "\nDocker is unavailable, so Whetline cannot start the local Postgres/Redis containers.",
  );
  if (detail) {
    console.error(`\nDocker error:\n${detail}`);
  }
  console.error("\nUse one of these recovery paths:");
  console.error("  1. Fix Docker socket access, then rerun: make dev-services");
  console.error(
    "  2. Use an existing host Postgres/Redis and set DATABASE_URL/REDIS_URL in .env.local",
  );
  console.error(
    "     Then run: EXPONENTIAL_API_DATABASE_URL=$DATABASE_URL go run ./apps/api/cmd/migrate",
  );
  console.error(
    "  3. If parity QA is only verifying the missing-DB path, leave DB stopped and run pnpm dev; it must fail before binding a listener.",
  );
  console.error(
    "\nDo not bypass this with SKIP_DB_PREFLIGHT unless you are intentionally debugging routes that do not need the database.\n",
  );
}

async function main() {
  const dockerInfo = await run("docker", ["info"]);
  if (dockerInfo.status !== 0) {
    printDockerUnavailable(dockerInfo);
    process.exit(1);
  }

  const compose = spawn(
    "docker",
    [
      "compose",
      "-f",
      "docker-compose.yml",
      "up",
      "postgres",
      "redis",
      "api-migrate",
      "-d",
    ],
    { stdio: "inherit" },
  );

  compose.on("error", (error) => {
    printDockerUnavailable({ status: null, stdout: "", stderr: "", error });
    process.exit(1);
  });
  compose.on("close", (status) => {
    if (status && status !== 0) {
      console.error(
        "\nDocker Compose could not start the local services. If Docker is blocked or ports are already in use, use an existing host Postgres/Redis by setting DATABASE_URL/REDIS_URL in .env.local, then run EXPONENTIAL_API_DATABASE_URL=$DATABASE_URL go run ./apps/api/cmd/migrate.",
      );
    }
    process.exit(status ?? 1);
  });
}

await main();
