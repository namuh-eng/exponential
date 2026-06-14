package projects

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
)

type slackProjectUpdateTarget struct {
	Channel string
	Config  string
}

func (h Handler) queueSlackProjectUpdate(ctx context.Context, tx pgx.Tx, workspaceID string, project Project, body string) error {
	targets, err := slackProjectUpdateTargets(ctx, tx, workspaceID, project)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		return nil
	}
	integrationID, err := slackProjectUpdateIntegration(ctx, tx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, target := range targets {
		payload := map[string]any{
			"channel": target.Channel,
			"text":    slackProjectUpdateText(project, body),
			"type":    "project_update",
			"project": map[string]any{
				"id":     project.ID,
				"name":   project.Name,
				"slug":   project.Slug,
				"status": project.Status,
			},
			"configuration": target.Config,
		}
		raw, _ := json.Marshal(payload)
		if _, err := tx.Exec(ctx, `
			insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at)
			values ($1::uuid,$2::uuid,'slack','outbound_delivery','queued',$3::jsonb,now(),now())`, workspaceID, integrationID, raw); err != nil {
			return err
		}
	}
	return nil
}

func slackProjectUpdateTargets(ctx context.Context, tx pgx.Tx, workspaceID string, project Project) ([]slackProjectUpdateTarget, error) {
	var raw []byte
	if err := tx.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid limit 1`, workspaceID).Scan(&raw); err != nil {
		return nil, err
	}
	configs := readSlackProjectUpdateConfigs(raw)
	targets := []slackProjectUpdateTarget{}
	seenChannels := map[string]bool{}
	for _, config := range configs {
		channel := slackProjectUpdateChannel(config)
		if channel == "" || seenChannels[channel] || !slackProjectUpdateConfigMatches(config, project) {
			continue
		}
		targets = append(targets, slackProjectUpdateTarget{Channel: channel, Config: projectUpdateString(config["name"])})
		seenChannels[channel] = true
	}
	return targets, nil
}

func slackProjectUpdateIntegration(ctx context.Context, tx pgx.Tx, workspaceID string) (string, error) {
	var integrationID string
	err := tx.QueryRow(ctx, `
		select id::text
		from workspace_integration
		where workspace_id=$1::uuid and provider='slack' and status in ('connected','degraded')
		order by connected_at desc nulls last, updated_at desc
		limit 1`, workspaceID).Scan(&integrationID)
	return integrationID, err
}

func readSlackProjectUpdateConfigs(raw []byte) []map[string]any {
	var root map[string]json.RawMessage
	_ = json.Unmarshal(raw, &root)
	var configs []map[string]any
	_ = json.Unmarshal(root["projectUpdateConfigurations"], &configs)
	return configs
}

func slackProjectUpdateChannel(config map[string]any) string {
	if !projectUpdateBoolDefault(config["enabled"], true) {
		return ""
	}
	if containsAnyString(config["shareTargets"], "slack") {
		return strings.TrimSpace(projectUpdateString(config["slackChannel"]))
	}
	if projectUpdateString(config["reportingTarget"]) == "slack" {
		return strings.TrimSpace(projectUpdateString(config["shareTarget"]))
	}
	return ""
}

func slackProjectUpdateConfigMatches(config map[string]any, project Project) bool {
	if scope := projectUpdateString(config["projectScope"]); scope != "" {
		switch scope {
		case "all":
			return true
		case "active":
			return project.Status != "completed" && project.Status != "canceled"
		case "statuses":
			return containsAnyString(config["statusScope"], project.Status)
		default:
			return false
		}
	}
	switch projectUpdateString(config["scope"]) {
	case "", "active_projects":
		return project.Status != "completed" && project.Status != "canceled"
	case "all_projects":
		return true
	case "selected_projects":
		return containsAnyString(config["projectIds"], project.ID)
	default:
		return false
	}
}

func slackProjectUpdateText(project Project, body string) string {
	body = truncateSlackProjectUpdate(strings.TrimSpace(body), 2600)
	title := strings.TrimSpace(project.Name)
	if title == "" {
		title = project.Slug
	}
	return fmt.Sprintf("Project update for <%s|%s>:\n%s", projectURL(project), title, body)
}

func projectURL(project Project) string {
	return strings.TrimRight(projectAppURL(), "/") + "/project/" + url.PathEscape(project.Slug)
}

func projectAppURL() string {
	if v := strings.TrimSpace(os.Getenv("EXPONENTIAL_APP_URL")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL")); v != "" {
		return v
	}
	return "http://localhost:7015"
}

func truncateSlackProjectUpdate(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	if max <= 3 {
		return string(runes[:max])
	}
	return string(runes[:max-3]) + "..."
}

func containsAnyString(value any, wanted string) bool {
	switch items := value.(type) {
	case []any:
		for _, item := range items {
			if projectUpdateString(item) == wanted {
				return true
			}
		}
	case []string:
		for _, item := range items {
			if item == wanted {
				return true
			}
		}
	}
	return false
}

func projectUpdateString(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}

func projectUpdateBoolDefault(value any, fallback bool) bool {
	if enabled, ok := value.(bool); ok {
		return enabled
	}
	return fallback
}
