-- name: GetIssueByID :one
SELECT
  i.id,
  i.number,
  i.identifier,
  i.title,
  i.description,
  i.team_id,
  i.state_id,
  i.assignee_id,
  i.creator_id,
  i.priority::text AS priority,
  i.estimate,
  i.parent_issue_id,
  i.project_id,
  i.project_milestone_id,
  i.cycle_id,
  i.due_date,
  i.sort_order,
  i.created_at,
  i.updated_at,
  i.archived_at,
  i.canceled_at,
  i.completed_at
FROM issue i
JOIN team t ON t.id = i.team_id
WHERE t.workspace_id = sqlc.arg(workspace_id)::uuid AND i.id = sqlc.arg(id)::uuid
LIMIT 1;

-- name: GetIssueByIdentifier :one
SELECT
  i.id,
  i.number,
  i.identifier,
  i.title,
  i.description,
  i.team_id,
  i.state_id,
  i.assignee_id,
  i.creator_id,
  i.priority::text AS priority,
  i.estimate,
  i.parent_issue_id,
  i.project_id,
  i.project_milestone_id,
  i.cycle_id,
  i.due_date,
  i.sort_order,
  i.created_at,
  i.updated_at,
  i.archived_at,
  i.canceled_at,
  i.completed_at
FROM issue i
JOIN team t ON t.id = i.team_id
WHERE t.workspace_id = sqlc.arg(workspace_id)::uuid AND i.identifier = sqlc.arg(identifier)
LIMIT 1;
