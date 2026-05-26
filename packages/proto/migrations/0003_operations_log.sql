CREATE TABLE IF NOT EXISTS operation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  entity_type varchar(64) NOT NULL,
  entity_id text NOT NULL,
  op_type varchar(32) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  created_by text REFERENCES "user"(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS operation_workspace_version_idx
  ON operation (workspace_id, version);
CREATE INDEX IF NOT EXISTS operation_workspace_created_idx
  ON operation (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS operation_entity_idx
  ON operation (entity_type, entity_id);

CREATE SEQUENCE IF NOT EXISTS operation_version_seq;
