ALTER TABLE agent_run
  ADD COLUMN IF NOT EXISTS source_context jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS agent_run_source_provider_idx
  ON agent_run ((source_context->>'provider'))
  WHERE source_context <> '{}'::jsonb;
