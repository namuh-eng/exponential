CREATE TABLE IF NOT EXISTS agent_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  actor_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  title text NOT NULL,
  prompt text NOT NULL,
  team_key varchar(10) NOT NULL,
  context text NOT NULL,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(32) NOT NULL DEFAULT 'queued',
  owner_name text NOT NULL,
  target text NOT NULL,
  output text NOT NULL DEFAULT '',
  provider varchar(64),
  model varchar(128),
  provider_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT agent_run_status_check CHECK (status IN ('queued', 'running', 'needs_review', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS agent_run_workspace_updated_idx
  ON agent_run (workspace_id, updated_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_run_actor_idx
  ON agent_run (actor_user_id);
