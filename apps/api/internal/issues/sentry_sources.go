package issues

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"
)

type issueExternalSource struct {
	Provider      string `json:"provider"`
	Label         string `json:"label"`
	URL           string `json:"url"`
	ExternalID    string `json:"externalId"`
	Project       string `json:"project"`
	IntegrationID string `json:"integrationId"`
}

func (h Handler) issueExternalSources(ctx context.Context, issueID string) ([]issueExternalSource, error) {
	rows, err := h.DB.Query(ctx, `
		select provider,
			coalesce(external_permalink,''),
			coalesce(source_event_id,''),
			coalesce(external_channel_id,''),
			coalesce(workspace_integration_id::text,'')
		from integration_thread_link
		where issue_id=$1::uuid and provider in ('sentry','salesforce') and external_permalink is not null
		order by created_at asc`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []issueExternalSource{}
	for rows.Next() {
		var source issueExternalSource
		if err := rows.Scan(&source.Provider, &source.URL, &source.ExternalID, &source.Project, &source.IntegrationID); err != nil {
			return nil, err
		}
		source.Label = sourceLabel(source.Provider, source.Project, source.ExternalID)
		out = append(out, source)
	}
	return out, rows.Err()
}

func sourceLabel(provider string, project string, externalID string) string {
	if provider == "sentry" {
		parts := []string{"Sentry"}
		if strings.TrimSpace(project) != "" && project != "sentry" {
			parts = append(parts, project)
		}
		if strings.TrimSpace(externalID) != "" {
			parts = append(parts, externalID)
		}
		return strings.Join(parts, " · ")
	}
	if provider == "salesforce" {
		parts := []string{"Salesforce"}
		if strings.TrimSpace(externalID) != "" {
			parts = append(parts, "Case "+externalID)
		}
		return strings.Join(parts, " · ")
	}
	return provider
}

func (h Handler) queueSentryAutomations(ctx context.Context, tx pgx.Tx, workspaceID string, before Issue, after Issue) error {
	stateChanged := before.StateID != after.StateID
	assigneeChanged := stringPtrValue(before.AssigneeID) != stringPtrValue(after.AssigneeID)
	if !stateChanged && !assigneeChanged {
		return nil
	}
	rows, err := tx.Query(ctx, `
		select itl.workspace_integration_id::text,
			coalesce(itl.source_event_id,''),
			coalesce(itl.external_channel_id,''),
			coalesce(itl.external_permalink,''),
			coalesce(wi.metadata,'{}'::jsonb)
		from integration_thread_link itl
		join workspace_integration wi on wi.id=itl.workspace_integration_id
		where itl.issue_id=$1::uuid and itl.provider='sentry' and wi.provider='sentry' and wi.status in ('connected','degraded')`, after.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	links := []struct {
		IntegrationID string
		SentryIssueID string
		ProjectID     string
		WebURL        string
		Metadata      map[string]any
	}{}
	for rows.Next() {
		var metadataRaw []byte
		link := struct {
			IntegrationID string
			SentryIssueID string
			ProjectID     string
			WebURL        string
			Metadata      map[string]any
		}{Metadata: map[string]any{}}
		if err := rows.Scan(&link.IntegrationID, &link.SentryIssueID, &link.ProjectID, &link.WebURL, &metadataRaw); err != nil {
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
	category := ""
	if stateChanged {
		if err := tx.QueryRow(ctx, `select category::text from workflow_state where id=$1::uuid`, after.StateID).Scan(&category); err != nil {
			return err
		}
	}
	assigneeEmail := ""
	if assigneeChanged && after.AssigneeID != nil && *after.AssigneeID != "" {
		_ = tx.QueryRow(ctx, `select lower(email) from "user" where id=$1`, *after.AssigneeID).Scan(&assigneeEmail)
	}
	for _, link := range links {
		if stateChanged && (category == "completed" || category == "canceled") && boolSetting(link.Metadata, "autoResolve", true) {
			payload := map[string]any{"type": "resolve", "sentryIssueId": link.SentryIssueID, "projectId": link.ProjectID, "webUrl": link.WebURL, "issueId": after.ID, "identifier": after.Identifier, "category": category}
			if err := insertSentryProviderJob(ctx, tx, workspaceID, link.IntegrationID, payload); err != nil {
				return err
			}
		}
		if assigneeEmail != "" {
			sentryUserID := sentryUserForEmail(link.Metadata, assigneeEmail)
			if sentryUserID == "" {
				continue
			}
			payload := map[string]any{"type": "assign", "sentryIssueId": link.SentryIssueID, "projectId": link.ProjectID, "sentryUserId": sentryUserID, "email": assigneeEmail, "issueId": after.ID, "identifier": after.Identifier}
			if err := insertSentryProviderJob(ctx, tx, workspaceID, link.IntegrationID, payload); err != nil {
				return err
			}
		}
	}
	return nil
}

func insertSentryProviderJob(ctx context.Context, tx pgx.Tx, workspaceID string, integrationID string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at) values ($1::uuid,$2::uuid,'sentry','outbound_delivery','queued',$3::jsonb,now(),now())`, workspaceID, integrationID, raw)
	return err
}

func boolSetting(metadata map[string]any, key string, defaultValue bool) bool {
	value, ok := metadata[key]
	if !ok {
		return defaultValue
	}
	boolValue, ok := value.(bool)
	if !ok {
		return defaultValue
	}
	return boolValue
}

func sentryUserForEmail(metadata map[string]any, email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	for _, key := range []string{"sentryUserByEmail", "userEmailMap", "emailUserMap"} {
		record, ok := metadata[key].(map[string]any)
		if !ok {
			continue
		}
		if value := strings.TrimSpace(stringValue(record[email])); value != "" {
			return value
		}
	}
	return ""
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}
