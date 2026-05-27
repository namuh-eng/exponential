-- Replace raw session.token with token_hash (sha256 hex). The Go SQL migrator
-- applies this explicitly so deploys never depend on interactive schema prompts.
-- Existing rows are dropped: raw tokens cannot be recovered from the old
-- column, and users have to sign in again.

TRUNCATE TABLE session;

ALTER TABLE session DROP COLUMN IF EXISTS token;
ALTER TABLE session ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE session ALTER COLUMN token_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS session_token_hash_unique ON session(token_hash);
