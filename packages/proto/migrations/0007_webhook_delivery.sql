-- Outbound webhook delivery queue and delivery log.
-- Each row tracks one delivery attempt envelope; retries append new rows.

CREATE TABLE IF NOT EXISTS webhook_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhook(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- The event that triggered this delivery
  event_type text NOT NULL,
  -- Serialised payload sent to the endpoint (after signing)
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Delivery lifecycle: pending | delivering | delivered | failed | dead
  status text NOT NULL DEFAULT 'pending',
  -- HTTP response code from the target (NULL while pending/delivering)
  response_code int,
  -- Truncated response body for admin visibility
  response_body text,
  -- How many delivery attempts have been made
  attempts int NOT NULL DEFAULT 0,
  -- Earliest time we may send the next attempt (NULL = send now)
  next_attempt_at timestamptz,
  -- When the most recent attempt was dispatched
  last_attempted_at timestamptz,
  -- Idempotency: the operation log ID that triggered this delivery
  source_operation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_delivery_workspace_idx ON webhook_delivery (workspace_id);
CREATE INDEX IF NOT EXISTS webhook_delivery_webhook_idx ON webhook_delivery (webhook_id);
CREATE INDEX IF NOT EXISTS webhook_delivery_status_next_idx ON webhook_delivery (status, next_attempt_at)
  WHERE status IN ('pending', 'delivering');
CREATE INDEX IF NOT EXISTS webhook_delivery_source_op_idx ON webhook_delivery (source_operation_id)
  WHERE source_operation_id IS NOT NULL;
