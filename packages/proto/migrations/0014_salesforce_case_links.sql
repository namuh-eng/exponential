ALTER TABLE integration_thread_link
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES project(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS external_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS integration_thread_link_project_idx
  ON integration_thread_link (project_id, provider, created_at)
  WHERE project_id IS NOT NULL;
