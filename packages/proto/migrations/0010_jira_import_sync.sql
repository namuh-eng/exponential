CREATE TABLE IF NOT EXISTS jira_project_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_integration_id uuid NOT NULL REFERENCES workspace_integration(id) ON DELETE CASCADE,
  deployment_type varchar(16) NOT NULL DEFAULT 'cloud',
  jira_project_id text NOT NULL,
  jira_project_key text NOT NULL,
  jira_project_name text NOT NULL,
  team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  status_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  label_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  forward_sync_enabled boolean NOT NULL DEFAULT false,
  paused_at timestamp,
  paused_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  updated_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CHECK (deployment_type IN ('cloud','server'))
);
CREATE UNIQUE INDEX IF NOT EXISTS jira_project_mapping_project_team_idx
  ON jira_project_mapping (workspace_integration_id, jira_project_id, team_id);
CREATE INDEX IF NOT EXISTS jira_project_mapping_workspace_idx
  ON jira_project_mapping (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS jira_issue_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_integration_id uuid NOT NULL REFERENCES workspace_integration(id) ON DELETE CASCADE,
  jira_project_id text NOT NULL,
  jira_project_key text NOT NULL,
  jira_issue_id text NOT NULL,
  jira_issue_key text NOT NULL,
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  last_jira_updated_at timestamp,
  last_imported_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS jira_issue_link_source_idx
  ON jira_issue_link (workspace_integration_id, jira_issue_id);
CREATE UNIQUE INDEX IF NOT EXISTS jira_issue_link_issue_idx
  ON jira_issue_link (workspace_integration_id, issue_id);
CREATE INDEX IF NOT EXISTS jira_issue_link_workspace_idx
  ON jira_issue_link (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS jira_comment_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_integration_id uuid NOT NULL REFERENCES workspace_integration(id) ON DELETE CASCADE,
  jira_issue_id text NOT NULL,
  jira_comment_id text NOT NULL,
  comment_id uuid NOT NULL REFERENCES comment(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS jira_comment_link_source_idx
  ON jira_comment_link (workspace_integration_id, jira_comment_id);
CREATE INDEX IF NOT EXISTS jira_comment_link_issue_idx
  ON jira_comment_link (workspace_integration_id, jira_issue_id);
