-- Keep legacy Gong customer-request columns from blocking first-class customer requests.
-- Some environments already ran 0010_customer_requests_gong.sql before the
-- normalized 0011_customer_requests.sql migration. Those legacy columns are no
-- longer required by the application, so make them nullable in a forward-only
-- migration instead of rewriting the existing migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer' AND column_name = 'source_provider') THEN
    ALTER TABLE customer ALTER COLUMN source_provider DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer' AND column_name = 'source_external_id') THEN
    ALTER TABLE customer ALTER COLUMN source_external_id DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_request' AND column_name = 'source_provider') THEN
    ALTER TABLE customer_request ALTER COLUMN source_provider DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_request' AND column_name = 'source_external_id') THEN
    ALTER TABLE customer_request ALTER COLUMN source_external_id DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'customer_request' AND column_name = 'excerpt') THEN
    ALTER TABLE customer_request ALTER COLUMN excerpt DROP NOT NULL;
  END IF;
END $$;
