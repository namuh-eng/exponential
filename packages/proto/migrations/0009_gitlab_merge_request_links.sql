ALTER TYPE issue_history_event_type ADD VALUE IF NOT EXISTS 'gitlab_merge_request';

CREATE TABLE IF NOT EXISTS gitlab_merge_request_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_integration_id uuid REFERENCES workspace_integration(id) ON DELETE SET NULL,
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  project_path text,
  project_url text,
  merge_request_iid text NOT NULL,
  merge_request_id text,
  title text NOT NULL,
  url text,
  source_branch text,
  target_branch text,
  state text,
  last_action text NOT NULL,
  last_event_key text NOT NULL,
  merged_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gitlab_merge_request_link_issue_mr_idx
  ON gitlab_merge_request_link (workspace_integration_id, issue_id, project_id, merge_request_iid)
  WHERE workspace_integration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gitlab_merge_request_link_issue_idx
  ON gitlab_merge_request_link (issue_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS gitlab_workflow_automation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_integration_id uuid NOT NULL REFERENCES workspace_integration(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  merge_request_merged_state_id uuid NOT NULL REFERENCES workflow_state(id) ON DELETE CASCADE,
  updated_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gitlab_workflow_automation_team_idx
  ON gitlab_workflow_automation (team_id);

CREATE INDEX IF NOT EXISTS gitlab_workflow_automation_integration_idx
  ON gitlab_workflow_automation (workspace_integration_id);
