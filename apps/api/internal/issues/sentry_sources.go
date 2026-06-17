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
		select provider, url, external_id, project, integration_id
		from (
			select provider,
				coalesce(external_permalink,'') as url,
				coalesce(source_event_id,'') as external_id,
				coalesce(external_channel_id,'') as project,
				coalesce(workspace_integration_id::text,'') as integration_id,
				created_at
			from integration_thread_link
			where issue_id=$1::uuid and provider in ('sentry','gong') and external_permalink is not null
			union all
			select 'zendesk' as provider,
				coalesce(ticket_url,'') as url,
				ticket_id as external_id,
				coalesce(organization_name,'') as project,
				coalesce(workspace_integration_id::text,'') as integration_id,
				created_at
			from zendesk_ticket_link
			where issue_id=$1::uuid and ticket_url is not null
		) sources
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
	if provider == "zendesk" {
		parts := []string{"Zendesk"}
		if strings.TrimSpace(project) != "" {
			parts = append(parts, project)
		}
		if strings.TrimSpace(externalID) != "" {
			parts = append(parts, "ticket "+externalID)
		}
		return strings.Join(parts, " · ")
	}
	if provider == "gong" {
		parts := []string{"Gong call"}
		if strings.TrimSpace(externalID) != "" {
			parts = append(parts, externalID)
		}
		return strings.Join(parts, " · ")
	}
	return provider
}

func (h Handler) queueProviderAutomations(ctx context.Context, tx pgx.Tx, workspaceID string, before Issue, after Issue) error {
	if err := h.queueSentryAutomations(ctx, tx, workspaceID, before, after); err != nil {
		return err
	}
	if err := h.queueGongAutomations(ctx, tx, workspaceID, before, after); err != nil {
		return err
	}
	return h.queueZendeskAutomationsForIssueState(ctx, tx, workspaceID, before, after)
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
func (h Handler) queueZendeskAutomationsForIssueState(ctx context.Context, tx pgx.Tx, workspaceID string, before Issue, after Issue) error {
	if before.StateID == after.StateID {
		return nil
	}
	var category string
	if err := tx.QueryRow(ctx, `select category::text from workflow_state where id=$1::uuid`, after.StateID).Scan(&category); err != nil {
		return err
	}
	if category != "completed" && category != "canceled" {
		return nil
	}
	return h.queueZendeskAutomations(ctx, tx, workspaceID, after, category)
}

func (h Handler) queueGongAutomations(ctx context.Context, tx pgx.Tx, workspaceID string, before Issue, after Issue) error {
	if before.StateID == after.StateID {
		return nil
	}
	var category string
	if err := tx.QueryRow(ctx, `select category::text from workflow_state where id=$1::uuid`, after.StateID).Scan(&category); err != nil {
		return err
	}
	if category != "completed" && category != "canceled" {
		return nil
	}
	rows, err := tx.Query(ctx, `
		select itl.workspace_integration_id::text,
			coalesce(itl.source_event_id,''),
			coalesce(itl.external_permalink,'')
		from integration_thread_link itl
		join workspace_integration wi on wi.id=itl.workspace_integration_id
		where itl.issue_id=$1::uuid and itl.provider='gong' and wi.provider='gong' and wi.status in ('connected','degraded')`, after.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var integrationID, findingID, sourceURL string
		if err := rows.Scan(&integrationID, &findingID, &sourceURL); err != nil {
			return err
		}
		payload := map[string]any{"type": "followup_unsupported", "issueId": after.ID, "identifier": after.Identifier, "category": category, "findingId": findingID, "sourceUrl": sourceURL}
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload)
			select $1::uuid,$2::uuid,'gong','followup_unsupported','info','Gong status writeback is not supported for this workspace.', $3::jsonb
			where not exists (
				select 1 from provider_event
				where workspace_integration_id=$2::uuid
					and provider='gong'
					and event_type='followup_unsupported'
					and payload->>'issueId'=$4
					and payload->>'category'=$5
			)`, workspaceID, integrationID, raw, after.ID, category); err != nil {
			return err
		}
	}
	return rows.Err()
}

func insertSentryProviderJob(ctx context.Context, tx pgx.Tx, workspaceID string, integrationID string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at) values ($1::uuid,$2::uuid,'sentry','outbound_delivery','queued',$3::jsonb,now(),now())`, workspaceID, integrationID, raw)
	return err
}

func (h Handler) queueZendeskAutomations(ctx context.Context, tx pgx.Tx, workspaceID string, after Issue, category string) error {
	rows, err := tx.Query(ctx, `
		select ztl.workspace_integration_id::text, ztl.ticket_id, coalesce(wi.metadata,'{}'::jsonb)
		from zendesk_ticket_link ztl
		join workspace_integration wi on wi.id=ztl.workspace_integration_id
		where ztl.issue_id=$1::uuid and wi.provider='zendesk' and wi.status in ('connected','degraded')`, after.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var integrationID, ticketID string
		var metadataRaw []byte
		if err := rows.Scan(&integrationID, &ticketID, &metadataRaw); err != nil {
			return err
		}
		metadata := readJSONRecord(metadataRaw)
		if !boolSetting(metadata, "autoFollowUp", true) {
			continue
		}
		payload := map[string]any{"type": "ticket_followup", "ticketId": ticketID, "issueId": after.ID, "identifier": after.Identifier, "category": category, "note": stringValue(metadata["closeNoteBody"])}
		if err := insertZendeskProviderJob(ctx, tx, workspaceID, integrationID, payload); err != nil {
			return err
		}
	}
	return rows.Err()
}

func insertZendeskProviderJob(ctx context.Context, tx pgx.Tx, workspaceID string, integrationID string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at) values ($1::uuid,$2::uuid,'zendesk','outbound_delivery','queued',$3::jsonb,now(),now())`, workspaceID, integrationID, raw)
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

func readJSONRecord(raw []byte) map[string]any {
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return out
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
