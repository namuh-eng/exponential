ALTER TABLE authorized_application_grant
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspace(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS authorized_application_grant_workspace_idx
  ON authorized_application_grant (workspace_id);
