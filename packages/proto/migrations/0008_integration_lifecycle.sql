-- Integration platform lifecycle, health, credentials, and job substrate
-- Extends workspace_integration with lifecycle/health fields and adds
-- provider job/event tables for webhook ingestion, syncs, retries, and audit.

-- 1. Lifecycle / health fields on workspace_integration
ALTER TABLE workspace_integration
  ADD COLUMN IF NOT EXISTS lifecycle_state varchar(64) NOT NULL DEFAULT 'connected',
  ADD COLUMN IF NOT EXISTS credential_ref text,
  ADD COLUMN IF NOT EXISTS credential_rotated_at timestamp,
  ADD COLUMN IF NOT EXISTS credential_revoked_at timestamp,
  ADD COLUMN IF NOT EXISTS last_event_at timestamp,
  ADD COLUMN IF NOT EXISTS last_success_at timestamp,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamp,
  ADD COLUMN IF NOT EXISTS last_failure_message text,
  ADD COLUMN IF NOT EXISTS disconnected_at timestamp,
  ADD COLUMN IF NOT EXISTS disconnected_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS health_summary text;

-- Migrate existing rows: status 'connected' → lifecycle_state 'connected'
UPDATE workspace_integration
  SET lifecycle_state = status
  WHERE lifecycle_state = 'connected';

-- 2. Provider job/event table
CREATE TABLE IF NOT EXISTS integration_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_integration_id uuid NOT NULL REFERENCES workspace_integration(id) ON DELETE CASCADE,
  provider varchar(64) NOT NULL,
  job_type varchar(64) NOT NULL,  -- 'webhook_ingest', 'outbound_delivery', 'backfill', 'sync'
  status varchar(32) NOT NULL DEFAULT 'pending',  -- 'pending','running','succeeded','failed','terminal'
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 5,
  next_run_at timestamp,
  started_at timestamp,
  finished_at timestamp,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_job_workspace_integration_idx ON integration_job (workspace_integration_id);
CREATE INDEX IF NOT EXISTS integration_job_status_next_run_idx ON integration_job (status, next_run_at);
CREATE INDEX IF NOT EXISTS integration_job_provider_type_idx ON integration_job (provider, job_type);
