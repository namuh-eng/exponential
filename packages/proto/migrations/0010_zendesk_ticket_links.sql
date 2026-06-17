CREATE TABLE IF NOT EXISTS zendesk_ticket_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  workspace_integration_id uuid REFERENCES workspace_integration(id) ON DELETE SET NULL,
  issue_id uuid NOT NULL REFERENCES issue(id) ON DELETE CASCADE,
  ticket_id text NOT NULL,
  ticket_url text,
  ticket_status text,
  requester_id text,
  requester_name text,
  requester_email text,
  organization_id text,
  organization_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS zendesk_ticket_link_integration_ticket_idx
  ON zendesk_ticket_link (workspace_integration_id, ticket_id)
  WHERE workspace_integration_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS zendesk_ticket_link_issue_idx
  ON zendesk_ticket_link (issue_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS zendesk_ticket_link_ticket_idx
  ON zendesk_ticket_link (ticket_id);
