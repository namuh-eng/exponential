-- First-class customer request entities and links to product work.
CREATE TABLE IF NOT EXISTS customer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  domain text,
  name varchar(255) NOT NULL,
  revenue numeric(14,2),
  size integer,
  tier varchar(80),
  status varchar(80),
  owner_id text REFERENCES "user"(id) ON DELETE SET NULL,
  source varchar(120),
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE customer ADD COLUMN IF NOT EXISTS domain text;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS revenue numeric(14,2);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS size integer;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS tier varchar(80);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS status varchar(80);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS owner_id text REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS source varchar(120);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now();
ALTER TABLE customer ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS customer_workspace_idx ON customer (workspace_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS customer_workspace_domain_unique_idx
  ON customer (workspace_id, lower(domain)) WHERE domain IS NOT NULL AND btrim(domain) <> '';

CREATE TABLE IF NOT EXISTS customer_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  title varchar(255) NOT NULL,
  body text,
  source varchar(120),
  source_url text,
  external_provider varchar(120),
  external_id text,
  important boolean NOT NULL DEFAULT false,
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS source varchar(120);
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS external_provider varchar(120);
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS important boolean NOT NULL DEFAULT false;
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now();
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS customer_request_workspace_idx ON customer_request (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_request_customer_idx ON customer_request (customer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS customer_request_external_unique_idx
  ON customer_request (workspace_id, external_provider, external_id)
  WHERE external_provider IS NOT NULL AND external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS issue_customer_request (
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  customer_request_id uuid NOT NULL REFERENCES customer_request(id) ON DELETE CASCADE,
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, customer_request_id)
);

CREATE INDEX IF NOT EXISTS issue_customer_request_request_idx ON issue_customer_request (customer_request_id);

CREATE TABLE IF NOT EXISTS project_customer_request (
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  customer_request_id uuid NOT NULL REFERENCES customer_request(id) ON DELETE CASCADE,
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, customer_request_id)
);

CREATE INDEX IF NOT EXISTS project_customer_request_request_idx ON project_customer_request (customer_request_id);
