ALTER TABLE workspace_integration
  ADD COLUMN IF NOT EXISTS last_event_at timestamp,
  ADD COLUMN IF NOT EXISTS last_success_at timestamp,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamp,
  ADD COLUMN IF NOT EXISTS last_failure_message text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamp,
  ADD COLUMN IF NOT EXISTS credentials_revoked_at timestamp,
  ADD COLUMN IF NOT EXISTS revoked_at timestamp,
  ADD COLUMN IF NOT EXISTS revoked_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE workspace_integration
    ADD CONSTRAINT workspace_integration_status_check
    CHECK (status IN ('configuration_required','installing','connected','degraded','revoked','error'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS provider_credential (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_integration_id uuid NOT NULL REFERENCES workspace_integration(id) ON DELETE CASCADE,
  provider varchar(64) NOT NULL,
  secret_ref text,
  encrypted_payload bytea,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  rotated_at timestamp,
  revoked_at timestamp,
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_credential_integration_idx ON provider_credential (workspace_integration_id);
CREATE UNIQUE INDEX IF NOT EXISTS provider_credential_active_idx ON provider_credential (workspace_integration_id) WHERE active;

CREATE TABLE IF NOT EXISTS provider_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_integration_id uuid REFERENCES workspace_integration(id) ON DELETE SET NULL,
  provider varchar(64) NOT NULL,
  kind varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'queued',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  scheduled_at timestamp NOT NULL DEFAULT now(),
  next_run_at timestamp,
  started_at timestamp,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CHECK (kind IN ('webhook_ingestion','outbound_delivery','backfill','sync')),
  CHECK (status IN ('queued','running','succeeded','failed','dead','canceled')),
  CHECK (attempts >= 0),
  CHECK (max_attempts > 0)
);
CREATE INDEX IF NOT EXISTS provider_job_workspace_idx ON provider_job (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_job_integration_status_idx ON provider_job (workspace_integration_id, status);
CREATE INDEX IF NOT EXISTS provider_job_next_run_idx ON provider_job (status, next_run_at);

CREATE TABLE IF NOT EXISTS provider_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_integration_id uuid REFERENCES workspace_integration(id) ON DELETE SET NULL,
  provider varchar(64) NOT NULL,
  job_id uuid REFERENCES provider_job(id) ON DELETE SET NULL,
  event_type varchar(64) NOT NULL,
  severity varchar(16) NOT NULL DEFAULT 'info',
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  CHECK (severity IN ('info','warning','error'))
);
CREATE INDEX IF NOT EXISTS provider_event_workspace_idx ON provider_event (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS provider_event_integration_idx ON provider_event (workspace_integration_id, created_at DESC);
