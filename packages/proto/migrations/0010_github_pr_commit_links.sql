ALTER TYPE issue_history_event_type ADD VALUE IF NOT EXISTS 'github_pull_request';
ALTER TYPE issue_history_event_type ADD VALUE IF NOT EXISTS 'github_commit';

CREATE TABLE IF NOT EXISTS github_repository_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_integration_id uuid NOT NULL REFERENCES workspace_integration(id) ON DELETE CASCADE,
  repository_id text NOT NULL,
  owner text NOT NULL,
  name text NOT NULL,
  full_name text NOT NULL,
  html_url text,
  team_id uuid REFERENCES team(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS github_repository_mapping_repo_idx
  ON github_repository_mapping (workspace_integration_id, repository_id);

CREATE INDEX IF NOT EXISTS github_repository_mapping_team_idx
  ON github_repository_mapping (team_id);

CREATE TABLE IF NOT EXISTS github_pull_request_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_integration_id uuid REFERENCES workspace_integration(id) ON DELETE SET NULL,
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  repository_id text NOT NULL,
  repository_full_name text NOT NULL,
  repository_url text,
  pull_request_number text NOT NULL,
  pull_request_id text,
  title text NOT NULL,
  url text,
  head_ref text,
  base_ref text,
  state text,
  last_action text NOT NULL,
  last_event_key text NOT NULL,
  merged_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS github_pull_request_link_issue_pr_idx
  ON github_pull_request_link (workspace_integration_id, issue_id, repository_id, pull_request_number)
  WHERE workspace_integration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS github_pull_request_link_issue_idx
  ON github_pull_request_link (issue_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS github_commit_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_integration_id uuid REFERENCES workspace_integration(id) ON DELETE SET NULL,
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  repository_id text NOT NULL,
  repository_full_name text NOT NULL,
  repository_url text,
  sha text NOT NULL,
  message text NOT NULL,
  url text,
  author_name text,
  author_email text,
  last_event_key text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS github_commit_link_issue_sha_idx
  ON github_commit_link (workspace_integration_id, issue_id, repository_id, sha)
  WHERE workspace_integration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS github_commit_link_issue_idx
  ON github_commit_link (issue_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS github_workflow_automation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_integration_id uuid NOT NULL REFERENCES workspace_integration(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  pull_request_merged_state_id uuid NOT NULL REFERENCES workflow_state(id) ON DELETE CASCADE,
  updated_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS github_workflow_automation_team_idx
  ON github_workflow_automation (team_id);

CREATE INDEX IF NOT EXISTS github_workflow_automation_integration_idx
  ON github_workflow_automation (workspace_integration_id);
