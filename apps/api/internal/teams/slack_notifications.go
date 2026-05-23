package teams

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

var slackNotificationEvents = []map[string]string{
	{"id": "issue_created", "label": "New issues", "description": "Broadcast when an issue is created in this team."},
	{"id": "issue_status_changed", "label": "Status changes", "description": "Broadcast when an issue moves between workflow statuses."},
	{"id": "issue_commented", "label": "New comments", "description": "Broadcast when a teammate comments on an issue."},
	{"id": "cycle_completed", "label": "Cycle updates", "description": "Broadcast when a team cycle starts or completes."},
}

var defaultSlackNotificationEvents = []string{"issue_created", "issue_status_changed"}

type slackWorkspaceIntegration struct {
	ID          string  `json:"id"`
	Status      string  `json:"status"`
	DisplayName *string `json:"displayName"`
	ConnectedAt *string `json:"connectedAt"`
}

type slackTeamSettings struct {
	ChannelID   string   `json:"channelId"`
	ChannelName string   `json:"channelName"`
	Enabled     bool     `json:"enabled"`
	Events      []string `json:"events"`
	UpdatedAt   *string  `json:"updatedAt"`
}

type slackNotificationsResponse struct {
	Team                        slackTeamSummary           `json:"team"`
	WorkspaceSlack              *slackWorkspaceIntegration `json:"workspaceSlack"`
	CanManageSlackNotifications bool                       `json:"canManageSlackNotifications"`
	AvailableEvents             []map[string]string        `json:"availableEvents"`
	Settings                    slackTeamSettings          `json:"settings"`
}

type slackTeamSummary struct {
	ID   string `json:"id"`
	Key  string `json:"key"`
	Name string `json:"name"`
}

type slackNotificationRequest struct {
	ChannelID   any   `json:"channelId"`
	ChannelName any   `json:"channelName"`
	Enabled     *bool `json:"enabled"`
	Events      any   `json:"events"`
}

func (h Handler) GetSlackNotifications(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findSlackTeam(r, p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load Slack notifications failed", err.Error())
		return
	}
	h.writeSlackNotifications(w, r, p.WorkspaceID, p.Role, team)
}

func (h Handler) UpdateSlackNotifications(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isAdmin(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	team, err := h.findSlackTeam(r, p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update Slack notifications failed", err.Error())
		return
	}
	workspaceSlack, err := h.findSlackIntegration(r, p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 409, "Connect workspace Slack before saving team notifications.", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update Slack notifications failed", err.Error())
		return
	}
	var input slackNotificationRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON body", err.Error())
		return
	}
	channelName := slackStringValue(input.ChannelName)
	channelID := slackStringValue(input.ChannelID)
	if channelID == "" && channelName != "" {
		channelID = slugifySlackChannel(channelName)
	}
	if channelName == "" {
		problem.Write(w, 400, "Slack channel is required.", "")
		return
	}
	storedChannelName := channelName
	if !strings.HasPrefix(storedChannelName, "#") {
		storedChannelName = "#" + storedChannelName
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	events := normalizeSlackNotificationEvents(input.Events)
	rawEvents, _ := json.Marshal(events)
	var saved slackTeamSettings
	var updatedAt time.Time
	if err := h.DB.QueryRow(r.Context(), `
		insert into team_notification_integration (team_id, workspace_integration_id, provider, channel_id, channel_name, enabled, events, updated_at)
		values ($1::uuid,$2::uuid,'slack',$3,$4,$5,$6::jsonb,now())
		on conflict (team_id, provider) do update set workspace_integration_id=$2::uuid, channel_id=$3, channel_name=$4, enabled=$5, events=$6::jsonb, updated_at=now()
		returning coalesce(channel_id,''), coalesce(channel_name,''), enabled, coalesce(events,'[]'::jsonb), updated_at`, team.ID, workspaceSlack.ID, channelID, storedChannelName, enabled, rawEvents).Scan(&saved.ChannelID, &saved.ChannelName, &saved.Enabled, &rawEvents, &updatedAt); err != nil {
		problem.Write(w, 500, "Update Slack notifications failed", err.Error())
		return
	}
	saved.Events = normalizeSlackNotificationEventsFromBytes(rawEvents)
	updated := updatedAt.UTC().Format(time.RFC3339)
	saved.UpdatedAt = &updated
	problem.JSON(w, 200, map[string]slackTeamSettings{"settings": saved})
}

func (h Handler) DeleteSlackNotifications(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isAdmin(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	team, err := h.findSlackTeam(r, p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete Slack notifications failed", err.Error())
		return
	}
	if _, err := h.DB.Exec(r.Context(), `delete from team_notification_integration where team_id=$1::uuid and provider='slack'`, team.ID); err != nil {
		problem.Write(w, 500, "Delete Slack notifications failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) writeSlackNotifications(w http.ResponseWriter, r *http.Request, workspaceID, role string, team slackTeamSummary) {
	workspaceSlack, err := h.findSlackIntegration(r, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		workspaceSlack = nil
	} else if err != nil {
		problem.Write(w, 500, "Load Slack notifications failed", err.Error())
		return
	}
	settings, err := h.findSlackSettings(r, team.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		settings = slackTeamSettings{Events: defaultSlackNotificationEvents}
	} else if err != nil {
		problem.Write(w, 500, "Load Slack notifications failed", err.Error())
		return
	}
	problem.JSON(w, 200, slackNotificationsResponse{Team: team, WorkspaceSlack: workspaceSlack, CanManageSlackNotifications: isAdmin(role), AvailableEvents: slackNotificationEvents, Settings: settings})
}

func (h Handler) findSlackTeam(r *http.Request, workspaceID, key string) (slackTeamSummary, error) {
	var team slackTeamSummary
	err := h.DB.QueryRow(r.Context(), `select id::text,key,name from team where workspace_id=$1::uuid and key=$2 and deleted_at is null limit 1`, workspaceID, key).Scan(&team.ID, &team.Key, &team.Name)
	return team, err
}

func (h Handler) findSlackIntegration(r *http.Request, workspaceID string) (*slackWorkspaceIntegration, error) {
	var integration slackWorkspaceIntegration
	var connectedAt *time.Time
	err := h.DB.QueryRow(r.Context(), `select id::text, status, display_name, connected_at from workspace_integration where workspace_id=$1::uuid and provider='slack' limit 1`, workspaceID).Scan(&integration.ID, &integration.Status, &integration.DisplayName, &connectedAt)
	if err != nil {
		return nil, err
	}
	if connectedAt != nil {
		formatted := connectedAt.UTC().Format(time.RFC3339)
		integration.ConnectedAt = &formatted
	}
	return &integration, nil
}

func (h Handler) findSlackSettings(r *http.Request, teamID string) (slackTeamSettings, error) {
	var settings slackTeamSettings
	var eventsRaw []byte
	var updatedAt *time.Time
	err := h.DB.QueryRow(r.Context(), `select coalesce(channel_id,''), coalesce(channel_name,''), enabled, coalesce(events,'[]'::jsonb), updated_at from team_notification_integration where team_id=$1::uuid and provider='slack' limit 1`, teamID).Scan(&settings.ChannelID, &settings.ChannelName, &settings.Enabled, &eventsRaw, &updatedAt)
	if err != nil {
		return settings, err
	}
	settings.Events = normalizeSlackNotificationEventsFromBytes(eventsRaw)
	if updatedAt != nil {
		formatted := updatedAt.UTC().Format(time.RFC3339)
		settings.UpdatedAt = &formatted
	}
	return settings, nil
}

func normalizeSlackNotificationEvents(value any) []string {
	allowed := map[string]bool{}
	for _, event := range slackNotificationEvents {
		allowed[event["id"]] = true
	}
	seen := map[string]bool{}
	out := []string{}
	if raw, ok := value.([]any); ok {
		for _, item := range raw {
			if event, ok := item.(string); ok && allowed[event] && !seen[event] {
				seen[event] = true
				out = append(out, event)
			}
		}
	}
	if len(out) == 0 {
		return append([]string{}, defaultSlackNotificationEvents...)
	}
	return out
}

func normalizeSlackNotificationEventsFromBytes(raw []byte) []string {
	var values []any
	_ = json.Unmarshal(raw, &values)
	return normalizeSlackNotificationEvents(values)
}

func slugifySlackChannel(value string) string {
	trimmed := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), "#")
	re := regexp.MustCompile(`[^a-z0-9_-]+`)
	return strings.Trim(re.ReplaceAllString(trimmed, "-"), "-")
}

func slackStringValue(value any) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return ""
}
