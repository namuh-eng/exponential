CREATE TABLE IF NOT EXISTS device_auth_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code_hash text NOT NULL UNIQUE,
  user_code varchar(6) NOT NULL UNIQUE,
  status varchar(32) NOT NULL DEFAULT 'pending',
  expires_at timestamp NOT NULL,
  interval_seconds integer NOT NULL DEFAULT 5,
  next_poll_at timestamp NOT NULL DEFAULT now(),
  slow_down_count integer NOT NULL DEFAULT 0,
  approved_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  approved_workspace_id uuid REFERENCES workspace(id) ON DELETE SET NULL,
  decided_at timestamp,
  token_id uuid REFERENCES personal_access_token(id) ON DELETE SET NULL,
  consumed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT device_auth_grant_status_check CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  CONSTRAINT device_auth_grant_user_code_check CHECK (user_code ~ '^[0-9]{6}$')
);

CREATE INDEX IF NOT EXISTS device_auth_grant_user_code_active_idx
  ON device_auth_grant (user_code, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS device_auth_grant_cleanup_idx
  ON device_auth_grant (expires_at, status);
