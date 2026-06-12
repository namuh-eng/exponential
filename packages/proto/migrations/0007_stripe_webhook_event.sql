CREATE TABLE IF NOT EXISTS stripe_webhook_event (
  id text PRIMARY KEY,
  type text NOT NULL,
  livemode boolean NOT NULL,
  outcome text NOT NULL DEFAULT 'processing',
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
