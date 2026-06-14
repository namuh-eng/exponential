#!/usr/bin/env node
import assert from "node:assert/strict";
import { validateMigrationFiles } from "./check-migrations.mjs";

const currentMigrationFilenames = [
  ".gitkeep",
  "0000_core_schema.sql",
  "0001_headless_api_support.sql",
  "0002_personal_access_tokens.sql",
  "0003_operations_log.sql",
  "0004_authorized_application_workspace.sql",
  "0005_session_token_hash.sql",
  "0006_backfill_triage_workflow_state.sql",
  "0006_stripe_webhook_event.sql",
  "0007_integration_provider_lifecycle.sql",
  "0008_slack_thread_links.sql",
  "README.md",
];

assert.deepEqual(validateMigrationFiles(currentMigrationFilenames), {
  migrationCount: 10,
  nextPrefix: "0009",
});

assert.throws(
  () =>
    validateMigrationFiles([
      "0000_core_schema.sql",
      "0001_first.sql",
      "0001_second.sql",
    ]),
  /duplicate migration prefix 0001/,
);

assert.throws(
  () =>
    validateMigrationFiles([
      "0000_core_schema.sql",
      "0001_headless_api_support.sql",
      "0002-bad-name.sql",
      "notes.txt",
    ]),
  /0002-bad-name\.sql: expected a migration filename/,
);

assert.throws(
  () =>
    validateMigrationFiles([
      "0000_core_schema.sql",
      "0002_personal_access_tokens.sql",
    ]),
  /missing migration prefix 0001/,
);

assert.throws(
  () =>
    validateMigrationFiles([
      ...currentMigrationFilenames,
      "0006_extra_collision.sql",
    ]),
  /duplicate migration prefix 0006/,
);
