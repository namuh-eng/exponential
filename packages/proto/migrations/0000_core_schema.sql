-- Core schema snapshot used by SQL-first migrations and sqlc generation.
-- Existing staging databases may already have these objects from the original
-- web-owned schema snapshot; all statements are idempotent so the migration is
-- safe to apply after those deployments.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE issue_priority AS ENUM ('none', 'urgent', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_state_category AS ENUM ('triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member', 'guest');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workspace_invitation_status AS ENUM ('pending', 'accepted', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE estimate_type AS ENUM ('not_in_use', 'linear', 'exponential', 'tshirt');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE issue_relation_type AS ENUM ('blocks', 'blocked_by', 'duplicate', 'related');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE project_status AS ENUM ('planned', 'started', 'paused', 'completed', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE project_priority AS ENUM ('none', 'urgent', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE initiative_status AS ENUM ('active', 'planned', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM ('assigned', 'mentioned', 'status_change', 'comment', 'duplicate');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE view_layout AS ENUM ('list', 'board', 'timeline');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE issue_history_event_type AS ENUM ('created', 'updated', 'comment_created');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  url_slug varchar(63) NOT NULL UNIQUE,
  logo_url text,
  invite_link_enabled boolean DEFAULT true,
  invite_link_token text,
  approved_email_domains jsonb DEFAULT '[]'::jsonb,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE workspace ADD COLUMN IF NOT EXISTS url_slug varchar(63);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'workspace' AND column_name = 'slug'
  ) THEN
    EXECUTE 'UPDATE workspace SET url_slug = slug WHERE url_slug IS NULL';
  END IF;
END $$;
ALTER TABLE workspace ALTER COLUMN url_slug SET NOT NULL;
ALTER TABLE workspace ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE workspace ADD COLUMN IF NOT EXISTS invite_link_enabled boolean DEFAULT true;
ALTER TABLE workspace ADD COLUMN IF NOT EXISTS invite_link_token text;
ALTER TABLE workspace ADD COLUMN IF NOT EXISTS approved_email_domains jsonb DEFAULT '[]'::jsonb;
ALTER TABLE workspace ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_url_slug_idx ON workspace (url_slug);

CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  image text,
  email_verified boolean NOT NULL DEFAULT false,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS settings jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS session (
  id text PRIMARY KEY,
  expires_at timestamp NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS session_token_hash_unique ON session (token_hash);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session (user_id);

CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamp,
  refresh_token_expires_at timestamp,
  scope text,
  password text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account (user_id);

CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamp NOT NULL,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier);

CREATE TABLE IF NOT EXISTS passkey (
  id text PRIMARY KEY,
  name text,
  public_key text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  counter integer NOT NULL,
  device_type text NOT NULL,
  backed_up boolean NOT NULL,
  transports text,
  aaguid text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passkey_user_id_idx ON passkey (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS passkey_credential_id_idx ON passkey (credential_id);

CREATE TABLE IF NOT EXISTS member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'member',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS member_user_workspace_idx ON member (user_id, workspace_id);
CREATE INDEX IF NOT EXISTS member_workspace_idx ON member (workspace_id);

CREATE TABLE IF NOT EXISTS workspace_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  email text NOT NULL,
  role member_role NOT NULL DEFAULT 'member',
  invited_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  status workspace_invitation_status NOT NULL DEFAULT 'pending',
  accepted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitation_workspace_email_idx
  ON workspace_invitation (workspace_id, email);

CREATE TABLE IF NOT EXISTS team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  key varchar(10) NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  icon text,
  is_private boolean DEFAULT false,
  timezone varchar(100),
  estimate_type estimate_type DEFAULT 'not_in_use',
  triage_enabled boolean DEFAULT true,
  cycles_enabled boolean DEFAULT false,
  cycle_start_day integer,
  cycle_duration_weeks integer,
  parent_team_id uuid,
  issue_count integer DEFAULT 0,
  settings jsonb DEFAULT '{}'::jsonb,
  retired_at timestamp,
  deleted_at timestamp,
  delete_scheduled_at timestamp,
  restorable_until timestamp,
  restored_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE team ADD COLUMN IF NOT EXISTS estimate_type estimate_type DEFAULT 'not_in_use';
ALTER TABLE team ADD COLUMN IF NOT EXISTS triage_enabled boolean DEFAULT true;
ALTER TABLE team ADD COLUMN IF NOT EXISTS cycles_enabled boolean DEFAULT false;
ALTER TABLE team ADD COLUMN IF NOT EXISTS cycle_start_day integer;
ALTER TABLE team ADD COLUMN IF NOT EXISTS cycle_duration_weeks integer;
CREATE UNIQUE INDEX IF NOT EXISTS team_workspace_key_idx ON team (workspace_id, key);
CREATE INDEX IF NOT EXISTS team_workspace_idx ON team (workspace_id);

CREATE TABLE IF NOT EXISTS team_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_member_team_user_idx ON team_member (team_id, user_id);
CREATE INDEX IF NOT EXISTS team_member_user_idx ON team_member (user_id);

CREATE TABLE IF NOT EXISTS workflow_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  team_id uuid NOT NULL,
  category workflow_state_category NOT NULL,
  color varchar(7) NOT NULL DEFAULT '#6b6f76',
  description text,
  position real NOT NULL DEFAULT 0,
  is_default boolean DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_state_team_idx ON workflow_state (team_id);

CREATE TABLE IF NOT EXISTS issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number integer NOT NULL,
  identifier varchar(20) NOT NULL,
  title varchar(500) NOT NULL,
  description text,
  team_id uuid NOT NULL,
  state_id uuid NOT NULL,
  assignee_id text,
  creator_id text NOT NULL,
  priority issue_priority NOT NULL DEFAULT 'none',
  estimate real,
  parent_issue_id uuid,
  project_id uuid,
  project_milestone_id uuid,
  cycle_id uuid,
  due_date timestamp,
  sort_order real NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  archived_at timestamp,
  canceled_at timestamp,
  completed_at timestamp
);
CREATE INDEX IF NOT EXISTS issue_team_idx ON issue (team_id);
CREATE INDEX IF NOT EXISTS issue_state_idx ON issue (state_id);
CREATE INDEX IF NOT EXISTS issue_assignee_idx ON issue (assignee_id);
CREATE INDEX IF NOT EXISTS issue_project_idx ON issue (project_id);
CREATE INDEX IF NOT EXISTS issue_cycle_idx ON issue (cycle_id);
CREATE INDEX IF NOT EXISTS issue_creator_idx ON issue (creator_id);
CREATE UNIQUE INDEX IF NOT EXISTS issue_team_number_idx ON issue (team_id, number);

CREATE TABLE IF NOT EXISTS authorized_application_grant (
  id text PRIMARY KEY,
  workspace_id uuid,
  user_id text NOT NULL,
  app_id text NOT NULL,
  client_id text NOT NULL,
  name varchar(255) NOT NULL,
  image_url text,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  webhooks_enabled boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS authorized_application_grant_user_idx ON authorized_application_grant (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS authorized_application_grant_user_app_idx ON authorized_application_grant (user_id, app_id);

CREATE TABLE IF NOT EXISTS api_key (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  key_hash text NOT NULL UNIQUE,
  key_prefix varchar(20) NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  last_used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_key_workspace_idx ON api_key (workspace_id);
CREATE INDEX IF NOT EXISTS api_key_user_idx ON api_key (user_id);

CREATE TABLE IF NOT EXISTS workspace_integration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider varchar(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'connected',
  external_id text,
  display_name varchar(255),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  connected_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  connected_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_integration_workspace_idx ON workspace_integration (workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_integration_workspace_provider_idx ON workspace_integration (workspace_id, provider);

CREATE TABLE IF NOT EXISTS team_notification_integration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  workspace_integration_id uuid REFERENCES workspace_integration(id) ON DELETE SET NULL,
  provider varchar(64) NOT NULL,
  channel_id text,
  channel_name varchar(255),
  enabled boolean NOT NULL DEFAULT false,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_notification_integration_team_idx ON team_notification_integration (team_id);
CREATE UNIQUE INDEX IF NOT EXISTS team_notification_integration_team_provider_idx ON team_notification_integration (team_id, provider);

CREATE TABLE IF NOT EXISTS label (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  color varchar(7) NOT NULL DEFAULT '#6b6f76',
  description text,
  workspace_id uuid REFERENCES workspace(id) ON DELETE CASCADE,
  team_id uuid REFERENCES team(id) ON DELETE CASCADE,
  parent_label_id uuid,
  archived_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS label_workspace_idx ON label (workspace_id);
CREATE INDEX IF NOT EXISTS label_team_idx ON label (team_id);

CREATE TABLE IF NOT EXISTS project_label (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  color varchar(7) NOT NULL DEFAULT '#6b6f76',
  description text,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_label_workspace_idx ON project_label (workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS project_label_workspace_name_idx ON project_label (workspace_id, name);

CREATE TABLE IF NOT EXISTS project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  description text,
  icon varchar(10),
  slug varchar(255) NOT NULL,
  status project_status NOT NULL DEFAULT 'planned',
  priority project_priority NOT NULL DEFAULT 'none',
  lead_id text REFERENCES "user"(id) ON DELETE SET NULL,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  start_date timestamp,
  target_date timestamp,
  completed_at timestamp,
  canceled_at timestamp,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_workspace_idx ON project (workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS project_workspace_slug_idx ON project (workspace_id, slug);

CREATE TABLE IF NOT EXISTS project_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  description text,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  created_by_id text REFERENCES "user"(id) ON DELETE SET NULL,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_template_workspace_idx ON project_template (workspace_id);

CREATE TABLE IF NOT EXISTS issue_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  description text NOT NULL,
  template_type varchar(32) NOT NULL DEFAULT 'issue',
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id uuid REFERENCES team(id) ON DELETE CASCADE,
  created_by_id text REFERENCES "user"(id) ON DELETE SET NULL,
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issue_template_workspace_idx ON issue_template (workspace_id);
CREATE INDEX IF NOT EXISTS issue_template_team_idx ON issue_template (team_id);

CREATE TABLE IF NOT EXISTS project_team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS project_team_project_team_idx ON project_team (project_id, team_id);

CREATE TABLE IF NOT EXISTS project_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS project_member_project_user_idx ON project_member (project_id, user_id);

CREATE TABLE IF NOT EXISTS project_milestone (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  sort_order real NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_milestone_project_idx ON project_milestone (project_id);

CREATE TABLE IF NOT EXISTS cycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255),
  number integer NOT NULL,
  team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  start_date timestamp NOT NULL,
  end_date timestamp NOT NULL,
  auto_rollover boolean DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cycle_team_idx ON cycle (team_id);

CREATE TABLE IF NOT EXISTS issue_label (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES label(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS issue_label_issue_label_idx ON issue_label (issue_id, label_id);

CREATE TABLE IF NOT EXISTS issue_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  actor_id text REFERENCES "user"(id) ON DELETE SET NULL,
  actor_name text,
  actor_email text,
  event_type issue_history_event_type NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issue_history_issue_created_idx ON issue_history (issue_id, created_at);
CREATE INDEX IF NOT EXISTS issue_history_actor_idx ON issue_history (actor_id);

CREATE TABLE IF NOT EXISTS issue_relation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  related_issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  type issue_relation_type NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issue_relation_issue_idx ON issue_relation (issue_id);
CREATE INDEX IF NOT EXISTS issue_relation_related_idx ON issue_relation (related_issue_id);

CREATE TABLE IF NOT EXISTS comment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body text NOT NULL,
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comment_issue_idx ON comment (issue_id);

CREATE TABLE IF NOT EXISTS issue_discussion_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  status varchar(24) NOT NULL DEFAULT 'ready',
  summary text,
  source_comment_count integer NOT NULL DEFAULT 0,
  source_comment_version text,
  generated_at timestamp,
  generated_by text REFERENCES "user"(id) ON DELETE SET NULL,
  stale_at timestamp,
  error text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS issue_discussion_summary_issue_idx ON issue_discussion_summary (issue_id);
CREATE INDEX IF NOT EXISTS issue_discussion_summary_team_idx ON issue_discussion_summary (team_id);
CREATE INDEX IF NOT EXISTS issue_discussion_summary_workspace_idx ON issue_discussion_summary (workspace_id);

CREATE TABLE IF NOT EXISTS issue_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  subscribed boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS issue_subscription_issue_user_idx ON issue_subscription (issue_id, user_id);
CREATE INDEX IF NOT EXISTS issue_subscription_issue_idx ON issue_subscription (issue_id);
CREATE INDEX IF NOT EXISTS issue_subscription_user_idx ON issue_subscription (user_id);

CREATE TABLE IF NOT EXISTS issue_reaction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emoji varchar(50) NOT NULL,
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS issue_reaction_issue_user_emoji_idx ON issue_reaction (issue_id, user_id, emoji);
CREATE INDEX IF NOT EXISTS issue_reaction_issue_idx ON issue_reaction (issue_id);

CREATE TABLE IF NOT EXISTS reaction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emoji varchar(50) NOT NULL,
  comment_id uuid NOT NULL REFERENCES comment(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reaction_comment_user_emoji_idx ON reaction (comment_id, user_id, emoji);

CREATE TABLE IF NOT EXISTS comment_attachment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES comment(id) ON DELETE CASCADE,
  file_name varchar(500) NOT NULL,
  storage_key varchar(1024) NOT NULL,
  content_type varchar(255) NOT NULL,
  size integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comment_attachment_comment_idx ON comment_attachment (comment_id);

CREATE TABLE IF NOT EXISTS recurring_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  creator_id text REFERENCES "user"(id) ON DELETE SET NULL,
  title varchar(500) NOT NULL,
  description text,
  state_id uuid REFERENCES workflow_state(id) ON DELETE SET NULL,
  assignee_id text REFERENCES "user"(id) ON DELETE SET NULL,
  priority issue_priority NOT NULL DEFAULT 'none',
  label_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  project_id uuid REFERENCES project(id) ON DELETE SET NULL,
  cadence_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone varchar(100) NOT NULL DEFAULT 'UTC',
  start_at timestamp,
  next_run_at timestamp NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_issue_workspace_idx ON recurring_issue (workspace_id);
CREATE INDEX IF NOT EXISTS recurring_issue_team_idx ON recurring_issue (team_id);
CREATE INDEX IF NOT EXISTS recurring_issue_next_run_idx ON recurring_issue (next_run_at);

CREATE TABLE IF NOT EXISTS initiative (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  description text,
  status initiative_status NOT NULL DEFAULT 'planned',
  owner_id text REFERENCES "user"(id) ON DELETE SET NULL,
  start_date timestamp,
  target_date timestamp,
  timeframe varchar(120),
  health varchar(20) NOT NULL DEFAULT 'unknown',
  settings jsonb DEFAULT '{}'::jsonb,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  parent_initiative_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS initiative_workspace_idx ON initiative (workspace_id);

CREATE TABLE IF NOT EXISTS initiative_team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid NOT NULL REFERENCES initiative(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS initiative_team_idx ON initiative_team (initiative_id, team_id);
CREATE INDEX IF NOT EXISTS initiative_team_initiative_idx ON initiative_team (initiative_id);

CREATE TABLE IF NOT EXISTS initiative_project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid NOT NULL REFERENCES initiative(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS initiative_project_idx ON initiative_project (initiative_id, project_id);

CREATE TABLE IF NOT EXISTS custom_view (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  filter_state jsonb DEFAULT '{}'::jsonb,
  layout view_layout NOT NULL DEFAULT 'list',
  is_personal boolean DEFAULT true,
  team_id uuid REFERENCES team(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_view_workspace_idx ON custom_view (workspace_id);
CREATE INDEX IF NOT EXISTS custom_view_owner_idx ON custom_view (owner_id);

CREATE TABLE IF NOT EXISTS notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  issue_id uuid REFERENCES issue(id) ON DELETE CASCADE,
  actor_id text REFERENCES "user"(id) ON DELETE SET NULL,
  type notification_type NOT NULL,
  read_at timestamp,
  snoozed_until_at timestamp,
  unsnoozed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_user_idx ON notification (user_id);
CREATE INDEX IF NOT EXISTS notification_issue_idx ON notification (issue_id);

CREATE TABLE IF NOT EXISTS webhook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  label varchar(255),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  secret text,
  enabled boolean DEFAULT true,
  events jsonb DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_workspace_idx ON webhook (workspace_id);
