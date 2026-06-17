CREATE TABLE IF NOT EXISTS provider_webhook_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(64) NOT NULL,
  delivery_id text NOT NULL,
  workspace_id uuid REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_integration_id uuid REFERENCES workspace_integration(id) ON DELETE SET NULL,
  event_type varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'accepted',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  CHECK (status IN ('accepted','ignored','duplicate','failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_webhook_delivery_provider_delivery_idx
  ON provider_webhook_delivery (provider, delivery_id);

CREATE INDEX IF NOT EXISTS provider_webhook_delivery_integration_idx
  ON provider_webhook_delivery (workspace_integration_id, created_at DESC);
