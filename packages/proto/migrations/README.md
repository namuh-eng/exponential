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

## Known numbering anomaly

`0006_backfill_triage_workflow_state.sql` and `0006_stripe_webhook_event.sql`
share the `0006` prefix. Both are already applied in production and ordering is
deterministic (string sort: `backfill` before `stripe`), so they must **not**
be renamed. This is the only allowed duplicate prefix; every later migration
must use the next unused prefix so ordering stays unambiguous.
