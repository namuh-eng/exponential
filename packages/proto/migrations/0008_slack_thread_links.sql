CREATE TABLE IF NOT EXISTS integration_thread_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_integration_id uuid REFERENCES workspace_integration(id) ON DELETE SET NULL,
  provider varchar(64) NOT NULL,
  issue_id uuid REFERENCES issue(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES comment(id) ON DELETE CASCADE,
  external_team_id text,
  external_channel_id text NOT NULL,
  external_thread_ts text NOT NULL,
  external_message_ts text NOT NULL,
  external_permalink text,
  direction varchar(16) NOT NULL DEFAULT 'inbound',
  source_event_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CHECK (direction IN ('inbound','outbound'))
);

CREATE INDEX IF NOT EXISTS integration_thread_link_issue_idx
  ON integration_thread_link (issue_id, provider, created_at);

CREATE INDEX IF NOT EXISTS integration_thread_link_thread_idx
  ON integration_thread_link (workspace_integration_id, external_channel_id, external_thread_ts);

CREATE UNIQUE INDEX IF NOT EXISTS integration_thread_link_external_message_idx
  ON integration_thread_link (workspace_integration_id, external_channel_id, external_message_ts)
  WHERE workspace_integration_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS integration_thread_link_source_event_idx
  ON integration_thread_link (workspace_integration_id, source_event_id)
  WHERE workspace_integration_id IS NOT NULL AND source_event_id IS NOT NULL;
