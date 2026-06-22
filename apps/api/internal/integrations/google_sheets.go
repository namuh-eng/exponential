package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

const (
	googleSheetsProvider    = "google_sheets"
	googleSheetsSyncKind    = "sync"
	googleSheetsRefreshHour = time.Hour
)

var googleSheetsScopes = []string{
	"https://www.googleapis.com/auth/spreadsheets",
	"https://www.googleapis.com/auth/drive.file",
}

var googleSheetSchemas = map[string][]string{
	"issues": {
		"Issue ID", "Identifier", "Title", "Team", "Team Name", "State", "State Category", "Priority", "Estimate", "Project ID", "Project", "Assignee ID", "Created At", "Updated At", "Completed At", "Canceled At", "Archived At",
	},
	"projects": {
		"Project ID", "Name", "Slug", "Status", "Priority", "Team Keys", "Lead ID", "Start Date", "Target Date", "Completed At", "Canceled At", "Created At", "Updated At",
	},
	"initiatives": {
		"Initiative ID", "Name", "Status", "Health", "Team Keys", "Project Slugs", "Owner ID", "Start Date", "Target Date", "Timeframe", "Created At", "Updated At",
	},
}

var googleSheetTitles = map[string]string{
	"issues":      "Issues",
	"projects":    "Projects",
	"initiatives": "Initiatives",
}

type googleSheetsSettings struct {
	Scopes              map[string]bool `json:"scopes"`
	IncludePrivateTeams bool            `json:"includePrivateTeams"`
	Schedule            string          `json:"schedule"`
	Enabled             bool            `json:"enabled"`
}

type googleSheetsMetadata struct {
	googleSheetsSettings
	OAuthStateHash           string              `json:"oauthStateHash,omitempty"`
	OAuthStateExpiresAt      string              `json:"oauthStateExpiresAt,omitempty"`
	OAuthStartedAt           string              `json:"oauthStartedAt,omitempty"`
	SpreadsheetID            string              `json:"spreadsheetId,omitempty"`
	SpreadsheetURL           string              `json:"spreadsheetUrl,omitempty"`
	SpreadsheetTitle         string              `json:"spreadsheetTitle,omitempty"`
	GoogleSpreadsheetCreated bool                `json:"googleSpreadsheetCreated"`
	OAuthScopes              []string            `json:"oauthScopes,omitempty"`
	RowCounts                map[string]int      `json:"rowCounts"`
	SheetSchemas             map[string][]string `json:"sheetSchemas"`
	NextRunAt                string              `json:"nextRunAt,omitempty"`
}

type googleSheetsCredential struct {
	AccessToken          string   `json:"accessToken"`
	RefreshToken         string   `json:"refreshToken"`
	AccessTokenExpiresAt string   `json:"accessTokenExpiresAt"`
	Scopes               []string `json:"scopes"`
}

type googleSheetsConnectRequest struct {
	Scopes              map[string]bool `json:"scopes"`
	IncludePrivateTeams bool            `json:"includePrivateTeams"`
}

type googleSheetsTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
}

type googleSheetsOAuthInstall struct {
	ID          string
	WorkspaceID string
	UserID      string
	Metadata    googleSheetsMetadata
}

type googleSheetsRows map[string][][]string

type googleSheetsWriteResult struct {
	SpreadsheetID    string
	SpreadsheetURL   string
	SpreadsheetTitle string
	RowCounts        map[string]int
}

func (h Handler) GoogleSheetsConnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	clientID, _, ok := googleOAuthConfig()
	if !ok {
		problem.JSON(w, http.StatusPreconditionFailed, map[string]string{"error": "Google OAuth is not configured", "message": "Add AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET to enable Google Sheets analytics sync."})
		return
	}
	var input googleSheetsConnectRequest
	_ = json.NewDecoder(r.Body).Decode(&input)
	settings := normalizeGoogleSheetsSettings(input)
	if !hasGoogleSheetsScope(settings) {
		problem.Write(w, http.StatusBadRequest, "Select at least one Google Sheets export scope", "")
		return
	}
	state, err := randomState()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Google Sheets authorization failed", err.Error())
		return
	}
	workspaceSlug, err := h.workspaceSlug(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Google Sheets authorization failed", err.Error())
		return
	}
	if err := h.saveGoogleSheetsOAuthState(r.Context(), p.WorkspaceID, p.UserID, state, workspaceSlug, settings); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Google Sheets authorization failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, slackConnectResponse{AuthorizationURL: googleSheetsAuthorizationURL(clientID, configuredAppURL(), state), State: state, WorkspaceSlug: workspaceSlug})
}

func (h Handler) GoogleSheetsOAuthCallback(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if googleError := strings.TrimSpace(r.URL.Query().Get("error")); googleError != "" {
		http.Redirect(w, r, googleSheetsRedirectURL("error", googleError), http.StatusFound)
		return
	}
	if code == "" || state == "" {
		problem.Write(w, http.StatusBadRequest, "Google Sheets OAuth callback is missing code or state", "")
		return
	}
	_, clientSecret, ok := googleOAuthConfig()
	if !ok {
		problem.Write(w, http.StatusServiceUnavailable, "Google OAuth is not configured", "")
		return
	}
	install, err := h.findGoogleSheetsOAuthInstall(r.Context(), state)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusBadRequest, "Invalid Google Sheets OAuth state", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Google Sheets OAuth callback failed", err.Error())
		return
	}
	token, err := exchangeGoogleOAuth(r.Context(), http.DefaultClient, clientSecret, code, googleSheetsRedirectURI(configuredAppURL()))
	if err != nil {
		_ = h.recordGoogleSheetsFailure(r.Context(), install.ID, install.WorkspaceID, "oauth_failed", err.Error())
		problem.Write(w, http.StatusBadGateway, "Google Sheets OAuth exchange failed", err.Error())
		return
	}
	if err := h.completeGoogleSheetsInstall(r.Context(), install, token); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Google Sheets OAuth callback failed", err.Error())
		return
	}
	_ = (GoogleSheetsWorker{DB: h.DB}).RunOnce(r.Context())
	http.Redirect(w, r, googleSheetsRedirectURL("connected", ""), http.StatusFound)
}

func (h Handler) GoogleSheetsRefresh(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	integrationID, err := h.queueGoogleSheetsSync(r.Context(), p.WorkspaceID, true)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Google Sheets is not connected", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Google Sheets refresh failed", err.Error())
		return
	}
	if err := (GoogleSheetsWorker{DB: h.DB}).RunOnce(r.Context()); err != nil {
		problem.Write(w, http.StatusBadGateway, "Google Sheets refresh failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]any{"success": true, "integrationId": integrationID})
}

func (h Handler) GoogleSheetsDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if err := h.disconnectProvider(r.Context(), p.WorkspaceID, p.UserID, googleSheetsProvider); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect Google Sheets failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) saveGoogleSheetsOAuthState(ctx context.Context, workspaceID, userID, state, workspaceSlug string, settings googleSheetsSettings) error {
	now := time.Now().UTC()
	metadata := googleSheetsMetadata{
		googleSheetsSettings: settings,
		OAuthStateHash:       hashSlackSecret(state),
		OAuthStateExpiresAt:  now.Add(10 * time.Minute).Format(time.RFC3339Nano),
		OAuthStartedAt:       now.Format(time.RFC3339Nano),
		SpreadsheetTitle:     workspaceSlug + " analytics",
		OAuthScopes:          googleSheetsScopes,
		RowCounts:            map[string]int{"issues": 0, "projects": 0, "initiatives": 0},
		SheetSchemas:         googleSheetSchemas,
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into workspace_integration (workspace_id, provider, status, display_name, metadata, connected_by_user_id, connected_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'google_sheets', 'installing', $4, $2::jsonb, $3, null, null, null, null, now())
		on conflict (workspace_id, provider) do update set
			status='installing', display_name=excluded.display_name, metadata=excluded.metadata,
			connected_by_user_id=excluded.connected_by_user_id, credentials_revoked_at=null, revoked_at=null,
			revoked_by_user_id=null, updated_at=now()`, workspaceID, raw, userID, metadata.SpreadsheetTitle)
	return err
}

func (h Handler) findGoogleSheetsOAuthInstall(ctx context.Context, state string) (googleSheetsOAuthInstall, error) {
	rows, err := h.DB.Query(ctx, `
		select id::text, workspace_id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb)
		from workspace_integration
		where provider='google_sheets' and status='installing'`)
	if err != nil {
		return googleSheetsOAuthInstall{}, err
	}
	defer rows.Close()
	stateHash := hashSlackSecret(state)
	for rows.Next() {
		var install googleSheetsOAuthInstall
		var metadataRaw []byte
		if err := rows.Scan(&install.ID, &install.WorkspaceID, &install.UserID, &metadataRaw); err != nil {
			return googleSheetsOAuthInstall{}, err
		}
		install.Metadata = normalizeGoogleSheetsMetadata(metadataRaw)
		if install.Metadata.OAuthStateHash != stateHash {
			continue
		}
		expiresAt, _ := time.Parse(time.RFC3339Nano, install.Metadata.OAuthStateExpiresAt)
		if expiresAt.IsZero() || expiresAt.Before(time.Now().UTC()) {
			return googleSheetsOAuthInstall{}, pgx.ErrNoRows
		}
		return install, nil
	}
	if err := rows.Err(); err != nil {
		return googleSheetsOAuthInstall{}, err
	}
	return googleSheetsOAuthInstall{}, pgx.ErrNoRows
}

func (h Handler) completeGoogleSheetsInstall(ctx context.Context, install googleSheetsOAuthInstall, token googleSheetsTokenResponse) error {
	if token.AccessToken == "" {
		return fmt.Errorf("Google OAuth response did not include an access token")
	}
	now := time.Now().UTC()
	expiresIn := token.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	credential := googleSheetsCredential{AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, AccessTokenExpiresAt: now.Add(time.Duration(expiresIn) * time.Second).Format(time.RFC3339), Scopes: splitOAuthScopes(firstNonEmpty(token.Scope, strings.Join(googleSheetsScopes, " ")))}
	metadata := install.Metadata
	metadata.OAuthStateHash = ""
	metadata.OAuthStateExpiresAt = ""
	metadata.OAuthStartedAt = ""
	metadata.OAuthScopes = credential.Scopes
	metadata.NextRunAt = now.Format(time.RFC3339)
	if metadata.RowCounts == nil {
		metadata.RowCounts = map[string]int{"issues": 0, "projects": 0, "initiatives": 0}
	}
	if metadata.SheetSchemas == nil {
		metadata.SheetSchemas = googleSheetSchemas
	}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	credentialRaw, err := encryptedProviderCredentialJSON(credential)
	if err != nil {
		return err
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		update workspace_integration
		set status='connected', display_name=$2, metadata=$3::jsonb, connected_by_user_id=$4,
			connected_at=coalesce(connected_at, $5), last_event_at=$5, last_success_at=null,
			last_failure_at=null, last_failure_message=null, token_expires_at=$6::timestamp,
			credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=$5
		where id=$1::uuid`, install.ID, metadata.SpreadsheetTitle, metadataRaw, install.UserID, now, credential.AccessTokenExpiresAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at, $2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, install.ID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid, 'google_sheets', $2, $3::jsonb, $4, $5, $5)`, install.ID, credentialRaw, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, next_run_at, updated_at) values ($1::uuid, $2::uuid, 'google_sheets', 'sync', 'queued', '{}'::jsonb, $3, $3, $3)`, install.WorkspaceID, install.ID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid, $2::uuid, 'google_sheets', 'oauth_connected', 'info', 'Google Sheets analytics sync connected.', $3::jsonb, $4)`, install.WorkspaceID, install.ID, metadataRaw, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h Handler) recordGoogleSheetsFailure(ctx context.Context, integrationID string, workspaceID string, eventType string, message string) error {
	if strings.TrimSpace(eventType) == "" {
		eventType = "sync_failed"
	}
	_, err := h.DB.Exec(ctx, `
		update workspace_integration
		set status='error', last_failure_at=now(), last_failure_message=$2, updated_at=now()
		where id=$1::uuid`, integrationID, message)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload)
		values ($1::uuid, $2::uuid, 'google_sheets', $3, 'error', $4, '{}'::jsonb)`, workspaceID, integrationID, eventType, message)
	return err
}

func (h Handler) queueGoogleSheetsSync(ctx context.Context, workspaceID string, immediate bool) (string, error) {
	var integrationID string
	err := h.DB.QueryRow(ctx, `select id::text from workspace_integration where workspace_id=$1::uuid and provider='google_sheets' and status in ('connected','degraded') limit 1`, workspaceID).Scan(&integrationID)
	if err != nil {
		return "", err
	}
	scheduledAt := time.Now().UTC()
	if !immediate {
		scheduledAt = scheduledAt.Add(googleSheetsRefreshHour)
	}
	_, err = h.DB.Exec(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, next_run_at, updated_at) values ($1::uuid, $2::uuid, 'google_sheets', 'sync', 'queued', '{}'::jsonb, $3, $3, now())`, workspaceID, integrationID, scheduledAt)
	return integrationID, err
}

func normalizeGoogleSheetsSettings(input googleSheetsConnectRequest) googleSheetsSettings {
	return googleSheetsSettings{
		Scopes: map[string]bool{
			"issues":      input.Scopes == nil || input.Scopes["issues"],
			"projects":    input.Scopes == nil || input.Scopes["projects"],
			"initiatives": input.Scopes == nil || input.Scopes["initiatives"],
		},
		IncludePrivateTeams: input.IncludePrivateTeams,
		Schedule:            "hourly",
		Enabled:             true,
	}
}

func normalizeGoogleSheetsMetadata(raw []byte) googleSheetsMetadata {
	metadata := googleSheetsMetadata{}
	_ = json.Unmarshal(raw, &metadata)
	if metadata.Scopes == nil {
		metadata.Scopes = map[string]bool{"issues": true, "projects": true, "initiatives": true}
	}
	if metadata.Schedule == "" {
		metadata.Schedule = "hourly"
	}
	metadata.Enabled = metadata.Enabled || metadata.Schedule == "hourly"
	if metadata.RowCounts == nil {
		metadata.RowCounts = map[string]int{"issues": 0, "projects": 0, "initiatives": 0}
	}
	if metadata.SheetSchemas == nil {
		metadata.SheetSchemas = googleSheetSchemas
	}
	return metadata
}

func hasGoogleSheetsScope(settings googleSheetsSettings) bool {
	return settings.Scopes["issues"] || settings.Scopes["projects"] || settings.Scopes["initiatives"]
}

func googleSheetsConfigured() bool {
	_, _, ok := googleOAuthConfig()
	return ok
}

func googleOAuthConfig() (clientID string, clientSecret string, ok bool) {
	clientID = strings.TrimSpace(os.Getenv("AUTH_GOOGLE_ID"))
	clientSecret = strings.TrimSpace(os.Getenv("AUTH_GOOGLE_SECRET"))
	return clientID, clientSecret, clientID != "" && clientSecret != ""
}

func googleSheetsRedirectURI(appURL string) string {
	return strings.TrimRight(appURL, "/") + "/api/integrations/google-sheets/oauth/callback"
}

func googleSheetsAuthorizationURL(clientID, appURL, state string) string {
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("redirect_uri", googleSheetsRedirectURI(appURL))
	values.Set("response_type", "code")
	values.Set("scope", strings.Join(googleSheetsScopes, " "))
	values.Set("access_type", "offline")
	values.Set("prompt", "consent")
	values.Set("state", state)
	return "https://accounts.google.com/o/oauth2/v2/auth?" + values.Encode()
}

func googleSheetsRedirectURL(status string, message string) string {
	values := url.Values{}
	values.Set("googleSheets", status)
	if strings.TrimSpace(message) != "" {
		values.Set("message", message)
	}
	return strings.TrimRight(configuredAppURL(), "/") + "/settings/integrations?" + values.Encode()
}

func googleSheetsAPIBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("GOOGLE_SHEETS_API_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://sheets.googleapis.com/v4/spreadsheets"
}

func googleOAuthTokenURL() string {
	if v := strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_TOKEN_URL")); v != "" {
		return v
	}
	return "https://oauth2.googleapis.com/token"
}

func exchangeGoogleOAuth(ctx context.Context, client *http.Client, clientSecret string, code string, redirectURI string) (googleSheetsTokenResponse, error) {
	clientID, _, ok := googleOAuthConfig()
	if !ok {
		return googleSheetsTokenResponse{}, fmt.Errorf("Google OAuth is not configured")
	}
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("client_secret", clientSecret)
	values.Set("code", code)
	values.Set("grant_type", "authorization_code")
	values.Set("redirect_uri", redirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, googleOAuthTokenURL(), strings.NewReader(values.Encode()))
	if err != nil {
		return googleSheetsTokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return googleSheetsTokenResponse{}, err
	}
	defer resp.Body.Close()
	var token googleSheetsTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return googleSheetsTokenResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return googleSheetsTokenResponse{}, fmt.Errorf("Google OAuth returned HTTP %d", resp.StatusCode)
	}
	if token.AccessToken == "" {
		return googleSheetsTokenResponse{}, fmt.Errorf("Google OAuth returned no access token")
	}
	return token, nil
}

func googleSheetsDetails(raw []byte) map[string]any {
	metadata := normalizeGoogleSheetsMetadata(raw)
	return map[string]any{
		"spreadsheetId":       metadata.SpreadsheetID,
		"spreadsheetUrl":      metadata.SpreadsheetURL,
		"spreadsheetTitle":    metadata.SpreadsheetTitle,
		"scopes":              metadata.Scopes,
		"includePrivateTeams": metadata.IncludePrivateTeams,
		"schedule":            metadata.Schedule,
		"enabled":             metadata.Enabled,
		"nextRunAt":           emptyToNil(metadata.NextRunAt),
		"rowCounts":           metadata.RowCounts,
		"sheetSchemas":        metadata.SheetSchemas,
	}
}

func emptyToNil(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func splitOAuthScopes(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == ' ' || r == ',' })
	out := []string{}
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func formatSheetCell(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case time.Time:
		return typed.UTC().Format(time.RFC3339)
	case *time.Time:
		if typed == nil {
			return ""
		}
		return typed.UTC().Format(time.RFC3339)
	case *float64:
		if typed == nil {
			return ""
		}
		return fmt.Sprintf("%g", *typed)
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func sortedUnique(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		out = append(out, trimmed)
	}
	sort.Strings(out)
	return out
}

func readBody(resp *http.Response) string {
	if resp == nil || resp.Body == nil {
		return ""
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return string(bytes.TrimSpace(body))
}
