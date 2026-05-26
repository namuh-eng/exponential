-- Core schema snapshot used by SQL-first migrations and sqlc generation.
-- Existing staging databases may already have these objects from the original
-- Drizzle schema; all statements are idempotent so the migration is safe to
-- apply after those deployments.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE issue_priority AS ENUM ('none', 'urgent', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_state_category AS ENUM ('triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  slug varchar(255) NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  image text,
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(255) NOT NULL,
  key varchar(10) NOT NULL,
  workspace_id uuid NOT NULL,
  icon text,
  is_private boolean DEFAULT false,
  timezone varchar(100),
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
CREATE UNIQUE INDEX IF NOT EXISTS team_workspace_key_idx ON team (workspace_id, key);
CREATE INDEX IF NOT EXISTS team_workspace_idx ON team (workspace_id);

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
