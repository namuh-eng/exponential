package integrations

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type CatalogItem struct {
	Provider    string `json:"provider"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type SetupRequirement struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type Actions struct {
	CanConnect    bool `json:"canConnect"`
	CanManage     bool `json:"canManage"`
	CanDisconnect bool `json:"canDisconnect"`
	CanReconnect  bool `json:"canReconnect"`
}

type AuditEvent struct {
	EventType string `json:"eventType"`
	Severity  string `json:"severity"`
	Message   string `json:"message"`
	CreatedAt string `json:"createdAt"`
}

type Health struct {
	LastEventAt        *string      `json:"lastEventAt"`
	LastSuccessAt      *string      `json:"lastSuccessAt"`
	LastFailureAt      *string      `json:"lastFailureAt"`
	LastFailureMessage *string      `json:"lastFailureMessage"`
	TokenExpiresAt     *string      `json:"tokenExpiresAt"`
	PendingJobCount    int          `json:"pendingJobCount"`
	FailedJobCount     int          `json:"failedJobCount"`
	AuditEvents        []AuditEvent `json:"auditEvents"`
}

type Integration struct {
	CatalogItem
	ID               *string           `json:"id"`
	Status           string            `json:"status"`
	DisplayName      *string           `json:"displayName"`
	ExternalID       *string           `json:"externalId"`
	ConnectedAt      *string           `json:"connectedAt"`
	SetupRequirement *SetupRequirement `json:"setupRequirement"`
	Actions          Actions           `json:"actions"`
	Health           Health            `json:"health"`
	Details          map[string]any    `json:"details,omitempty"`
}

type response struct {
	CanManageIntegrations bool          `json:"canManageIntegrations"`
	Integrations          []Integration `json:"integrations"`
}

type slackConnectResponse struct {
	AuthorizationURL string `json:"authorizationUrl"`
	State            string `json:"state"`
	WorkspaceSlug    string `json:"workspaceSlug"`
}

type slackOAuthResponse struct {
	OK          bool   `json:"ok"`
	Error       string `json:"error"`
	AccessToken string `json:"access_token"`
	Scope       string `json:"scope"`
	BotUserID   string `json:"bot_user_id"`
	Team        struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"team"`
	AuthedUser struct {
		ID string `json:"id"`
	} `json:"authed_user"`
}

var catalog = []CatalogItem{
	{Provider: "github", Name: "GitHub", Description: "Sync pull requests, commits, and issue links with Linear."},
	{Provider: "gitlab", Name: "GitLab", Description: "Link merge requests, commits, and workflow automation to issues."},
	{Provider: "jira", Name: "Jira", Description: "Sync issue status, ownership, and cross-links with Jira projects."},
	{Provider: "discord", Name: "Discord", Description: "Create, search, and share issues from Discord slash commands."},
	{Provider: "google_sheets", Name: "Google Sheets", Description: "Create an hourly analytics spreadsheet for issues, projects, and initiatives."},
	{Provider: "microsoft_teams", Name: "Microsoft Teams", Description: "Create issues and projects from Teams conversations and post project updates."},
	{Provider: "figma", Name: "Figma", Description: "Preview design links and connect Figma selections to issues."},
	{Provider: "intercom", Name: "Intercom", Description: "Create and link issues from support conversations and sync customer feedback status."},

	{Provider: "sentry", Name: "Sentry", Description: "Create, link, and resolve issues from Sentry errors."},
	{Provider: "salesforce", Name: "Salesforce", Description: "Link cases to issues and projects, then sync status and priority back to support."},
	{Provider: "slack", Name: "Slack", Description: "Send issue updates and create issues from Slack messages."},
	{Provider: "gong", Name: "Gong", Description: "Connect customer call excerpts to issues and customer requests."},
	{Provider: "zendesk", Name: "Zendesk", Description: "Connect support tickets to product work and customer requests."},
	{Provider: "front", Name: "Front", Description: "Create, link, and reopen issues from Front conversations."},
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Delete("/", h.Delete)
	r.Post("/slack/connect", h.SlackConnect)
	r.Post("/google-sheets/connect", h.GoogleSheetsConnect)
	r.Post("/google-sheets/refresh", h.GoogleSheetsRefresh)
	r.Post("/google-sheets/disconnect", h.GoogleSheetsDisconnect)
	r.Post("/github/connect", h.GitHubConnect)
	r.Post("/github/register", h.GitHubRegister)
	r.Post("/github/disconnect", h.GitHubDisconnect)
	r.Get("/gitlab", h.GitLabStatus)
	r.Post("/gitlab/setup", h.GitLabSetup)
	r.Post("/gitlab/workflows", h.GitLabWorkflow)
	r.Post("/gitlab/disconnect", h.GitLabDisconnect)
	r.Post("/discord/connect", h.DiscordConnect)
	r.Post("/discord/disconnect", h.DiscordDisconnect)
	r.Post("/microsoft-teams/connect", h.MicrosoftTeamsConnect)
	r.Post("/microsoft-teams/disconnect", h.MicrosoftTeamsDisconnect)
	r.Post("/sentry/connect", h.SentryConnect)
	r.Post("/sentry/disconnect", h.SentryDisconnect)
	r.Post("/salesforce/connect", h.SalesforceConnect)
	r.Post("/salesforce/disconnect", h.SalesforceDisconnect)
	r.Post("/front/setup", h.FrontSetup)
	r.Post("/front/disconnect", h.FrontDisconnect)
	r.Post("/intercom/connect", h.IntercomConnect)
	r.Post("/intercom/disconnect", h.IntercomDisconnect)
	r.Post("/zendesk/setup", h.ZendeskSetup)
	r.Post("/zendesk/disconnect", h.ZendeskDisconnect)
	r.Post("/gong/connect", h.GongConnect)
	r.Post("/gong/disconnect", h.GongDisconnect)

	r.Post("/slack/disconnect", h.SlackDisconnect)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	rows, err := h.listRows(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List integrations failed", err.Error())
		return
	}
	byProvider := map[string]row{}
	for _, row := range rows {
		byProvider[row.Provider] = row
	}
	canManage := canManage(p.Role)
	out := []Integration{}
	for _, item := range catalog {
		connected, ok := byProvider[item.Provider]
		requirement := (*SetupRequirement)(nil)
		if !ok {
			requirement = setupRequirement(item.Provider)
		}
		status := "not_connected"
		var id, displayName, externalID, connectedAt *string
		if ok {
			status = connected.Status
			id = &connected.ID
			displayName = connected.DisplayName
			externalID = connected.ExternalID
			connectedAt = formatTime(connected.ConnectedAt)
		} else if requirement != nil {
			status = "configuration_required"
		}
		health := Health{}
		if ok {
			health = connected.Health()
		}
		out = append(out, Integration{CatalogItem: item, ID: id, Status: status, DisplayName: displayName, ExternalID: externalID, ConnectedAt: connectedAt, SetupRequirement: requirement, Actions: integrationActions(canManage, ok, status, requirement), Health: health, Details: integrationDetails(connected)})
	}
	problem.JSON(w, 200, response{CanManageIntegrations: canManage, Integrations: out})
}

func (h Handler) SlackConnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	clientID, _, ok := slackOAuthConfig()
	if !ok {
		problem.JSON(w, 412, map[string]string{"error": "Slack OAuth is not configured", "message": "Add AUTH_SLACK_ID and AUTH_SLACK_SECRET to enable Slack installation for this workspace."})
		return
	}
	state, err := randomState()
	if err != nil {
		problem.Write(w, 500, "Create Slack authorization failed", err.Error())
		return
	}
	workspaceSlug, err := h.workspaceSlug(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create Slack authorization failed", err.Error())
		return
	}
	if err := h.saveSlackOAuthState(r.Context(), p.WorkspaceID, p.UserID, state); err != nil {
		problem.Write(w, 500, "Create Slack authorization failed", err.Error())
		return
	}
	authorizationURL := slackAuthorizationURL(clientID, configuredAppURL(), state)
	problem.JSON(w, 200, slackConnectResponse{AuthorizationURL: authorizationURL, State: state, WorkspaceSlug: workspaceSlug})
}

func (h Handler) SlackOAuthCallback(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if slackError := strings.TrimSpace(r.URL.Query().Get("error")); slackError != "" {
		http.Redirect(w, r, slackRedirectURL("error", slackError), http.StatusFound)
		return
	}
	if code == "" || state == "" {
		problem.Write(w, http.StatusBadRequest, "Slack OAuth callback is missing code or state", "")
		return
	}
	_, clientSecret, ok := slackOAuthConfig()
	if !ok {
		problem.Write(w, http.StatusServiceUnavailable, "Slack OAuth is not configured", "")
		return
	}
	install, err := h.findSlackOAuthInstall(r.Context(), state)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusBadRequest, "Invalid Slack OAuth state", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Slack OAuth callback failed", err.Error())
		return
	}
	token, err := exchangeSlackOAuth(r.Context(), http.DefaultClient, clientSecret, code, slackRedirectURI(configuredAppURL()))
	if err != nil {
		_ = h.recordSlackInstallFailure(r.Context(), install.ID, install.WorkspaceID, err.Error())
		problem.Write(w, http.StatusBadGateway, "Slack OAuth exchange failed", err.Error())
		return
	}
	if err := h.completeSlackInstall(r.Context(), install, token); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Slack OAuth callback failed", err.Error())
		return
	}
	http.Redirect(w, r, slackRedirectURL("connected", ""), http.StatusFound)
}

func (h Handler) SlackEvents(w http.ResponseWriter, r *http.Request) {
	signingSecret := strings.TrimSpace(os.Getenv("SLACK_SIGNING_SECRET"))
	if signingSecret == "" {
		problem.Write(w, http.StatusServiceUnavailable, "Slack signing secret is not configured", "")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Slack event body could not be read", err.Error())
		return
	}
	if !verifySlackSignature(signingSecret, r.Header.Get("X-Slack-Request-Timestamp"), r.Header.Get("X-Slack-Signature"), body, time.Now()) {
		problem.Write(w, http.StatusUnauthorized, "Invalid Slack signature", "")
		return
	}
	values, _ := url.ParseQuery(string(body))
	payload := body
	if formPayload := strings.TrimSpace(values.Get("payload")); formPayload != "" {
		payload = []byte(formPayload)
	}
	var event map[string]any
	if err := json.Unmarshal(payload, &event); err != nil {
		problem.Write(w, http.StatusBadRequest, "Slack event payload is invalid", err.Error())
		return
	}
	if challenge, _ := event["challenge"].(string); challenge != "" && event["type"] == "url_verification" {
		problem.JSON(w, http.StatusOK, map[string]string{"challenge": challenge})
		return
	}
	teamID := slackTeamID(event)
	if teamID == "" {
		problem.Write(w, http.StatusBadRequest, "Slack event is missing team_id", "")
		return
	}
	install, err := h.resolveSlackInstall(r.Context(), teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.JSON(w, http.StatusAccepted, map[string]bool{"ok": true})
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Slack integration could not be resolved", err.Error())
		return
	}
	if err := h.handleSlackEvent(r.Context(), install, event); err != nil {
		_ = h.recordSlackIssueEvent(r.Context(), install, "webhook_ingestion_failed", "error", safeSlackError(err), map[string]any{"teamId": teamID})
		problem.Write(w, http.StatusInternalServerError, "Slack event could not be processed", err.Error())
		return
	}
	problem.JSON(w, http.StatusAccepted, map[string]bool{"ok": true})
}

func (h Handler) SlackDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	if err := h.revokeProvider(r.Context(), p.WorkspaceID, "slack", p.UserID); err != nil {
		problem.Write(w, 500, "Disconnect Slack failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}
	provider := strings.TrimSpace(r.URL.Query().Get("provider"))
	if provider == "" {
		problem.Write(w, 400, "Provider is required", "")
		return
	}
	err := h.revokeProvider(r.Context(), p.WorkspaceID, provider, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Delete integration failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

type row struct {
	ID                 string
	Provider           string
	Status             string
	DisplayName        *string
	ExternalID         *string
	ConnectedAt        *time.Time
	LastEventAt        *time.Time
	LastSuccessAt      *time.Time
	LastFailureAt      *time.Time
	LastFailureMessage *string
	TokenExpiresAt     *time.Time
	Metadata           map[string]any
	PendingJobCount    int
	FailedJobCount     int
	AuditEvents        []AuditEvent
}

func (h Handler) listRows(ctx context.Context, workspaceID string) ([]row, error) {
	rows, err := h.DB.Query(ctx, `
		select wi.id::text,
			wi.provider,
			wi.status,
			wi.display_name,
			wi.external_id,
			wi.connected_at,
			wi.last_event_at,
			wi.last_success_at,
			wi.last_failure_at,
			wi.last_failure_message,
			wi.token_expires_at,
			wi.metadata,
			coalesce(count(pj.id) filter (where pj.status in ('queued','running')),0)::int,
			coalesce(count(pj.id) filter (where pj.status in ('failed','dead')),0)::int
		from workspace_integration wi
		left join provider_job pj on pj.workspace_integration_id=wi.id
		where wi.workspace_id=$1::uuid
		group by wi.id`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []row{}
	for rows.Next() {
		var r row
		var metadataRaw []byte
		if err := rows.Scan(&r.ID, &r.Provider, &r.Status, &r.DisplayName, &r.ExternalID, &r.ConnectedAt, &r.LastEventAt, &r.LastSuccessAt, &r.LastFailureAt, &r.LastFailureMessage, &r.TokenExpiresAt, &metadataRaw, &r.PendingJobCount, &r.FailedJobCount); err != nil {
			return nil, err
		}
		r.Metadata = map[string]any{}
		_ = json.Unmarshal(metadataRaw, &r.Metadata)
		events, err := h.auditEvents(ctx, r.ID)
		if err != nil {
			return nil, err
		}
		r.AuditEvents = events
		out = append(out, r)
	}
	return out, rows.Err()
}

func canManage(role string) bool { return role == "owner" || role == "admin" }

func integrationActions(canManage bool, installed bool, status string, requirement *SetupRequirement) Actions {
	canInstall := canManage && requirement == nil
	return Actions{
		CanConnect:    canInstall && !installed,
		CanManage:     canManage && installed,
		CanDisconnect: canManage && installed && status != "revoked",
		CanReconnect:  canInstall && installed && status != "connected" && status != "installing",
	}
}

func setupRequirement(provider string) *SetupRequirement {
	if provider == "slack" && !slackConfigured() {
		return &SetupRequirement{Type: "configuration_required", Message: "Slack OAuth credentials are not configured. Add AUTH_SLACK_ID and AUTH_SLACK_SECRET to enable installation."}
	}
	if provider == "google_sheets" && !googleSheetsConfigured() {
		return &SetupRequirement{Type: "configuration_required", Message: "Google OAuth credentials are not configured. Add AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET to enable Google Sheets analytics sync."}
	}
	if provider == "discord" && !discordConfigured() {
		return &SetupRequirement{Type: "configuration_required", Message: "Discord OAuth credentials and public key are not configured. Add AUTH_DISCORD_ID, AUTH_DISCORD_SECRET, and DISCORD_PUBLIC_KEY to enable installation."}
	}
	if provider == "microsoft_teams" && !microsoftTeamsConfigured() {
		return &SetupRequirement{Type: "configuration_required", Message: "Microsoft Teams credentials are not configured. Add AUTH_MICROSOFT_ID, AUTH_MICROSOFT_SECRET, and MICROSOFT_TEAMS_BOT_SECRET to enable tenant installation."}
	}
	if provider == "figma" && !figmaConfigured() {
		return &SetupRequirement{Type: "configuration_required", Message: "Figma OAuth credentials are not configured. Add AUTH_FIGMA_ID and AUTH_FIGMA_SECRET to enable design previews."}
	}
	if provider == "sentry" && !sentryConfigured() {
		return &SetupRequirement{Type: "configuration_required", Message: "Sentry credentials are not configured. Add AUTH_SENTRY_ID, AUTH_SENTRY_SECRET, and SENTRY_WEBHOOK_SECRET to enable installation and signed issue actions."}
	}
	if provider == "salesforce" && !salesforceConfigured() {
		return &SetupRequirement{Type: "configuration_required", Message: "Salesforce OAuth credentials and component secret are not configured. Add AUTH_SALESFORCE_ID, AUTH_SALESFORCE_SECRET, and SALESFORCE_COMPONENT_SECRET to enable installation and signed case actions."}
	}
	if provider == "intercom" && !intercomConfigured() {
		return &SetupRequirement{Type: "configuration_required", Message: "Intercom credentials are not configured. Add AUTH_INTERCOM_ID, AUTH_INTERCOM_SECRET, and INTERCOM_SIGNING_SECRET to enable installation and signed conversation actions."}
	}
	if provider == "gong" && !gongConfigured() {
		return &SetupRequirement{Type: "configuration_required", Message: "Gong OAuth credentials are not configured. Add AUTH_GONG_ID and AUTH_GONG_SECRET to enable call ingestion."}
	}
	if provider == "github" && !githubConfigured() {
		return &SetupRequirement{Type: "configuration_required", Message: "GitHub App credentials are not configured. Add GITHUB_APP_ID, GITHUB_CLIENT_ID, GITHUB_PRIVATE_KEY, and GITHUB_WEBHOOK_SECRET to enable installation."}
	}
	return nil
}

func slackConfigured() bool {
	return strings.TrimSpace(os.Getenv("AUTH_SLACK_ID")) != "" && strings.TrimSpace(os.Getenv("AUTH_SLACK_SECRET")) != ""
}

func githubConfigured() bool {
	_, ok := loadGitHubConfig()
	return ok
}

func discordConfigured() bool {
	return strings.TrimSpace(os.Getenv("AUTH_DISCORD_ID")) != "" && strings.TrimSpace(os.Getenv("AUTH_DISCORD_SECRET")) != "" && strings.TrimSpace(os.Getenv("DISCORD_PUBLIC_KEY")) != ""
}

func microsoftTeamsConfigured() bool {
	return strings.TrimSpace(os.Getenv("AUTH_MICROSOFT_ID")) != "" && strings.TrimSpace(os.Getenv("AUTH_MICROSOFT_SECRET")) != "" && strings.TrimSpace(os.Getenv("MICROSOFT_TEAMS_BOT_SECRET")) != ""
}

func figmaConfigured() bool {
	return strings.TrimSpace(os.Getenv("AUTH_FIGMA_ID")) != "" && strings.TrimSpace(os.Getenv("AUTH_FIGMA_SECRET")) != ""
}

func formatTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}

func isNotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

func (r row) Health() Health {
	return Health{
		LastEventAt:        formatTime(r.LastEventAt),
		LastSuccessAt:      formatTime(r.LastSuccessAt),
		LastFailureAt:      formatTime(r.LastFailureAt),
		LastFailureMessage: r.LastFailureMessage,
		TokenExpiresAt:     formatTime(r.TokenExpiresAt),
		PendingJobCount:    r.PendingJobCount,
		FailedJobCount:     r.FailedJobCount,
		AuditEvents:        r.AuditEvents,
	}
}

func integrationDetails(value row) map[string]any {
	if value.Provider == googleSheetsProvider {
		raw, _ := json.Marshal(value.Metadata)
		return googleSheetsDetails(raw)
	}
	if value.Provider == "github" {
		return githubIntegrationDetails(value.Metadata)
	}
	return nil
}

func (h Handler) auditEvents(ctx context.Context, integrationID string) ([]AuditEvent, error) {
	rows, err := h.DB.Query(ctx, `
		select event_type, severity, message, created_at
		from provider_event
		where workspace_integration_id=$1::uuid
		order by created_at desc
		limit 5`, integrationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []AuditEvent{}
	for rows.Next() {
		var event AuditEvent
		var createdAt time.Time
		if err := rows.Scan(&event.EventType, &event.Severity, &event.Message, &createdAt); err != nil {
			return nil, err
		}
		event.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		events = append(events, event)
	}
	return events, rows.Err()
}

func (h Handler) revokeProvider(ctx context.Context, workspaceID string, provider string, userID string) error {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	var integrationID string
	err = tx.QueryRow(ctx, `select id::text from workspace_integration where workspace_id=$1::uuid and provider=$2 limit 1 for update`, workspaceID, provider).Scan(&integrationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, encrypted_payload=null, revoked_at=coalesce(revoked_at, now()), updated_at=now() where workspace_integration_id=$1::uuid and active`, integrationID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_job set status='canceled', completed_at=coalesce(completed_at, now()), updated_at=now() where workspace_integration_id=$1::uuid and status in ('queued','running','failed')`, integrationID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update team_notification_integration set enabled=false, updated_at=now() where workspace_integration_id=$1::uuid`, integrationID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update workspace_integration set status='revoked', credentials_revoked_at=now(), revoked_at=now(), revoked_by_user_id=$2, last_event_at=now(), updated_at=now() where id=$1::uuid`, integrationID, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// disconnectProvider is kept for provider-specific disconnect handlers that
// predate revokeProvider's argument order.
func (h Handler) disconnectProvider(ctx context.Context, workspaceID string, userID string, provider string) error {
	return h.revokeProvider(ctx, workspaceID, provider, userID)
}

func (h Handler) workspaceSlug(ctx context.Context, workspaceID string) (string, error) {
	var slug string
	err := h.DB.QueryRow(ctx, `select url_slug from workspace where id=$1::uuid`, workspaceID).Scan(&slug)
	return slug, err
}

type slackOAuthInstall struct {
	ID          string
	WorkspaceID string
	UserID      string
	Metadata    map[string]any
}

func (h Handler) saveSlackOAuthState(ctx context.Context, workspaceID string, userID string, state string) error {
	now := time.Now().UTC()
	metadata := map[string]any{
		"oauthStateHash":      hashSlackSecret(state),
		"oauthStateExpiresAt": now.Add(10 * time.Minute).Format(time.RFC3339Nano),
		"oauthStartedAt":      now.Format(time.RFC3339Nano),
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into workspace_integration (workspace_id, provider, status, metadata, connected_by_user_id, connected_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'slack', 'installing', $2::jsonb, $3, null, null, null, null, now())
		on conflict (workspace_id, provider) do update set
			status='installing',
			metadata=excluded.metadata,
			connected_by_user_id=excluded.connected_by_user_id,
			credentials_revoked_at=null,
			revoked_at=null,
			revoked_by_user_id=null,
			updated_at=now()`, workspaceID, raw, userID)
	return err
}

func (h Handler) findSlackOAuthInstall(ctx context.Context, state string) (slackOAuthInstall, error) {
	rows, err := h.DB.Query(ctx, `
		select id::text, workspace_id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb)
		from workspace_integration
		where provider='slack' and status='installing'`)
	if err != nil {
		return slackOAuthInstall{}, err
	}
	defer rows.Close()
	stateHash := hashSlackSecret(state)
	for rows.Next() {
		var install slackOAuthInstall
		var metadataRaw []byte
		if err := rows.Scan(&install.ID, &install.WorkspaceID, &install.UserID, &metadataRaw); err != nil {
			return slackOAuthInstall{}, err
		}
		install.Metadata = map[string]any{}
		_ = json.Unmarshal(metadataRaw, &install.Metadata)
		if stringValue(install.Metadata["oauthStateHash"]) != stateHash {
			continue
		}
		expiresAt, _ := time.Parse(time.RFC3339Nano, stringValue(install.Metadata["oauthStateExpiresAt"]))
		if expiresAt.IsZero() || expiresAt.Before(time.Now().UTC()) {
			return slackOAuthInstall{}, pgx.ErrNoRows
		}
		return install, nil
	}
	if err := rows.Err(); err != nil {
		return slackOAuthInstall{}, err
	}
	return slackOAuthInstall{}, pgx.ErrNoRows
}

func (h Handler) completeSlackInstall(ctx context.Context, install slackOAuthInstall, token slackOAuthResponse) error {
	if token.AccessToken == "" || token.Team.ID == "" || token.BotUserID == "" {
		return fmt.Errorf("Slack OAuth response did not include bot token, team ID, and bot user ID")
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	now := time.Now().UTC()
	scopes := parseSlackScopes(token.Scope)
	metadata := map[string]any{
		"teamId":      token.Team.ID,
		"teamName":    token.Team.Name,
		"botUserId":   token.BotUserID,
		"scopes":      scopes,
		"installedBy": install.UserID,
		"authedUser":  token.AuthedUser.ID,
	}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update workspace_integration
		set status='connected',
			external_id=$2,
			display_name=$3,
			metadata=$4::jsonb,
			connected_by_user_id=$5,
			connected_at=coalesce(connected_at, $6),
			last_event_at=$6,
			last_success_at=$6,
			last_failure_at=null,
			last_failure_message=null,
			token_expires_at=null,
			credentials_revoked_at=null,
			revoked_at=null,
			revoked_by_user_id=null,
			updated_at=$6
		where id=$1::uuid`, install.ID, token.Team.ID, token.Team.Name, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at, $2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, install.ID, now); err != nil {
		return err
	}
	credential := map[string]any{
		"botToken":  token.AccessToken,
		"botUserId": token.BotUserID,
		"teamId":    token.Team.ID,
		"scopes":    scopes,
	}
	credentialRaw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at)
		values ($1::uuid, 'slack', $2, $3::jsonb, $4, $5, $5)`, install.ID, credentialRaw, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at)
		values ($1::uuid, $2::uuid, 'slack', 'oauth_connected', 'info', 'Slack workspace connected.', $3::jsonb, $4)`, install.WorkspaceID, install.ID, metadataRaw, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h Handler) recordSlackInstallFailure(ctx context.Context, integrationID string, workspaceID string, message string) error {
	_, err := h.DB.Exec(ctx, `
		update workspace_integration
		set status='error', last_failure_at=now(), last_failure_message=$2, updated_at=now()
		where id=$1::uuid`, integrationID, message)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload)
		values ($1::uuid, $2::uuid, 'slack', 'oauth_failed', 'error', $3, '{}'::jsonb)`, workspaceID, integrationID, message)
	return err
}

func (h Handler) queueSlackInboundEvent(ctx context.Context, teamID string, event map[string]any) error {
	var workspaceID, integrationID string
	err := h.DB.QueryRow(ctx, `
		select workspace_id::text, id::text
		from workspace_integration
		where provider='slack' and external_id=$1 and status in ('connected','degraded')
		limit 1`, teamID).Scan(&workspaceID, &integrationID)
	if err != nil {
		return err
	}
	payloadRaw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at)
		values ($1::uuid, $2::uuid, 'slack', 'webhook_ingestion', 'queued', $3::jsonb, now(), now())`, workspaceID, integrationID, payloadRaw)
	return err
}

func slackOAuthConfig() (clientID string, clientSecret string, ok bool) {
	clientID = strings.TrimSpace(os.Getenv("AUTH_SLACK_ID"))
	clientSecret = strings.TrimSpace(os.Getenv("AUTH_SLACK_SECRET"))
	return clientID, clientSecret, clientID != "" && clientSecret != ""
}

func randomState() (string, error) {
	buf := make([]byte, 18)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func configuredAppURL() string {
	if v := strings.TrimSpace(os.Getenv("EXPONENTIAL_APP_URL")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL")); v != "" {
		return v
	}
	return "http://localhost:7015"
}

func slackRedirectURI(appURL string) string {
	return strings.TrimRight(appURL, "/") + "/api/integrations/slack/oauth/callback"
}

func slackAuthorizationURL(clientID, appURL, state string) string {
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("scope", "channels:read,channels:history,groups:history,im:history,mpim:history,chat:write,commands,links:read,links:write")
	values.Set("user_scope", "")
	values.Set("redirect_uri", slackRedirectURI(appURL))
	values.Set("state", state)
	return "https://slack.com/oauth/v2/authorize?" + values.Encode()
}

func slackRedirectURL(status string, message string) string {
	values := url.Values{}
	values.Set("slack", status)
	if strings.TrimSpace(message) != "" {
		values.Set("message", message)
	}
	return strings.TrimRight(configuredAppURL(), "/") + "/settings/integrations?" + values.Encode()
}

func slackAPIBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("SLACK_API_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://slack.com/api"
}

func exchangeSlackOAuth(ctx context.Context, client *http.Client, clientSecret string, code string, redirectURI string) (slackOAuthResponse, error) {
	values := url.Values{}
	values.Set("client_secret", clientSecret)
	values.Set("code", code)
	values.Set("redirect_uri", redirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, slackAPIBaseURL()+"/oauth.v2.access", strings.NewReader(values.Encode()))
	if err != nil {
		return slackOAuthResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return slackOAuthResponse{}, err
	}
	defer resp.Body.Close()
	var token slackOAuthResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return slackOAuthResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return slackOAuthResponse{}, fmt.Errorf("Slack OAuth returned HTTP %d", resp.StatusCode)
	}
	if !token.OK {
		if token.Error == "" {
			token.Error = "unknown_error"
		}
		return slackOAuthResponse{}, fmt.Errorf("Slack OAuth rejected installation: %s", token.Error)
	}
	return token, nil
}

func verifySlackSignature(signingSecret string, timestamp string, signature string, body []byte, now time.Time) bool {
	if signingSecret == "" || timestamp == "" || signature == "" {
		return false
	}
	unixSeconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	requestTime := time.Unix(unixSeconds, 0)
	if now.Sub(requestTime) > 5*time.Minute || requestTime.Sub(now) > 5*time.Minute {
		return false
	}
	base := "v0:" + timestamp + ":" + string(body)
	mac := hmac.New(sha256.New, []byte(signingSecret))
	_, _ = mac.Write([]byte(base))
	expected := "v0=" + hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func hashSlackSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func parseSlackScopes(scope string) []string {
	parts := strings.Split(scope, ",")
	out := []string{}
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func slackTeamID(event map[string]any) string {
	if teamID := stringValue(event["team_id"]); teamID != "" {
		return teamID
	}
	if team := recordValue(event["team"]); team != nil {
		if teamID := stringValue(team["id"]); teamID != "" {
			return teamID
		}
	}
	return ""
}

func recordValue(value any) map[string]any {
	record, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return record
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return fmt.Sprintf("%v", typed)
	}
}
