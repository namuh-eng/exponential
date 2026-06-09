CREATE TABLE IF NOT EXISTS personal_access_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix varchar(20) NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  revoked_at timestamp,
  last_used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_access_token_workspace_idx
  ON personal_access_token (workspace_id);
CREATE INDEX IF NOT EXISTS personal_access_token_user_idx
  ON personal_access_token (user_id);

CREATE TABLE IF NOT EXISTS personal_access_token_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid REFERENCES personal_access_token(id) ON DELETE SET NULL,
  user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES workspace(id) ON DELETE SET NULL,
  action varchar(64) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_access_token_audit_token_idx
  ON personal_access_token_audit_log (token_id, created_at);
