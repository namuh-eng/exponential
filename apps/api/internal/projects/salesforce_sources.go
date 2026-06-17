package projects

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (h Handler) queueSalesforceProjectAutomations(ctx context.Context, tx pgx.Tx, workspaceID string, before Project, after Project) error {
	statusChanged := before.Status != after.Status
	priorityChanged := before.Priority != after.Priority
	if !statusChanged && !priorityChanged {
		return nil
	}
	rows, err := tx.Query(ctx, `
		select itl.workspace_integration_id::text,
			coalesce(itl.source_event_id,''),
			coalesce(itl.external_message_ts,'')
		from integration_thread_link itl
		join workspace_integration wi on wi.id=itl.workspace_integration_id
		where itl.project_id=$1::uuid
			and itl.provider='salesforce'
			and wi.provider='salesforce'
			and wi.status in ('connected','degraded')`, after.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var integrationID, caseID, caseNumber string
		if err := rows.Scan(&integrationID, &caseID, &caseNumber); err != nil {
			return err
		}
		payload := salesforceProjectStatusPayload(after, caseID, caseNumber)
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at) values ($1::uuid,$2::uuid,'salesforce','outbound_delivery','queued',$3::jsonb,now(),now())`, workspaceID, integrationID, raw); err != nil {
			return err
		}
	}
	return rows.Err()
}

func salesforceProjectStatusPayload(project Project, caseID string, caseNumber string) map[string]any {
	return map[string]any{
		"type":        "sync_project_status",
		"caseId":      caseID,
		"caseNumber":  caseNumber,
		"projectId":   project.ID,
		"projectName": project.Name,
		"projectSlug": project.Slug,
		"status":      project.Status,
		"priority":    project.Priority,
		"projectUrl":  strings.TrimRight(configuredProjectAppURL(), "/") + "/project/" + url.PathEscape(project.Slug),
	}
}

func configuredProjectAppURL() string {
	if v := strings.TrimSpace(os.Getenv("EXPONENTIAL_APP_URL")); v != "" {
		return v
	}
	return "http://localhost:7015"
}
