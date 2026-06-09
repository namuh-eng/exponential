-- Backfill the Linear-style triage workflow state for teams that have triage
-- enabled but were created before backend defaults included a triage status.
lock table workflow_state in share row exclusive mode;

insert into workflow_state (team_id, name, category, color, position, is_default, updated_at)
select
  t.id,
  'Triage',
  'triage'::workflow_state_category,
  '#f59e0b',
  coalesce((select min(ws.position) from workflow_state ws where ws.team_id = t.id), 0) - 1,
  true,
  now()
from team t
where coalesce(t.triage_enabled, true) = true
  and t.deleted_at is null
  and not exists (
    select 1
    from workflow_state existing
    where existing.team_id = t.id
      and existing.category = 'triage'
  );
