ALTER TABLE member ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE member ADD COLUMN IF NOT EXISTS scim_external_id text;
CREATE INDEX IF NOT EXISTS member_workspace_deleted_at_idx ON member (workspace_id, deleted_at);
CREATE INDEX IF NOT EXISTS member_workspace_scim_external_id_idx ON member (workspace_id, scim_external_id) WHERE scim_external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_scim_token (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'SCIM token',
  prefix text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now(),
  revoked_at timestamp,
  last_used_at timestamp
);
CREATE INDEX IF NOT EXISTS workspace_scim_token_workspace_idx ON workspace_scim_token (workspace_id);
CREATE INDEX IF NOT EXISTS workspace_scim_token_active_idx ON workspace_scim_token (token_hash) WHERE revoked_at IS NULL;
