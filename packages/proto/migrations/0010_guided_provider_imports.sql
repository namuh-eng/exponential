CREATE TABLE IF NOT EXISTS import_job (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'setup',
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  message text NOT NULL DEFAULT '',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE INDEX IF NOT EXISTS import_job_workspace_created_idx
  ON import_job (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS import_job_workspace_status_idx
  ON import_job (workspace_id, status);

CREATE TABLE IF NOT EXISTS import_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider varchar(64) NOT NULL,
  source_type varchar(64) NOT NULL,
  external_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_source_workspace_idx
  ON import_source (workspace_id, provider, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS import_source_job_type_external_idx
  ON import_source (job_id, source_type, external_id);

CREATE TABLE IF NOT EXISTS import_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider varchar(64) NOT NULL,
  mapping_type varchar(64) NOT NULL,
  external_id text NOT NULL,
  target_id text,
  target_value text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_mapping_workspace_idx
  ON import_mapping (workspace_id, provider, mapping_type);
CREATE UNIQUE INDEX IF NOT EXISTS import_mapping_job_type_external_idx
  ON import_mapping (job_id, mapping_type, external_id);

CREATE TABLE IF NOT EXISTS import_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider varchar(64) NOT NULL,
  external_issue_id text NOT NULL,
  external_comment_id text,
  issue_id uuid REFERENCES issue(id) ON DELETE SET NULL,
  comment_id uuid REFERENCES comment(id) ON DELETE SET NULL,
  status varchar(32) NOT NULL,
  source_url text,
  error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_result_job_idx
  ON import_result (job_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS import_result_workspace_provider_issue_idx
  ON import_result (workspace_id, provider, external_issue_id);
CREATE UNIQUE INDEX IF NOT EXISTS import_result_workspace_provider_comment_idx
  ON import_result (workspace_id, provider, external_comment_id)
  WHERE external_comment_id IS NOT NULL;
