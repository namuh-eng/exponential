package issues

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (h Handler) queueSalesforceAutomations(ctx context.Context, tx pgx.Tx, workspaceID string, before Issue, after Issue) error {
	stateChanged := before.StateID != after.StateID
	priorityChanged := before.Priority != after.Priority
	projectChanged := stringPtrValue(before.ProjectID) != stringPtrValue(after.ProjectID)
	if !stateChanged && !priorityChanged && !projectChanged {
		return nil
	}
	rows, err := tx.Query(ctx, `
		select itl.workspace_integration_id::text,
			coalesce(itl.source_event_id,''),
			coalesce(itl.external_message_ts,''),
			coalesce(itl.external_permalink,''),
			coalesce(wi.metadata,'{}'::jsonb),
			coalesce(t.key,'')
		from integration_thread_link itl
		join workspace_integration wi on wi.id=itl.workspace_integration_id
		join team t on t.id=$2::uuid
		where itl.issue_id=$1::uuid and itl.provider='salesforce' and wi.provider='salesforce' and wi.status in ('connected','degraded')`, after.ID, after.TeamID)
	if err != nil {
		return err
	}
	defer rows.Close()
	links := []struct {
		IntegrationID string
		CaseID        string
		CaseNumber    string
		CaseURL       string
		Metadata      map[string]any
		TeamKey       string
	}{}
	for rows.Next() {
		var metadataRaw []byte
		link := struct {
			IntegrationID string
			CaseID        string
			CaseNumber    string
			CaseURL       string
			Metadata      map[string]any
			TeamKey       string
		}{Metadata: map[string]any{}}
		if err := rows.Scan(&link.IntegrationID, &link.CaseID, &link.CaseNumber, &link.CaseURL, &metadataRaw, &link.TeamKey); err != nil {
			return err
		}
		_ = json.Unmarshal(metadataRaw, &link.Metadata)
		links = append(links, link)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(links) == 0 {
		return nil
	}
	statusName := ""
	statusCategory := ""
	if stateChanged {
		if err := tx.QueryRow(ctx, `select name, category::text from workflow_state where id=$1::uuid`, after.StateID).Scan(&statusName, &statusCategory); err != nil {
			return err
		}
	}
	for _, link := range links {
		payload := map[string]any{
			"type":       "sync_case_status",
			"caseId":     link.CaseID,
			"caseNumber": link.CaseNumber,
			"caseUrl":    link.CaseURL,
			"issueId":    after.ID,
			"identifier": after.Identifier,
			"priority":   after.Priority,
			"issueUrl":   strings.TrimRight(configuredIssueAppURL(), "/") + "/team/" + url.PathEscape(link.TeamKey) + "/issue/" + url.PathEscape(after.Identifier),
		}
		if statusName != "" {
			payload["status"] = statusName
			payload["statusCategory"] = statusCategory
		}
		if stateChanged && (statusCategory == "completed" || statusCategory == "canceled") && boolSetting(link.Metadata, "completionFollowUpEnabled", true) {
			payload["followUp"] = "Exponential issue " + after.Identifier + " moved to " + statusCategory + "."
		}
		if err := insertSalesforceProviderJob(ctx, tx, workspaceID, link.IntegrationID, payload); err != nil {
			return err
		}
	}
	return nil
}

func insertSalesforceProviderJob(ctx context.Context, tx pgx.Tx, workspaceID string, integrationID string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at) values ($1::uuid,$2::uuid,'salesforce','outbound_delivery','queued',$3::jsonb,now(),now())`, workspaceID, integrationID, raw)
	return err
}

func configuredIssueAppURL() string {
	if v := strings.TrimSpace(os.Getenv("EXPONENTIAL_APP_URL")); v != "" {
		return v
	}
	return "http://localhost:7015"
}
