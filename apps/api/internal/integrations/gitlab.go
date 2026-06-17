package integrations

import (
	"context"
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
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type gitLabSetupRequest struct {
	Origin string `json:"origin"`
	Token  string `json:"token"`
}

type gitLabSetupResponse struct {
	Connected     bool                    `json:"connected"`
	IntegrationID string                  `json:"integrationId"`
	Origin        string                  `json:"origin"`
	DisplayName   string                  `json:"displayName"`
	WebhookURL    string                  `json:"webhookUrl"`
	WebhookSecret string                  `json:"webhookSecret"`
	Workflows     []gitLabWorkflowMapping `json:"workflows"`
}

type gitLabStatusResponse struct {
	Connected     bool                    `json:"connected"`
	IntegrationID *string                 `json:"integrationId"`
	Origin        *string                 `json:"origin"`
	DisplayName   *string                 `json:"displayName"`
	WebhookURL    *string                 `json:"webhookUrl"`
	WebhookSecret *string                 `json:"webhookSecret"`
	Workflows     []gitLabWorkflowMapping `json:"workflows"`
}

type gitLabWorkflowRequest struct {
	TeamID                    string  `json:"teamId"`
	MergeRequestMergedStateID *string `json:"mergeRequestMergedStateId"`
}

type gitLabWorkflowMapping struct {
	TeamID                    string  `json:"teamId"`
	TeamKey                   string  `json:"teamKey"`
	TeamName                  string  `json:"teamName"`
	MergeRequestMergedStateID *string `json:"mergeRequestMergedStateId"`
}

type gitLabUser struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
}

type gitLabCredential struct {
	Token         string `json:"token"`
	Origin        string `json:"origin"`
	WebhookSecret string `json:"webhookSecret"`
}

type gitLabInstall struct {
	WorkspaceID   string
	IntegrationID string
	Origin        string
	WebhookSecret string
}

type gitLabWebhookPayload struct {
	ObjectKind       string                       `json:"object_kind"`
	EventType        string                       `json:"event_type"`
	Project          gitLabProjectPayload         `json:"project"`
	User             gitLabUserPayload            `json:"user"`
	ObjectAttributes gitLabMergeRequestAttributes `json:"object_attributes"`
	Commits          []gitLabCommitPayload        `json:"commits"`
}

type gitLabProjectPayload struct {
	ID                any    `json:"id"`
	PathWithNamespace string `json:"path_with_namespace"`
	WebURL            string `json:"web_url"`
}

type gitLabUserPayload struct {
	Name      string `json:"name"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

type gitLabMergeRequestAttributes struct {
	ID           any                    `json:"id"`
	IID          any                    `json:"iid"`
	Title        string                 `json:"title"`
	Description  string                 `json:"description"`
	SourceBranch string                 `json:"source_branch"`
	TargetBranch string                 `json:"target_branch"`
	State        string                 `json:"state"`
	Action       string                 `json:"action"`
	URL          string                 `json:"url"`
	WebURL       string                 `json:"web_url"`
	MergedAt     string                 `json:"merged_at"`
	LastCommit   gitLabCommitPayload    `json:"last_commit"`
	Source       gitLabBranchProjectRef `json:"source"`
	Target       gitLabBranchProjectRef `json:"target"`
	Assignee     map[string]any         `json:"assignee"`
	Assignees    []map[string]any       `json:"assignees"`
	Labels       []map[string]any       `json:"labels"`
	Extra        map[string]any         `json:"-"`
}

type gitLabBranchProjectRef struct {
	Name string `json:"name"`
}

type gitLabCommitPayload struct {
	ID      string `json:"id"`
	Message string `json:"message"`
	Title   string `json:"title"`
	URL     string `json:"url"`
}

type gitLabMergeRequestEvent struct {
	ProjectID     string
	ProjectPath   string
	ProjectURL    string
	MRID          string
	MRIID         string
	Title         string
	Description   string
	SourceBranch  string
	TargetBranch  string
	State         string
	Action        string
	URL           string
	MergedAt      *time.Time
	Identifiers   []string
	ActorName     string
	ActorEmail    string
	ActorUsername string
}

type gitLabIssueRecord struct {
	ID      string
	TeamID  string
	StateID string
}

var gitLabIdentifierPattern = regexp.MustCompile(`(?i)\b[A-Z][A-Z0-9]{1,9}-[0-9]+\b`)

func (h Handler) GitLabSetup(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	var input gitLabSetupRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "GitLab setup payload is invalid", err.Error())
		return
	}
	origin, err := normalizeGitLabOrigin(input.Origin)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "GitLab origin is invalid", err.Error())
		return
	}
	token := strings.TrimSpace(input.Token)
	if token == "" {
		problem.Write(w, http.StatusBadRequest, "GitLab token is required", "")
		return
	}
	gitlabUser, err := validateGitLabToken(r.Context(), http.DefaultClient, origin, token)
	if err != nil {
		problem.Write(w, http.StatusBadGateway, "GitLab token validation failed", err.Error())
		return
	}
	secret, err := randomGitLabSecret()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create GitLab webhook secret failed", err.Error())
		return
	}
	integrationID, err := h.saveGitLabIntegration(r.Context(), p.WorkspaceID, p.UserID, origin, token, secret, gitlabUser)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Save GitLab integration failed", err.Error())
		return
	}
	workflows, err := h.gitLabWorkflowMappings(r.Context(), p.WorkspaceID, integrationID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load GitLab workflows failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, gitLabSetupResponse{Connected: true, IntegrationID: integrationID, Origin: origin, DisplayName: gitLabDisplayName(origin, gitlabUser), WebhookURL: gitLabWebhookURL(integrationID), WebhookSecret: secret, Workflows: workflows})
}

func (h Handler) GitLabStatus(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	row, credential, err := h.gitLabIntegrationStatus(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.JSON(w, http.StatusOK, gitLabStatusResponse{Connected: false, Workflows: []gitLabWorkflowMapping{}})
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load GitLab integration failed", err.Error())
		return
	}
	workflows, err := h.gitLabWorkflowMappings(r.Context(), p.WorkspaceID, row.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load GitLab workflows failed", err.Error())
		return
	}
	origin := credential.Origin
	if origin == "" && row.ExternalID != nil {
		origin = *row.ExternalID
	}
	webhookURL := gitLabWebhookURL(row.ID)
	problem.JSON(w, http.StatusOK, gitLabStatusResponse{Connected: row.Status == "connected" || row.Status == "degraded", IntegrationID: &row.ID, Origin: stringPtr(origin), DisplayName: row.DisplayName, WebhookURL: &webhookURL, WebhookSecret: stringPtr(credential.WebhookSecret), Workflows: workflows})
}

func (h Handler) GitLabWorkflow(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	row, _, err := h.gitLabIntegrationStatus(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusConflict, "Connect GitLab before configuring workflows", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load GitLab integration failed", err.Error())
		return
	}
	var input gitLabWorkflowRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "GitLab workflow payload is invalid", err.Error())
		return
	}
	if err := h.saveGitLabWorkflow(r.Context(), p.WorkspaceID, row.ID, p.UserID, input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Save GitLab workflow failed", err.Error())
		return
	}
	workflows, err := h.gitLabWorkflowMappings(r.Context(), p.WorkspaceID, row.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load GitLab workflows failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]any{"workflows": workflows})
}

func (h Handler) GitLabDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if err := h.disconnectProvider(r.Context(), p.WorkspaceID, p.UserID, "gitlab"); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect GitLab failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) GitLabWebhook(w http.ResponseWriter, r *http.Request) {
	integrationID := strings.TrimSpace(chi.URLParam(r, "integrationID"))
	if integrationID == "" {
		problem.Write(w, http.StatusBadRequest, "GitLab integration is required", "")
		return
	}
	install, err := h.resolveGitLabWebhookInstall(r.Context(), integrationID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "GitLab integration not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Resolve GitLab integration failed", err.Error())
		return
	}
	if !verifyGitLabWebhookSecret(install.WebhookSecret, r.Header.Get("X-Gitlab-Token")) {
		problem.Write(w, http.StatusUnauthorized, "Invalid GitLab webhook secret", "")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "GitLab webhook body could not be read", err.Error())
		return
	}
	var payload gitLabWebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		problem.Write(w, http.StatusBadRequest, "GitLab webhook payload is invalid", err.Error())
		return
	}
	processed, err := h.handleGitLabWebhook(r.Context(), install, payload)
	if err != nil {
		_ = h.recordGitLabEvent(r.Context(), install, "webhook_ingestion_failed", "error", err.Error(), map[string]any{"bodyHash": hashGitLabSecret(string(body))})
		problem.Write(w, http.StatusInternalServerError, "GitLab webhook could not be processed", err.Error())
		return
	}
	message := "GitLab webhook accepted."
	if processed == 0 {
		message = "GitLab webhook accepted with no linked exponential issues."
	}
	_ = h.recordGitLabEvent(r.Context(), install, "webhook_ingested", "info", message, map[string]any{"processedIssueCount": processed})
	problem.JSON(w, http.StatusAccepted, map[string]any{"ok": true, "processedIssueCount": processed})
}

func normalizeGitLabOrigin(input string) (string, error) {
	value := strings.TrimSpace(input)
	if value == "" {
		value = "https://gitlab.com"
	}
	if !strings.Contains(value, "://") {
		value = "https://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "https" {
		return "", fmt.Errorf("GitLab origin must use https")
	}
	if parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("GitLab origin must be an HTTPS origin without credentials, query, or fragment")
	}
	path := strings.Trim(parsed.EscapedPath(), "/")
	if path != "" {
		return "", fmt.Errorf("GitLab origin must not include a path")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Path = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func validateGitLabToken(ctx context.Context, client *http.Client, origin string, token string) (gitLabUser, error) {
	if client == nil {
		client = http.DefaultClient
	}
	endpoint := strings.TrimRight(origin, "/") + "/api/v4/user"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return gitLabUser{}, err
	}
	req.Header.Set("PRIVATE-TOKEN", token)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return gitLabUser{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return gitLabUser{}, fmt.Errorf("GitLab rejected the token")
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return gitLabUser{}, fmt.Errorf("GitLab returned HTTP %d", resp.StatusCode)
	}
	var user gitLabUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return gitLabUser{}, err
	}
	if user.ID == 0 || strings.TrimSpace(user.Username) == "" {
		return gitLabUser{}, fmt.Errorf("GitLab user response was incomplete")
	}
	return user, nil
}

func (h Handler) saveGitLabIntegration(ctx context.Context, workspaceID, userID, origin, token, webhookSecret string, user gitLabUser) (string, error) {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	now := time.Now().UTC()
	metadata := map[string]any{"origin": origin, "gitlabUserId": user.ID, "gitlabUsername": user.Username, "configuredBy": userID}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return "", err
	}
	displayName := gitLabDisplayName(origin, user)
	var integrationID string
	if err := tx.QueryRow(ctx, `
		insert into workspace_integration (workspace_id, provider, status, external_id, display_name, metadata, connected_by_user_id, connected_at, last_event_at, last_success_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'gitlab', 'connected', $2, $3, $4::jsonb, $5, $6, $6, $6, null, null, null, $6)
		on conflict (workspace_id, provider) do update set
			status='connected', external_id=excluded.external_id, display_name=excluded.display_name, metadata=excluded.metadata,
			connected_by_user_id=excluded.connected_by_user_id, connected_at=coalesce(workspace_integration.connected_at, excluded.connected_at),
			last_event_at=excluded.last_event_at, last_success_at=excluded.last_success_at, last_failure_at=null, last_failure_message=null,
			credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=excluded.updated_at
		returning id::text`, workspaceID, origin, displayName, metadataRaw, userID, now).Scan(&integrationID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at, $2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, integrationID, now); err != nil {
		return "", err
	}
	credential := gitLabCredential{Token: token, Origin: origin, WebhookSecret: webhookSecret}
	credentialRaw, err := encryptedProviderCredentialJSON(credential)
	if err != nil {
		return "", err
	}
	credentialMetadataRaw, _ := json.Marshal(map[string]any{"origin": origin, "gitlabUserId": user.ID, "gitlabUsername": user.Username})
	if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid, 'gitlab', $2, $3::jsonb, $4, $5, $5)`, integrationID, credentialRaw, credentialMetadataRaw, userID, now); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid, $2::uuid, 'gitlab', 'token_validated', 'info', 'GitLab integration connected.', $3::jsonb, $4)`, workspaceID, integrationID, metadataRaw, now); err != nil {
		return "", err
	}
	return integrationID, tx.Commit(ctx)
}

func (h Handler) gitLabIntegrationStatus(ctx context.Context, workspaceID string) (row, gitLabCredential, error) {
	var r row
	var credentialRaw []byte
	err := h.DB.QueryRow(ctx, `
		select wi.id::text, wi.provider, wi.status, wi.display_name, wi.external_id, wi.connected_at, wi.last_event_at, wi.last_success_at, wi.last_failure_at, wi.last_failure_message, wi.token_expires_at, coalesce(pc.encrypted_payload,'{}'::bytea)
		from workspace_integration wi
		left join provider_credential pc on pc.workspace_integration_id=wi.id and pc.provider='gitlab' and pc.active
		where wi.workspace_id=$1::uuid and wi.provider='gitlab'
		limit 1`, workspaceID).Scan(&r.ID, &r.Provider, &r.Status, &r.DisplayName, &r.ExternalID, &r.ConnectedAt, &r.LastEventAt, &r.LastSuccessAt, &r.LastFailureAt, &r.LastFailureMessage, &r.TokenExpiresAt, &credentialRaw)
	if err != nil {
		return row{}, gitLabCredential{}, err
	}
	var credential gitLabCredential
	if err := decryptProviderCredentialJSON(ctx, h.DB, r.ID, "gitlab", credentialRaw, &credential); err != nil {
		return row{}, gitLabCredential{}, err
	}
	return r, credential, nil
}

func (h Handler) resolveGitLabWebhookInstall(ctx context.Context, integrationID string) (gitLabInstall, error) {
	var install gitLabInstall
	var credentialRaw []byte
	err := h.DB.QueryRow(ctx, `
		select wi.workspace_id::text, wi.id::text, coalesce(wi.external_id,''), pc.encrypted_payload
		from workspace_integration wi
		join provider_credential pc on pc.workspace_integration_id=wi.id and pc.provider='gitlab' and pc.active
		where wi.id=$1::uuid and wi.provider='gitlab' and wi.status in ('connected','degraded')
		limit 1`, integrationID).Scan(&install.WorkspaceID, &install.IntegrationID, &install.Origin, &credentialRaw)
	if err != nil {
		return install, err
	}
	var credential gitLabCredential
	if err := decryptProviderCredentialJSON(ctx, h.DB, install.IntegrationID, "gitlab", credentialRaw, &credential); err != nil {
		return install, err
	}
	if credential.Origin != "" {
		install.Origin = credential.Origin
	}
	install.WebhookSecret = credential.WebhookSecret
	return install, nil
}

func (h Handler) gitLabWorkflowMappings(ctx context.Context, workspaceID, integrationID string) ([]gitLabWorkflowMapping, error) {
	rows, err := h.DB.Query(ctx, `
		select t.id::text, t.key, t.name, gwa.merge_request_merged_state_id::text
		from team t
		left join gitlab_workflow_automation gwa on gwa.team_id=t.id and gwa.workspace_integration_id=$2::uuid
		where t.workspace_id=$1::uuid and t.deleted_at is null and t.retired_at is null
		order by t.key asc`, workspaceID, integrationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []gitLabWorkflowMapping{}
	for rows.Next() {
		var mapping gitLabWorkflowMapping
		if err := rows.Scan(&mapping.TeamID, &mapping.TeamKey, &mapping.TeamName, &mapping.MergeRequestMergedStateID); err != nil {
			return nil, err
		}
		out = append(out, mapping)
	}
	return out, rows.Err()
}

func (h Handler) saveGitLabWorkflow(ctx context.Context, workspaceID, integrationID, userID string, input gitLabWorkflowRequest) error {
	teamID := strings.TrimSpace(input.TeamID)
	if teamID == "" {
		return fmt.Errorf("teamId is required")
	}
	var exists bool
	if err := h.DB.QueryRow(ctx, `select exists(select 1 from team where id=$1::uuid and workspace_id=$2::uuid and deleted_at is null and retired_at is null)`, teamID, workspaceID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("team not found")
	}
	stateID := ""
	if input.MergeRequestMergedStateID != nil {
		stateID = strings.TrimSpace(*input.MergeRequestMergedStateID)
	}
	if stateID == "" {
		_, err := h.DB.Exec(ctx, `delete from gitlab_workflow_automation where workspace_integration_id=$1::uuid and team_id=$2::uuid`, integrationID, teamID)
		return err
	}
	if err := h.DB.QueryRow(ctx, `select exists(select 1 from workflow_state where id=$1::uuid and team_id=$2::uuid)`, stateID, teamID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("mergeRequestMergedStateId is not a workflow state for the selected team")
	}
	_, err := h.DB.Exec(ctx, `
		insert into gitlab_workflow_automation (workspace_integration_id, team_id, merge_request_merged_state_id, updated_by_user_id, updated_at)
		values ($1::uuid, $2::uuid, $3::uuid, $4, now())
		on conflict (team_id) do update set workspace_integration_id=excluded.workspace_integration_id, merge_request_merged_state_id=excluded.merge_request_merged_state_id, updated_by_user_id=excluded.updated_by_user_id, updated_at=now()`, integrationID, teamID, stateID, userID)
	return err
}

func (h Handler) handleGitLabWebhook(ctx context.Context, install gitLabInstall, payload gitLabWebhookPayload) (int, error) {
	event, ok := gitLabMergeRequestEventFromPayload(payload)
	if !ok {
		return 0, nil
	}
	issues, err := h.gitLabIssuesForIdentifiers(ctx, install.WorkspaceID, event.Identifiers)
	if err != nil {
		return 0, err
	}
	if len(issues) == 0 {
		return 0, nil
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	processed := 0
	for _, identifier := range event.Identifiers {
		issue, ok := issues[identifier]
		if !ok {
			continue
		}
		changed, err := upsertGitLabMergeRequestLink(ctx, tx, install, issue.ID, event)
		if err != nil {
			return 0, err
		}
		if changed {
			if err := insertGitLabMergeRequestHistory(ctx, tx, issue.ID, event); err != nil {
				return 0, err
			}
			if event.Action == "merged" {
				if err := applyGitLabMergedWorkflow(ctx, tx, install, issue, event); err != nil {
					return 0, err
				}
			}
		}
		processed++
	}
	return processed, tx.Commit(ctx)
}

func gitLabMergeRequestEventFromPayload(payload gitLabWebhookPayload) (gitLabMergeRequestEvent, bool) {
	kind := strings.ToLower(firstNonEmpty(payload.ObjectKind, payload.EventType))
	if kind != "merge_request" && kind != "merge request" {
		return gitLabMergeRequestEvent{}, false
	}
	action := normalizeGitLabMergeRequestAction(payload.ObjectAttributes.Action, payload.ObjectAttributes.State)
	if action == "" {
		return gitLabMergeRequestEvent{}, false
	}
	texts := []string{payload.ObjectAttributes.Title, payload.ObjectAttributes.Description, payload.ObjectAttributes.SourceBranch, payload.ObjectAttributes.TargetBranch, payload.ObjectAttributes.LastCommit.Message, payload.ObjectAttributes.LastCommit.Title}
	for _, commit := range payload.Commits {
		texts = append(texts, commit.Message, commit.Title)
	}
	identifiers := extractGitLabIssueIdentifiers(texts...)
	mrURL := firstNonEmpty(payload.ObjectAttributes.URL, payload.ObjectAttributes.WebURL)
	projectID := gitLabAnyID(payload.Project.ID)
	if projectID == "" {
		projectID = payload.Project.PathWithNamespace
	}
	mrIID := gitLabAnyID(payload.ObjectAttributes.IID)
	mrID := gitLabAnyID(payload.ObjectAttributes.ID)
	if projectID == "" || mrIID == "" {
		return gitLabMergeRequestEvent{}, false
	}
	var mergedAt *time.Time
	if parsed, err := time.Parse(time.RFC3339, payload.ObjectAttributes.MergedAt); err == nil {
		mergedAt = &parsed
	}
	actorName := firstNonEmpty(payload.User.Name, payload.User.Username)
	return gitLabMergeRequestEvent{ProjectID: projectID, ProjectPath: payload.Project.PathWithNamespace, ProjectURL: payload.Project.WebURL, MRID: mrID, MRIID: mrIID, Title: payload.ObjectAttributes.Title, Description: payload.ObjectAttributes.Description, SourceBranch: payload.ObjectAttributes.SourceBranch, TargetBranch: payload.ObjectAttributes.TargetBranch, State: payload.ObjectAttributes.State, Action: action, URL: mrURL, MergedAt: mergedAt, Identifiers: identifiers, ActorName: actorName, ActorEmail: payload.User.Email, ActorUsername: payload.User.Username}, true
}

func normalizeGitLabMergeRequestAction(action string, state string) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "open", "opened":
		return "opened"
	case "reopen", "reopened":
		return "reopened"
	case "update", "updated":
		return "updated"
	case "approved", "approval", "approve":
		return "approved"
	case "merge", "merged":
		return "merged"
	}
	if strings.EqualFold(strings.TrimSpace(state), "merged") {
		return "merged"
	}
	return ""
}

func extractGitLabIssueIdentifiers(values ...string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		for _, match := range gitLabIdentifierPattern.FindAllString(value, -1) {
			identifier := strings.ToUpper(match)
			if !seen[identifier] {
				seen[identifier] = true
				out = append(out, identifier)
			}
		}
	}
	sort.Strings(out)
	return out
}

func (h Handler) gitLabIssuesForIdentifiers(ctx context.Context, workspaceID string, identifiers []string) (map[string]gitLabIssueRecord, error) {
	out := map[string]gitLabIssueRecord{}
	if len(identifiers) == 0 {
		return out, nil
	}
	lower := make([]string, 0, len(identifiers))
	for _, identifier := range identifiers {
		lower = append(lower, strings.ToLower(identifier))
	}
	rows, err := h.DB.Query(ctx, `
		select upper(i.identifier), i.id::text, i.team_id::text, i.state_id::text
		from issue i
		join team t on t.id=i.team_id
		where t.workspace_id=$1::uuid and lower(i.identifier)=any($2)`, workspaceID, lower)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var identifier string
		var issue gitLabIssueRecord
		if err := rows.Scan(&identifier, &issue.ID, &issue.TeamID, &issue.StateID); err != nil {
			return nil, err
		}
		out[identifier] = issue
	}
	return out, rows.Err()
}

func upsertGitLabMergeRequestLink(ctx context.Context, tx pgx.Tx, install gitLabInstall, issueID string, event gitLabMergeRequestEvent) (bool, error) {
	eventKey := event.gitLabEventKey()
	var previousEventKey string
	err := tx.QueryRow(ctx, `
		select coalesce(last_event_key,'')
		from gitlab_merge_request_link
		where workspace_integration_id=$1::uuid and issue_id=$2::uuid and project_id=$3 and merge_request_iid=$4
		limit 1 for update`, install.IntegrationID, issueID, event.ProjectID, event.MRIID).Scan(&previousEventKey)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx, `
			insert into gitlab_merge_request_link (workspace_id, workspace_integration_id, issue_id, project_id, project_path, project_url, merge_request_iid, merge_request_id, title, url, source_branch, target_branch, state, last_action, last_event_key, merged_at, updated_at)
			values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())`, install.WorkspaceID, install.IntegrationID, issueID, event.ProjectID, event.ProjectPath, event.ProjectURL, event.MRIID, event.MRID, event.Title, event.URL, event.SourceBranch, event.TargetBranch, event.State, event.Action, eventKey, event.MergedAt)
		return true, err
	}
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `
		update gitlab_merge_request_link
		set project_path=$5, project_url=$6, merge_request_id=$7, title=$8, url=$9, source_branch=$10, target_branch=$11, state=$12, last_action=$13, last_event_key=$14, merged_at=coalesce($15, merged_at), updated_at=now()
		where workspace_integration_id=$1::uuid and issue_id=$2::uuid and project_id=$3 and merge_request_iid=$4`, install.IntegrationID, issueID, event.ProjectID, event.MRIID, event.ProjectPath, event.ProjectURL, event.MRID, event.Title, event.URL, event.SourceBranch, event.TargetBranch, event.State, event.Action, eventKey, event.MergedAt)
	return previousEventKey != eventKey, err
}

func insertGitLabMergeRequestHistory(ctx context.Context, tx pgx.Tx, issueID string, event gitLabMergeRequestEvent) error {
	metadata := gitLabHistoryMetadata(event)
	raw, _ := json.Marshal(metadata)
	_, err := tx.Exec(ctx, `insert into issue_history (issue_id, actor_name, actor_email, event_type, metadata) values ($1::uuid, $2, $3, 'gitlab_merge_request', $4::jsonb)`, issueID, nullString(event.ActorName), nullString(event.ActorEmail), raw)
	return err
}

func applyGitLabMergedWorkflow(ctx context.Context, tx pgx.Tx, install gitLabInstall, issue gitLabIssueRecord, event gitLabMergeRequestEvent) error {
	var stateID, category string
	err := tx.QueryRow(ctx, `
		select ws.id::text, ws.category::text
		from gitlab_workflow_automation gwa
		join workflow_state ws on ws.id=gwa.merge_request_merged_state_id and ws.team_id=gwa.team_id
		where gwa.workspace_integration_id=$1::uuid and gwa.team_id=$2::uuid
		limit 1`, install.IntegrationID, issue.TeamID).Scan(&stateID, &category)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if stateID == issue.StateID {
		return nil
	}
	var completedAt *time.Time
	var canceledAt *time.Time
	now := time.Now().UTC()
	if category == "completed" {
		completedAt = &now
	}
	if category == "canceled" {
		canceledAt = &now
	}
	if _, err := tx.Exec(ctx, `update issue set state_id=$1::uuid, updated_at=now(), completed_at=$2, canceled_at=$3 where id=$4::uuid`, stateID, completedAt, canceledAt, issue.ID); err != nil {
		return err
	}
	metadata := gitLabHistoryMetadata(event)
	metadata["source"] = "gitlab_workflow_automation"
	metadata["changedFields"] = []string{"stateId"}
	metadata["fromStateId"] = issue.StateID
	metadata["toStateId"] = stateID
	raw, _ := json.Marshal(metadata)
	_, err = tx.Exec(ctx, `insert into issue_history (issue_id, actor_name, actor_email, event_type, metadata) values ($1::uuid, $2, $3, 'updated', $4::jsonb)`, issue.ID, nullString(event.ActorName), nullString(event.ActorEmail), raw)
	return err
}

func (event gitLabMergeRequestEvent) gitLabEventKey() string {
	return event.ProjectID + ":" + event.MRIID + ":" + event.Action
}

func gitLabHistoryMetadata(event gitLabMergeRequestEvent) map[string]any {
	return map[string]any{
		"source":   "gitlab_merge_request",
		"provider": "gitlab",
		"action":   event.Action,
		"gitlab": map[string]any{
			"projectId":       event.ProjectID,
			"projectPath":     event.ProjectPath,
			"projectUrl":      event.ProjectURL,
			"mergeRequestId":  event.MRID,
			"mergeRequestIid": event.MRIID,
			"title":           event.Title,
			"url":             event.URL,
			"state":           event.State,
			"sourceBranch":    event.SourceBranch,
			"targetBranch":    event.TargetBranch,
			"actorUsername":   event.ActorUsername,
		},
	}
}

func (h Handler) recordGitLabEvent(ctx context.Context, install gitLabInstall, eventType, severity, message string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'gitlab',$3,$4,$5,$6::jsonb)`, install.WorkspaceID, install.IntegrationID, eventType, severity, message, raw)
	return err
}

func randomGitLabSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func verifyGitLabWebhookSecret(expected string, got string) bool {
	expected = strings.TrimSpace(expected)
	got = strings.TrimSpace(got)
	if expected == "" || got == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(got)) == 1
}

func hashGitLabSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func gitLabWebhookURL(integrationID string) string {
	return strings.TrimRight(configuredAppURL(), "/") + "/api/integrations/gitlab/webhook/" + integrationID
}

func gitLabDisplayName(origin string, user gitLabUser) string {
	username := strings.TrimSpace(user.Username)
	if username == "" {
		return origin
	}
	return strings.TrimPrefix(origin, "https://") + " · " + username
}

func gitLabAnyID(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	case json.Number:
		return typed.String()
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	}
}

func stringPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
