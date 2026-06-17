-- Reconcile the customer / customer_request schema shared by two features that
-- independently introduced the same tables on parallel branches:
--   * 0010_customer_requests_gong.sql  (Gong call-finding ingestion)
--   * 0011_customer_requests.sql        (first-class customer-requests CRM)
--
-- The Gong migration created the provider-tracking columns as NOT NULL, which
-- blocks the CRM feature's inserts (apps/api/internal/customers) that never set
-- them. This migration makes the schema a coherent superset: every column from
-- both features exists, and the provider columns are nullable so CRM rows are
-- valid. It is idempotent and order-independent (ADD COLUMN IF NOT EXISTS before
-- DROP NOT NULL), so it heals both fresh databases and environments where either
-- migration ran first.

-- Guarantee the Gong provider columns exist regardless of which migration won
-- the CREATE TABLE race.
ALTER TABLE customer ADD COLUMN IF NOT EXISTS source_provider varchar(64);
ALTER TABLE customer ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE customer ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS issue_id uuid REFERENCES issue(id) ON DELETE SET NULL;
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS source_provider varchar(64);
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS source_external_id text;
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS excerpt text;
ALTER TABLE customer_request ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Drop NOT NULL on the Gong-only columns so CRM inserts (which omit them) succeed.
ALTER TABLE customer ALTER COLUMN source_provider DROP NOT NULL;
ALTER TABLE customer ALTER COLUMN source_external_id DROP NOT NULL;
ALTER TABLE customer_request ALTER COLUMN source_provider DROP NOT NULL;
ALTER TABLE customer_request ALTER COLUMN source_external_id DROP NOT NULL;
ALTER TABLE customer_request ALTER COLUMN excerpt DROP NOT NULL;

-- Ensure the upsert target indexes both features rely on exist. NULL provider
-- values (CRM rows) are distinct under a unique index, so they never collide.
CREATE UNIQUE INDEX IF NOT EXISTS customer_source_idx
  ON customer (workspace_id, source_provider, source_external_id);
CREATE UNIQUE INDEX IF NOT EXISTS customer_request_source_idx
  ON customer_request (workspace_id, source_provider, source_external_id);
