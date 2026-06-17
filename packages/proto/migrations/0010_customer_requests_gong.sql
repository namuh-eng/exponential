CREATE TABLE IF NOT EXISTS customer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  domain text,
  source_provider varchar(64) NOT NULL,
  source_external_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_source_idx
  ON customer (workspace_id, source_provider, source_external_id);

CREATE INDEX IF NOT EXISTS customer_workspace_domain_idx
  ON customer (workspace_id, domain);

CREATE TABLE IF NOT EXISTS customer_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  issue_id uuid REFERENCES issue(id) ON DELETE SET NULL,
  source_provider varchar(64) NOT NULL,
  source_external_id text NOT NULL,
  source_url text,
  title varchar(500) NOT NULL,
  excerpt text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_request_source_idx
  ON customer_request (workspace_id, source_provider, source_external_id);

CREATE INDEX IF NOT EXISTS customer_request_issue_idx
  ON customer_request (issue_id);

CREATE INDEX IF NOT EXISTS customer_request_customer_idx
  ON customer_request (customer_id, created_at DESC);
