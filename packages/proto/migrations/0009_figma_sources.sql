CREATE TABLE IF NOT EXISTS figma_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES comment(id) ON DELETE CASCADE,
  document_id text,
  container_type varchar(32) NOT NULL DEFAULT 'issue_description',
  source_url text NOT NULL,
  normalized_url text NOT NULL,
  file_key text NOT NULL,
  node_id text,
  kind varchar(16) NOT NULL,
  name text,
  thumbnail_url text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamp NOT NULL DEFAULT now(),
  refreshed_at timestamp,
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CHECK (kind IN ('file','design','proto')),
  CHECK (container_type IN ('issue_description','comment','document','plugin'))
);

CREATE INDEX IF NOT EXISTS figma_source_issue_idx
  ON figma_source (issue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS figma_source_workspace_idx
  ON figma_source (workspace_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS figma_source_container_url_idx
  ON figma_source (workspace_id, issue_id, container_type, coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(document_id, ''), normalized_url);
