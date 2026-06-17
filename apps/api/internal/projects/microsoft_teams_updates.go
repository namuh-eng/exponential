package projects

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

type microsoftTeamsProjectUpdateTarget struct {
	IntegrationID string
	ChannelID     string
	ChannelName   string
	WebhookURL    string
}

func (h Handler) queueMicrosoftTeamsProjectUpdate(ctx context.Context, tx pgx.Tx, workspaceID string, project Project, settings map[string]any, body string) error {
	targets, err := h.microsoftTeamsProjectUpdateTargets(ctx, tx, workspaceID, project.ID, settings)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		return nil
	}
	text := microsoftTeamsProjectUpdateText(project, body)
	for _, target := range targets {
		payload := map[string]any{
			"type":         "project_update",
			"project_id":   project.ID,
			"project_name": project.Name,
			"project_slug": project.Slug,
			"channel_id":   target.ChannelID,
			"channel_name": target.ChannelName,
			"text":         text,
		}
		if strings.TrimSpace(target.WebhookURL) != "" {
			payload["webhook_url"] = strings.TrimSpace(target.WebhookURL)
		}
		raw, _ := json.Marshal(payload)
		var jobID string
		if err := tx.QueryRow(ctx, `
			insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at)
			values ($1::uuid,$2::uuid,'microsoft_teams','outbound_delivery','queued',$3::jsonb,now(),now())
			returning id::text`, workspaceID, target.IntegrationID, raw).Scan(&jobID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload)
			values ($1::uuid,$2::uuid,'microsoft_teams',$3::uuid,'project_update_queued','info','Microsoft Teams project update delivery queued.',$4::jsonb)`, workspaceID, target.IntegrationID, jobID, raw); err != nil {
			return err
		}
	}
	return nil
}

func (h Handler) microsoftTeamsProjectUpdateTargets(ctx context.Context, tx pgx.Tx, workspaceID, projectID string, settings map[string]any) ([]microsoftTeamsProjectUpdateTarget, error) {
	targets := []microsoftTeamsProjectUpdateTarget{}
	seen := map[string]bool{}
	if channelID := projectSettingString(settings, "microsoftTeamsChannelId"); channelID != "" {
		var integrationID string
		err := tx.QueryRow(ctx, `
			select id::text
			from workspace_integration
			where workspace_id=$1::uuid and provider='microsoft_teams' and status in ('connected','degraded')
			limit 1`, workspaceID).Scan(&integrationID)
		if err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
		if integrationID != "" {
			key := integrationID + ":" + channelID
			seen[key] = true
			targets = append(targets, microsoftTeamsProjectUpdateTarget{IntegrationID: integrationID, ChannelID: channelID, ChannelName: projectSettingString(settings, "microsoftTeamsChannelName"), WebhookURL: projectSettingString(settings, "microsoftTeamsWebhookUrl")})
		}
	}
	rows, err := tx.Query(ctx, `
		select distinct wi.id::text, tni.channel_id, coalesce(tni.channel_name,'')
		from project_team pt
		join team_notification_integration tni on tni.team_id=pt.team_id
		join workspace_integration wi on wi.id=tni.workspace_integration_id
		where pt.project_id=$1::uuid
			and wi.workspace_id=$2::uuid
			and wi.provider='microsoft_teams'
			and wi.status in ('connected','degraded')
			and tni.provider='microsoft_teams'
			and tni.enabled
			and tni.channel_id is not null
			and (coalesce(tni.events,'[]'::jsonb) ? 'project_updated' or coalesce(tni.events,'[]'::jsonb) ? 'project_updates')`, projectID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var target microsoftTeamsProjectUpdateTarget
		if err := rows.Scan(&target.IntegrationID, &target.ChannelID, &target.ChannelName); err != nil {
			return nil, err
		}
		key := target.IntegrationID + ":" + target.ChannelID
		if seen[key] || strings.TrimSpace(target.ChannelID) == "" {
			continue
		}
		seen[key] = true
		targets = append(targets, target)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return targets, nil
}

func microsoftTeamsProjectUpdateText(project Project, body string) string {
	body = strings.TrimSpace(body)
	if len(body) > 1800 {
		body = strings.TrimSpace(body[:1800]) + "…"
	}
	if body == "" {
		return fmt.Sprintf("Project update: %s", project.Name)
	}
	return fmt.Sprintf("Project update: %s\n%s", project.Name, body)
}

func projectSettingString(settings map[string]any, key string) string {
	value, _ := settings[key].(string)
	return strings.TrimSpace(value)
}
