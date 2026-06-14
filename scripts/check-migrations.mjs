#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ignoredFilenames = new Set([".gitkeep", "README.md"]);
const migrationFilenamePattern =
  /^(?<prefix>\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

const allowedDuplicatePrefixGroups = new Map([
  [
    "0006",
    new Set([
      "0006_backfill_triage_workflow_state.sql",
      "0006_stripe_webhook_event.sql",
    ]),
  ],
]);

function formatPrefix(value) {
  return String(value).padStart(4, "0");
}

function isAllowedDuplicate(prefix, filenames) {
  const allowedFilenames = allowedDuplicatePrefixGroups.get(prefix);
  if (!allowedFilenames || filenames.length !== allowedFilenames.size) {
    return false;
  }
  return filenames.every((filename) => allowedFilenames.has(filename));
}

export function validateMigrationFiles(filenames) {
  const errors = [];
  const filenamesByPrefix = new Map();

  for (const filename of [...filenames].sort()) {
    if (ignoredFilenames.has(filename)) {
      continue;
    }

    const match = migrationFilenamePattern.exec(filename);
    if (!match?.groups) {
      errors.push(
        `${filename}: expected a migration filename like 0008_short_description.sql`,
      );
      continue;
    }

    const prefix = match.groups.prefix;
    const prefixFilenames = filenamesByPrefix.get(prefix) ?? [];
    prefixFilenames.push(filename);
    filenamesByPrefix.set(prefix, prefixFilenames);
  }

  for (const [prefix, prefixFilenames] of filenamesByPrefix) {
    if (
      prefixFilenames.length > 1 &&
      !isAllowedDuplicate(prefix, prefixFilenames)
    ) {
      errors.push(
        `duplicate migration prefix ${prefix}: ${prefixFilenames.join(", ")}`,
      );
    }
  }

  const prefixes = [...filenamesByPrefix.keys()]
    .map((prefix) => Number.parseInt(prefix, 10))
    .toSorted((left, right) => left - right);
  const prefixSet = new Set(prefixes);

  if (prefixes.length > 0) {
    const firstPrefix = prefixes[0];
    const lastPrefix = prefixes[prefixes.length - 1];

    if (firstPrefix !== 0) {
      errors.push(
        `first migration prefix is ${formatPrefix(firstPrefix)}; expected 0000`,
      );
    }

    for (
      let expectedPrefix = 0;
      expectedPrefix <= lastPrefix;
      expectedPrefix += 1
    ) {
      if (!prefixSet.has(expectedPrefix)) {
        errors.push(
          `missing migration prefix ${formatPrefix(
            expectedPrefix,
          )}; new migrations must use the next unused number`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Migration filename check failed:\n- ${errors.join("\n- ")}`,
    );
  }

  const lastPrefix = prefixes[prefixes.length - 1] ?? -1;
  return {
    migrationCount: [...filenamesByPrefix.values()].reduce(
      (count, prefixFilenames) => count + prefixFilenames.length,
      0,
    ),
    nextPrefix: formatPrefix(lastPrefix + 1),
  };
}

export function validateMigrationDirectory(directory) {
  const filenames = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  return validateMigrationFiles(filenames);
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ?? "packages/proto/migrations";

  try {
    const result = validateMigrationDirectory(directory);
    console.log(
      `Migration filename guard passed (${result.migrationCount} migrations, next prefix ${result.nextPrefix}).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
