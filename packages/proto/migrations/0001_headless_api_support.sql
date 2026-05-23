CREATE TABLE IF NOT EXISTS idempotency_key (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  user_id text NOT NULL,
  status_code integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idempotency_key_unique_idx
  ON idempotency_key (key, method, path, user_id);
CREATE INDEX IF NOT EXISTS idempotency_key_expires_idx ON idempotency_key (expires_at);
