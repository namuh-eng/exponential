# SQL Migrations

The migration runner (`apps/api/cmd/migrate`) globs `*.sql` in this directory,
sorts filenames as strings, and records each applied file by its **filename**
in the `exponential_schema_migration` table.

## Rules

- **Never rename a migration that may have been applied anywhere** (production,
  staging, any self-hosted instance). The runner tracks applied migrations by
  filename, so a renamed file is treated as a brand-new migration and re-runs.
- Each new migration must use the next unused numeric prefix, zero-padded to
  four digits, followed by a short snake_case description:
  `0008_short_description.sql`.
- Migrations are forward-only. Each file runs in its own transaction; there is
  no down-migration support.
- Keep migrations idempotent-friendly where cheap (`if not exists` for new
  objects) since self-hosted operators may restore from partial backups.

## Known numbering anomalies

The migration runner records applied migrations by filename, not numeric prefix.
These duplicate prefixes already exist in deployed branches and must **not** be
renamed:

- `0006_backfill_triage_workflow_state.sql`
- `0006_stripe_webhook_event.sql`
- `0007_integration_provider_lifecycle.sql`
- `0007_webhook_delivery.sql`
- `0008_integration_lifecycle.sql`
- `0008_slack_thread_links.sql`

Ordering is deterministic by full filename string. Every later migration must use
the next unused prefix (`0009` at the time of this note) so no new duplicate
prefixes are introduced.
