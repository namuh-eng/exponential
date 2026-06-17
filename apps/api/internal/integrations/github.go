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

// ── Legacy setup types (manual webhook configuration) ──────────────────────

type gitHubSetupRequest struct {
	InstallationID   string                  `json:"installationId"`
	AccountLogin     string                  `json:"accountLogin"`
	AccountType      string                  `json:"accountType"`
	WebhookSecret    string                  `json:"webhookSecret"`
	BranchNameFormat string                  `json:"branchNameFormat"`
	Repositories     []gitHubRepositoryInput `json:"repositories"`
}

type gitHubRepositoryInput struct {
	ID       string `json:"id"`
	Owner    string `json:"owner"`
	Name     string `json:"name"`
	FullName string `json:"fullName"`
	HTMLURL  string `json:"htmlUrl"`
}

type gitHubSetupResponse struct {
	Connected      bool                      `json:"connected"`
	IntegrationID  string                    `json:"integrationId"`
	InstallationID string                    `json:"installationId"`
	DisplayName    string                    `json:"displayName"`
	WebhookURL     string                    `json:"webhookUrl"`
	WebhookSecret  string                    `json:"webhookSecret"`
	Repositories   []gitHubRepositoryMapping `json:"repositories"`
	Workflows      []gitHubWorkflowMapping   `json:"workflows"`
}

type gitHubStatusResponse struct {
	Connected      bool                      `json:"connected"`
	IntegrationID  *string                   `json:"integrationId"`
	InstallationID *string                   `json:"installationId"`
	DisplayName    *string                   `json:"displayName"`
	WebhookURL     *string                   `json:"webhookUrl"`
	Repositories   []gitHubRepositoryMapping `json:"repositories"`
	Workflows      []gitHubWorkflowMapping   `json:"workflows"`
}

type gitHubRepositoryMapping struct {
	ID       string  `json:"id"`
	Owner    string  `json:"owner"`
	Name     string  `json:"name"`
	FullName string  `json:"fullName"`
	HTMLURL  *string `json:"htmlUrl"`
	TeamID   *string `json:"teamId"`
	Enabled  bool    `json:"enabled"`
}

type gitHubWorkflowRequest struct {
	TeamID                   string  `json:"teamId"`
	PullRequestMergedStateID *string `json:"pullRequestMergedStateId"`
}

type gitHubWorkflowMapping struct {
	TeamID                   string  `json:"teamId"`
	TeamKey                  string  `json:"teamKey"`
	TeamName                 string  `json:"teamName"`
	PullRequestMergedStateID *string `json:"pullRequestMergedStateId"`
}

type gitHubCredential struct {
	WebhookSecret string `json:"webhookSecret"`
}

type gitHubInstall struct {
	WorkspaceID      string
	IntegrationID    string
	InstallationID   string
	WebhookSecret    string
	BranchNameFormat string
}

type gitHubWebhookPayload struct {
	Action       string                    `json:"action"`
	Installation *gitHubInstallationPayload `json:"installation"`
	Repository   gitHubRepositoryPayload   `json:"repository"`
	PullRequest  gitHubPullRequestPayload  `json:"pull_request"`
	Commits      []gitHubCommitPayload     `json:"commits"`
	HeadCommit   *gitHubCommitPayload      `json:"head_commit"`
	Sender       gitHubUserPayload         `json:"sender"`
}

type gitHubInstallationPayload struct {
	ID any `json:"id"`
}

type gitHubRepositoryPayload struct {
	ID       any    `json:"id"`
	Name     string `json:"name"`
	FullName string `json:"full_name"`
	HTMLURL  string `json:"html_url"`
	Owner    struct {
		Login string `json:"login"`
	} `json:"owner"`
}

type gitHubPullRequestPayload struct {
	ID             any    `json:"id"`
	Number         int    `json:"number"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	HTMLURL        string `json:"html_url"`
	State          string `json:"state"`
	Merged         bool   `json:"merged"`
	MergedAt       string `json:"merged_at"`
	Head           struct{ Ref string `json:"ref"` } `json:"head"`
	Base           struct{ Ref string `json:"ref"` } `json:"base"`
	User           gitHubUserPayload `json:"user"`
	MergeCommitSHA string            `json:"merge_commit_sha"`
}

type gitHubUserPayload struct {
	ID        any    `json:"id"`
	Login     string `json:"login"`
	HTMLURL   string `json:"html_url"`
	AvatarURL string `json:"avatar_url"`
}

type gitHubCommitPayload struct {
	ID        string `json:"id"`
	Message   string `json:"message"`
	URL       string `json:"url"`
	HTMLURL   string `json:"html_url"`
	Author    struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Username string `json:"username"`
	} `json:"author"`
	Committer struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Username string `json:"username"`
	} `json:"committer"`
}

type gitHubPullRequestEvent struct {
	RepositoryID       string
	RepositoryFullName string
	RepositoryURL      string
	PullRequestID      string
	PullRequestNumber  string
	Title              string
	Body               string
	URL                string
	HeadRef            string
	BaseRef            string
	State              string
	Action             string
	MergedAt           *time.Time
	Identifiers        []string
	ActorID            string
	ActorName          string
	ActorEmail         string
	ActorGitHubID      string
	ActorLogin         string
	DeliveryID         string
}

type gitHubCommitEvent struct {
	RepositoryID       string
	RepositoryFullName string
	RepositoryURL      string
	SHA                string
	Message            string
	URL                string
	Identifiers        []string
	ActorID            string
	ActorName          string
	ActorEmail         string
	ActorLogin         string
	DeliveryID         string
}

type gitHubIssueRecord struct {
	ID      string
	TeamID  string
	StateID string
}

var gitHubIdentifierPattern = regexp.MustCompile(`(?i)\b[A-Z][A-Z0-9]{1,9}-[0-9]+\b`)

// ── GitHub App types (new connect/register flow) ───────────────────────────

type githubConnectResponse struct {
	InstallationURL string `json:"installationUrl"`
	State           string `json:"state"`
	WorkspaceSlug   string `json:"workspaceSlug"`
}

type githubRegisterRequest struct {
	InstallationID      string             `json:"installationId"`
	Account             githubAccount      `json:"account"`
	RepositorySelection string             `json:"repositorySelection"`
	Repositories        []githubRepository `json:"repositories"`
	Permissions         map[string]string  `json:"permissions"`
	SetupAction         string             `json:"setupAction"`
	Metadata            map[string]any     `json:"metadata"`
}

type githubRegisterResponse struct {
	Connected      bool               `json:"connected"`
	IntegrationID  string             `json:"integrationId"`
	InstallationID string             `json:"installationId"`
	Account        githubAccount      `json:"account"`
	Repositories   []githubRepository `json:"repositories"`
}

type githubWebhookResponse struct {
	OK        bool    `json:"ok"`
	Duplicate bool    `json:"duplicate"`
	Ignored   *string `json:"ignored"`
}

type githubAccount struct {
	ID    string `json:"id"`
	Login string `json:"login"`
	Type  string `json:"type"`
}

type githubRepository struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	FullName string `json:"fullName"`
	Private  bool   `json:"private"`
	Active   bool   `json:"active"`
}

type githubInstallState struct {
	ID          string
	WorkspaceID string
	UserID      string
	Metadata    map[string]any
}

type githubResolvedInstall struct {
	WorkspaceID   string
	IntegrationID string
	Metadata      map[string]any
}

type githubConfig struct {
	AppID         string
	ClientID      string
	PrivateKey    string
	WebhookSecret string
	AppSlug       string
}

// ── Legacy setup handlers (manual webhook configuration) ───────────────────

func (h Handler) GitHubSetup(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	var input gitHubSetupRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "GitHub setup payload is invalid", err.Error())
		return
	}
	secret := strings.TrimSpace(input.WebhookSecret)
	var err error
	if secret == "" {
		secret, err = randomGitHubSecret()
		if err != nil {
			problem.Write(w, http.StatusInternalServerError, "Create GitHub webhook secret failed", err.Error())
			return
		}
	}
	integrationID, repos, err := h.saveGitHubIntegration(r.Context(), p.WorkspaceID, p.UserID, input, secret)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Save GitHub integration failed", err.Error())
		return
	}
	workflows, err := h.gitHubWorkflowMappings(r.Context(), p.WorkspaceID, integrationID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load GitHub workflows failed", err.Error())
		return
	}
	displayName := gitHubDisplayName(input)
	problem.JSON(w, http.StatusOK, gitHubSetupResponse{Connected: true, IntegrationID: integrationID, InstallationID: strings.TrimSpace(input.InstallationID), DisplayName: displayName, WebhookURL: gitHubWebhookURL(integrationID), WebhookSecret: secret, Repositories: repos, Workflows: workflows})
}

func (h Handler) GitHubStatus(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	row, _, err := h.gitHubIntegrationStatus(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.JSON(w, http.StatusOK, gitHubStatusResponse{Connected: false, Repositories: []gitHubRepositoryMapping{}, Workflows: []gitHubWorkflowMapping{}})
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load GitHub integration failed", err.Error())
		return
	}
	repos, err := h.gitHubRepositoryMappings(r.Context(), row.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load GitHub repositories failed", err.Error())
		return
	}
	workflows, err := h.gitHubWorkflowMappings(r.Context(), p.WorkspaceID, row.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load GitHub workflows failed", err.Error())
		return
	}
	webhookURL := gitHubWebhookURL(row.ID)
	problem.JSON(w, http.StatusOK, gitHubStatusResponse{Connected: row.Status == "connected" || row.Status == "degraded", IntegrationID: &row.ID, InstallationID: row.ExternalID, DisplayName: row.DisplayName, WebhookURL: &webhookURL, Repositories: repos, Workflows: workflows})
}

func (h Handler) GitHubWorkflow(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	row, _, err := h.gitHubIntegrationStatus(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusConflict, "Connect GitHub before configuring workflows", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load GitHub integration failed", err.Error())
		return
	}
	var input gitHubWorkflowRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "GitHub workflow payload is invalid", err.Error())
		return
	}
	if err := h.saveGitHubWorkflow(r.Context(), p.WorkspaceID, row.ID, p.UserID, input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Save GitHub workflow failed", err.Error())
		return
	}
	workflows, err := h.gitHubWorkflowMappings(r.Context(), p.WorkspaceID, row.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load GitHub workflows failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]any{"workflows": workflows})
}

// ── GitHub App handlers (new connect/register flow) ────────────────────────

func (h Handler) GitHubConnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	cfg, ok := loadGitHubConfig()
	if !ok || cfg.AppSlug == "" {
		problem.JSON(w, http.StatusPreconditionFailed, map[string]string{"error": "GitHub App is not configured", "message": "Add GITHUB_APP_ID, GITHUB_CLIENT_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET, and GITHUB_APP_SLUG to enable GitHub App installation."})
		return
	}
	state, err := randomState()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create GitHub installation failed", err.Error())
		return
	}
	workspaceSlug, err := h.workspaceSlug(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create GitHub installation failed", err.Error())
		return
	}
	if err := h.saveGitHubInstallState(r.Context(), p.WorkspaceID, p.UserID, state); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create GitHub installation failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, githubConnectResponse{InstallationURL: githubInstallationURL(cfg.AppSlug, state), State: state, WorkspaceSlug: workspaceSlug})
}

func (h Handler) GitHubSetupCallback(w http.ResponseWriter, r *http.Request) {
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	installationID := strings.TrimSpace(r.URL.Query().Get("installation_id"))
	setupAction := strings.TrimSpace(r.URL.Query().Get("setup_action"))
	if setupAction == "cancel" {
		http.Redirect(w, r, githubRedirectURL("canceled", ""), http.StatusFound)
		return
	}
	if state == "" || installationID == "" {
		problem.Write(w, http.StatusBadRequest, "GitHub App callback is missing state or installation_id", "")
		return
	}
	if _, ok := loadGitHubConfig(); !ok {
		problem.Write(w, http.StatusServiceUnavailable, "GitHub App is not configured", "")
		return
	}
	install, err := h.findGitHubInstallState(r.Context(), state)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusBadRequest, "Invalid GitHub installation state", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "GitHub App callback failed", err.Error())
		return
	}
	metadata := githubRegisterRequest{
		InstallationID:      installationID,
		RepositorySelection: "unknown",
		SetupAction:         setupAction,
		Account:             githubAccount{Login: "GitHub installation " + installationID, Type: "unknown"},
	}
	if _, err := h.completeGitHubInstall(r.Context(), install.WorkspaceID, install.UserID, install.ID, metadata); err != nil {
		problem.Write(w, http.StatusInternalServerError, "GitHub App callback failed", err.Error())
		return
	}
	http.Redirect(w, r, githubRedirectURL("connected", ""), http.StatusFound)
}

func (h Handler) GitHubRegister(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if _, ok := loadGitHubConfig(); !ok {
		problem.JSON(w, http.StatusPreconditionFailed, map[string]string{"error": "GitHub App is not configured", "message": "Add GITHUB_APP_ID, GITHUB_CLIENT_ID, GITHUB_PRIVATE_KEY, and GITHUB_WEBHOOK_SECRET to enable GitHub App registration."})
		return
	}
	var input githubRegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "GitHub registration payload is invalid", err.Error())
		return
	}
	input.InstallationID = strings.TrimSpace(input.InstallationID)
	input.RepositorySelection = normalizeGitHubRepositorySelection(input.RepositorySelection)
	if input.InstallationID == "" {
		problem.Write(w, http.StatusBadRequest, "GitHub installation ID is required", "")
		return
	}
	if input.RepositorySelection == "selected" && len(input.Repositories) == 0 {
		problem.Write(w, http.StatusBadRequest, "Selected GitHub repositories are required", "")
		return
	}
	integrationID, err := h.completeGitHubInstall(r.Context(), p.WorkspaceID, p.UserID, "", input)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Save GitHub integration failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, githubRegisterResponse{Connected: true, IntegrationID: integrationID, InstallationID: input.InstallationID, Account: input.Account, Repositories: activateGitHubRepositories(input.Repositories)})
}

func (h Handler) GitHubDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if err := h.revokeProvider(r.Context(), p.WorkspaceID, "github", p.UserID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect GitHub failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

// GitHubWebhook handles webhooks from the GitHub App (global, no integrationID path param).
func (h Handler) GitHubWebhook(w http.ResponseWriter, r *http.Request) {
	cfg, ok := loadGitHubConfig()
	secret := cfg.WebhookSecret
	if !ok || secret == "" {
		problem.Write(w, http.StatusServiceUnavailable, "GitHub webhook secret is not configured", "")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "GitHub webhook body could not be read", err.Error())
		return
	}
	if !verifyGitHubSignature(secret, r.Header.Get("X-Hub-Signature-256"), body) {
		problem.Write(w, http.StatusUnauthorized, "Invalid GitHub signature", "")
		return
	}
	deliveryID := strings.TrimSpace(r.Header.Get("X-GitHub-Delivery"))
	if deliveryID == "" {
		problem.Write(w, http.StatusBadRequest, "GitHub delivery id is required", "")
		return
	}
	eventType := strings.TrimSpace(r.Header.Get("X-GitHub-Event"))
	if eventType == "" {
		eventType = "unknown"
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		problem.Write(w, http.StatusBadRequest, "GitHub webhook payload is invalid", err.Error())
		return
	}
	installationID := githubInstallationID(payload)
	if installationID == "" {
		if duplicate, recordErr := h.recordIgnoredGitHubDelivery(r.Context(), deliveryID, eventType, "no_installation_context", body); recordErr != nil {
			problem.Write(w, http.StatusInternalServerError, "GitHub webhook delivery could not be recorded", recordErr.Error())
			return
		} else if duplicate {
			problem.JSON(w, http.StatusOK, githubWebhookResponse{OK: true, Duplicate: true})
			return
		}
		ignored := "no_installation_context"
		problem.JSON(w, http.StatusAccepted, githubWebhookResponse{OK: false, Ignored: &ignored})
		return
	}
	install, err := h.resolveGitHubInstall(r.Context(), installationID)
	if errors.Is(err, pgx.ErrNoRows) {
		if duplicate, recordErr := h.recordIgnoredGitHubDelivery(r.Context(), deliveryID, eventType, "unknown_installation", body); recordErr != nil {
			problem.Write(w, http.StatusInternalServerError, "GitHub webhook delivery could not be recorded", recordErr.Error())
			return
		} else if duplicate {
			problem.JSON(w, http.StatusOK, githubWebhookResponse{OK: true, Duplicate: true})
			return
		}
		ignored := "unknown_installation"
		problem.JSON(w, http.StatusAccepted, githubWebhookResponse{OK: false, Ignored: &ignored})
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "GitHub integration could not be resolved", err.Error())
		return
	}
	duplicate, ignoredReason, err := h.queueGitHubWebhook(r.Context(), install, deliveryID, eventType, payload, body)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "GitHub webhook could not be queued", err.Error())
		return
	}
	if duplicate {
		problem.JSON(w, http.StatusOK, githubWebhookResponse{OK: true, Duplicate: true})
		return
	}
	if ignoredReason != "" {
		problem.JSON(w, http.StatusAccepted, githubWebhookResponse{OK: false, Ignored: &ignoredReason})
		return
	}
	problem.JSON(w, http.StatusAccepted, githubWebhookResponse{OK: true})
}

// GitHubWebhookLegacy handles webhooks from the legacy per-integration webhook URL.
func (h Handler) GitHubWebhookLegacy(w http.ResponseWriter, r *http.Request) {
	integrationID := strings.TrimSpace(chi.URLParam(r, "integrationID"))
	if integrationID == "" {
		problem.Write(w, http.StatusBadRequest, "GitHub integration is required", "")
		return
	}
	install, err := h.resolveGitHubWebhookInstall(r.Context(), integrationID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "GitHub integration not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Resolve GitHub integration failed", err.Error())
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "GitHub webhook body could not be read", err.Error())
		return
	}
	if !verifyGitHubSignature(install.WebhookSecret, r.Header.Get("X-Hub-Signature-256"), body) {
		problem.Write(w, http.StatusUnauthorized, "Invalid GitHub webhook signature", "")
		return
	}
	var payload gitHubWebhookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		problem.Write(w, http.StatusBadRequest, "GitHub webhook payload is invalid", err.Error())
		return
	}
	processed, err := h.handleGitHubWebhook(r.Context(), install, r.Header.Get("X-GitHub-Event"), r.Header.Get("X-GitHub-Delivery"), payload)
	if err != nil {
		_ = h.recordGitHubEvent(r.Context(), install, "webhook_ingestion_failed", "error", err.Error(), map[string]any{"bodyHash": hashGitHubSecret(string(body))})
		problem.Write(w, http.StatusInternalServerError, "GitHub webhook could not be processed", err.Error())
		return
	}
	message := "GitHub webhook accepted."
	if processed == 0 {
		message = "GitHub webhook accepted with no linked exponential issues."
	}
	_ = h.recordGitHubEvent(r.Context(), install, "webhook_ingested", "info", message, map[string]any{"processedIssueCount": processed, "event": r.Header.Get("X-GitHub-Event"), "deliveryId": r.Header.Get("X-GitHub-Delivery")})
	problem.JSON(w, http.StatusAccepted, map[string]any{"ok": true, "processedIssueCount": processed})
}

// ── Legacy setup DB helpers ────────────────────────────────────────────────

func (h Handler) saveGitHubIntegration(ctx context.Context, workspaceID, userID string, input gitHubSetupRequest, webhookSecret string) (string, []gitHubRepositoryMapping, error) {
	installationID := strings.TrimSpace(input.InstallationID)
	if installationID == "" {
		return "", nil, fmt.Errorf("installationId is required")
	}
	accountLogin := strings.TrimSpace(input.AccountLogin)
	if accountLogin == "" {
		return "", nil, fmt.Errorf("accountLogin is required")
	}
	repos := normalizeGitHubRepositoryInputs(input.Repositories)
	if len(repos) == 0 {
		return "", nil, fmt.Errorf("at least one repository is required")
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return "", nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	now := time.Now().UTC()
	metadata := map[string]any{"accountLogin": accountLogin, "accountType": strings.TrimSpace(input.AccountType), "branchNameFormat": firstNonEmpty(strings.TrimSpace(input.BranchNameFormat), "{identifier}-{title}"), "configuredBy": userID}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return "", nil, err
	}
	var integrationID string
	if err := tx.QueryRow(ctx, `
		insert into workspace_integration (workspace_id, provider, status, external_id, display_name, metadata, connected_by_user_id, connected_at, last_event_at, last_success_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'github', 'connected', $2, $3, $4::jsonb, $5, $6, $6, $6, null, null, null, $6)
		on conflict (workspace_id, provider) do update set
			status='connected', external_id=excluded.external_id, display_name=excluded.display_name, metadata=excluded.metadata,
			connected_by_user_id=excluded.connected_by_user_id, connected_at=coalesce(workspace_integration.connected_at, excluded.connected_at),
			last_event_at=excluded.last_event_at, last_success_at=excluded.last_success_at, last_failure_at=null, last_failure_message=null,
			credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=excluded.updated_at
		returning id::text`, workspaceID, installationID, gitHubDisplayName(input), metadataRaw, userID, now).Scan(&integrationID); err != nil {
		return "", nil, err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at, $2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, integrationID, now); err != nil {
		return "", nil, err
	}
	credentialRaw, err := json.Marshal(gitHubCredential{WebhookSecret: webhookSecret})
	if err != nil {
		return "", nil, err
	}
	if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid, 'github', $2, $3::jsonb, $4, $5, $5)`, integrationID, credentialRaw, metadataRaw, userID, now); err != nil {
		return "", nil, err
	}
	if _, err := tx.Exec(ctx, `update github_repository_mapping set enabled=false, updated_at=$2 where workspace_integration_id=$1::uuid`, integrationID, now); err != nil {
		return "", nil, err
	}
	out := make([]gitHubRepositoryMapping, 0, len(repos))
	for _, repo := range repos {
		if _, err := tx.Exec(ctx, `
			insert into github_repository_mapping (workspace_integration_id, repository_id, owner, name, full_name, html_url, enabled, updated_at)
			values ($1::uuid, $2, $3, $4, $5, $6, true, $7)
			on conflict (workspace_integration_id, repository_id) do update set owner=excluded.owner, name=excluded.name, full_name=excluded.full_name, html_url=excluded.html_url, enabled=true, updated_at=excluded.updated_at`, integrationID, repo.ID, repo.Owner, repo.Name, repo.FullName, repo.HTMLURL, now); err != nil {
			return "", nil, err
		}
		out = append(out, gitHubRepositoryMapping{ID: repo.ID, Owner: repo.Owner, Name: repo.Name, FullName: repo.FullName, HTMLURL: stringPtr(repo.HTMLURL), Enabled: true})
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid, $2::uuid, 'github', 'installation_configured', 'info', 'GitHub installation connected.', $3::jsonb, $4)`, workspaceID, integrationID, metadataRaw, now); err != nil {
		return "", nil, err
	}
	return integrationID, out, tx.Commit(ctx)
}

func (h Handler) gitHubIntegrationStatus(ctx context.Context, workspaceID string) (row, gitHubCredential, error) {
	var r row
	var credentialRaw []byte
	err := h.DB.QueryRow(ctx, `
		select wi.id::text, wi.provider, wi.status, wi.display_name, wi.external_id, wi.connected_at, wi.last_event_at, wi.last_success_at, wi.last_failure_at, wi.last_failure_message, wi.token_expires_at, coalesce(pc.encrypted_payload,'{}'::bytea)
		from workspace_integration wi
		left join provider_credential pc on pc.workspace_integration_id=wi.id and pc.provider='github' and pc.active
		where wi.workspace_id=$1::uuid and wi.provider='github'
		limit 1`, workspaceID).Scan(&r.ID, &r.Provider, &r.Status, &r.DisplayName, &r.ExternalID, &r.ConnectedAt, &r.LastEventAt, &r.LastSuccessAt, &r.LastFailureAt, &r.LastFailureMessage, &r.TokenExpiresAt, &credentialRaw)
	if err != nil {
		return row{}, gitHubCredential{}, err
	}
	var credential gitHubCredential
	_ = json.Unmarshal(credentialRaw, &credential)
	return r, credential, nil
}

func (h Handler) resolveGitHubWebhookInstall(ctx context.Context, integrationID string) (gitHubInstall, error) {
	var install gitHubInstall
	var credentialRaw, metadataRaw []byte
	err := h.DB.QueryRow(ctx, `
		select wi.workspace_id::text, wi.id::text, coalesce(wi.external_id,''), coalesce(wi.metadata,'{}'::jsonb), pc.encrypted_payload
		from workspace_integration wi
		join provider_credential pc on pc.workspace_integration_id=wi.id and pc.provider='github' and pc.active
		where wi.id=$1::uuid and wi.provider='github' and wi.status in ('connected','degraded')
		limit 1`, integrationID).Scan(&install.WorkspaceID, &install.IntegrationID, &install.InstallationID, &metadataRaw, &credentialRaw)
	if err != nil {
		return install, err
	}
	var credential gitHubCredential
	_ = json.Unmarshal(credentialRaw, &credential)
	install.WebhookSecret = credential.WebhookSecret
	var metadata map[string]any
	_ = json.Unmarshal(metadataRaw, &metadata)
	install.BranchNameFormat = firstNonEmpty(stringValue(metadata["branchNameFormat"]), "{identifier}-{title}")
	return install, nil
}

func (h Handler) gitHubRepositoryMappings(ctx context.Context, integrationID string) ([]gitHubRepositoryMapping, error) {
	rows, err := h.DB.Query(ctx, `select repository_id, owner, name, full_name, html_url, team_id::text, enabled from github_repository_mapping where workspace_integration_id=$1::uuid order by full_name asc`, integrationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []gitHubRepositoryMapping{}
	for rows.Next() {
		var mapping gitHubRepositoryMapping
		if err := rows.Scan(&mapping.ID, &mapping.Owner, &mapping.Name, &mapping.FullName, &mapping.HTMLURL, &mapping.TeamID, &mapping.Enabled); err != nil {
			return nil, err
		}
		out = append(out, mapping)
	}
	return out, rows.Err()
}

func (h Handler) gitHubWorkflowMappings(ctx context.Context, workspaceID, integrationID string) ([]gitHubWorkflowMapping, error) {
	rows, err := h.DB.Query(ctx, `
		select t.id::text, t.key, t.name, gwa.pull_request_merged_state_id::text
		from team t
		left join github_workflow_automation gwa on gwa.team_id=t.id and gwa.workspace_integration_id=$2::uuid
		where t.workspace_id=$1::uuid and t.deleted_at is null and t.retired_at is null
		order by t.key asc`, workspaceID, integrationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []gitHubWorkflowMapping{}
	for rows.Next() {
		var mapping gitHubWorkflowMapping
		if err := rows.Scan(&mapping.TeamID, &mapping.TeamKey, &mapping.TeamName, &mapping.PullRequestMergedStateID); err != nil {
			return nil, err
		}
		out = append(out, mapping)
	}
	return out, rows.Err()
}

func (h Handler) saveGitHubWorkflow(ctx context.Context, workspaceID, integrationID, userID string, input gitHubWorkflowRequest) error {
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
	if input.PullRequestMergedStateID != nil {
		stateID = strings.TrimSpace(*input.PullRequestMergedStateID)
	}
	if stateID == "" {
		_, err := h.DB.Exec(ctx, `delete from github_workflow_automation where workspace_integration_id=$1::uuid and team_id=$2::uuid`, integrationID, teamID)
		return err
	}
	if err := h.DB.QueryRow(ctx, `select exists(select 1 from workflow_state where id=$1::uuid and team_id=$2::uuid)`, stateID, teamID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("pullRequestMergedStateId is not a workflow state for the selected team")
	}
	_, err := h.DB.Exec(ctx, `
		insert into github_workflow_automation (workspace_integration_id, team_id, pull_request_merged_state_id, updated_by_user_id, updated_at)
		values ($1::uuid, $2::uuid, $3::uuid, $4, now())
		on conflict (team_id) do update set workspace_integration_id=excluded.workspace_integration_id, pull_request_merged_state_id=excluded.pull_request_merged_state_id, updated_by_user_id=excluded.updated_by_user_id, updated_at=now()`, integrationID, teamID, stateID, userID)
	return err
}

// ── PR/commit webhook processing (WIP feature) ────────────────────────────

func (h Handler) handleGitHubWebhook(ctx context.Context, install gitHubInstall, eventName string, deliveryID string, payload gitHubWebhookPayload) (int, error) {
	if !gitHubInstallationMatches(install.InstallationID, payload.Installation) {
		return 0, nil
	}
	mapped, err := h.gitHubRepositoryIsMapped(ctx, install.IntegrationID, gitHubAnyID(payload.Repository.ID))
	if err != nil {
		return 0, err
	}
	if !mapped {
		return 0, nil
	}
	switch strings.ToLower(strings.TrimSpace(eventName)) {
	case "pull_request":
		event, ok := gitHubPullRequestEventFromPayload(payload, deliveryID)
		if !ok {
			return 0, nil
		}
		return h.handleGitHubPullRequestEvent(ctx, install, event)
	case "push":
		events := gitHubCommitEventsFromPayload(payload, deliveryID)
		return h.handleGitHubCommitEvents(ctx, install, events)
	default:
		return 0, nil
	}
}

func (h Handler) gitHubRepositoryIsMapped(ctx context.Context, integrationID, repositoryID string) (bool, error) {
	if repositoryID == "" {
		return false, nil
	}
	var mapped bool
	err := h.DB.QueryRow(ctx, `select exists(select 1 from github_repository_mapping where workspace_integration_id=$1::uuid and repository_id=$2 and enabled)`, integrationID, repositoryID).Scan(&mapped)
	return mapped, err
}

func (h Handler) handleGitHubPullRequestEvent(ctx context.Context, install gitHubInstall, event gitHubPullRequestEvent) (int, error) {
	issues, err := h.gitHubIssuesForIdentifiers(ctx, install.WorkspaceID, event.Identifiers)
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
		changed, err := upsertGitHubPullRequestLink(ctx, tx, install, issue.ID, event)
		if err != nil {
			return 0, err
		}
		if changed {
			if event.ActorID == "" {
				event.ActorID = gitHubActorIDByProvider(ctx, tx, install.WorkspaceID, event.ActorGitHubID)
			}
			if err := insertGitHubPullRequestHistory(ctx, tx, issue.ID, event); err != nil {
				return 0, err
			}
			if event.Action == "merged" {
				if err := applyGitHubMergedWorkflow(ctx, tx, install, issue, event); err != nil {
					return 0, err
				}
			}
		}
		processed++
	}
	return processed, tx.Commit(ctx)
}

func (h Handler) handleGitHubCommitEvents(ctx context.Context, install gitHubInstall, events []gitHubCommitEvent) (int, error) {
	processed := 0
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, event := range events {
		issues, err := h.gitHubIssuesForIdentifiers(ctx, install.WorkspaceID, event.Identifiers)
		if err != nil {
			return 0, err
		}
		for _, identifier := range event.Identifiers {
			issue, ok := issues[identifier]
			if !ok {
				continue
			}
			changed, err := upsertGitHubCommitLink(ctx, tx, install, issue.ID, event)
			if err != nil {
				return 0, err
			}
			if changed {
				if err := insertGitHubCommitHistory(ctx, tx, issue.ID, event); err != nil {
					return 0, err
				}
			}
			processed++
		}
	}
	return processed, tx.Commit(ctx)
}

func gitHubPullRequestEventFromPayload(payload gitHubWebhookPayload, deliveryID string) (gitHubPullRequestEvent, bool) {
	action := normalizeGitHubPullRequestAction(payload.Action, payload.PullRequest.State, payload.PullRequest.Merged)
	if action == "" || payload.PullRequest.Number == 0 {
		return gitHubPullRequestEvent{}, false
	}
	texts := []string{payload.PullRequest.Title, payload.PullRequest.Body, payload.PullRequest.Head.Ref, payload.PullRequest.Base.Ref}
	identifiers := extractGitHubIssueIdentifiers(texts...)
	repositoryID := gitHubAnyID(payload.Repository.ID)
	prID := gitHubAnyID(payload.PullRequest.ID)
	if repositoryID == "" || prID == "" {
		return gitHubPullRequestEvent{}, false
	}
	var mergedAt *time.Time
	if parsed, err := time.Parse(time.RFC3339, payload.PullRequest.MergedAt); err == nil {
		mergedAt = &parsed
	}
	actorGitHubID := gitHubAnyID(payload.PullRequest.User.ID)
	actorLogin := firstNonEmpty(payload.PullRequest.User.Login, payload.Sender.Login)
	return gitHubPullRequestEvent{RepositoryID: repositoryID, RepositoryFullName: payload.Repository.FullName, RepositoryURL: payload.Repository.HTMLURL, PullRequestID: prID, PullRequestNumber: strconv.Itoa(payload.PullRequest.Number), Title: payload.PullRequest.Title, Body: payload.PullRequest.Body, URL: payload.PullRequest.HTMLURL, HeadRef: payload.PullRequest.Head.Ref, BaseRef: payload.PullRequest.Base.Ref, State: payload.PullRequest.State, Action: action, MergedAt: mergedAt, Identifiers: identifiers, ActorName: actorLogin, ActorGitHubID: actorGitHubID, ActorLogin: actorLogin, DeliveryID: deliveryID}, true
}

func gitHubCommitEventsFromPayload(payload gitHubWebhookPayload, deliveryID string) []gitHubCommitEvent {
	repositoryID := gitHubAnyID(payload.Repository.ID)
	if repositoryID == "" {
		return nil
	}
	commits := payload.Commits
	if len(commits) == 0 && payload.HeadCommit != nil {
		commits = []gitHubCommitPayload{*payload.HeadCommit}
	}
	out := []gitHubCommitEvent{}
	for _, commit := range commits {
		sha := firstNonEmpty(commit.ID)
		if sha == "" {
			continue
		}
		identifiers := extractGitHubIssueIdentifiers(commit.Message)
		actorName := firstNonEmpty(commit.Author.Name, commit.Author.Username, commit.Committer.Name, commit.Committer.Username, payload.Sender.Login)
		actorEmail := firstNonEmpty(commit.Author.Email, commit.Committer.Email)
		actorLogin := firstNonEmpty(commit.Author.Username, commit.Committer.Username, payload.Sender.Login)
		out = append(out, gitHubCommitEvent{RepositoryID: repositoryID, RepositoryFullName: payload.Repository.FullName, RepositoryURL: payload.Repository.HTMLURL, SHA: sha, Message: commit.Message, URL: firstNonEmpty(commit.HTMLURL, commit.URL), Identifiers: identifiers, ActorName: actorName, ActorEmail: actorEmail, ActorLogin: actorLogin, DeliveryID: deliveryID})
	}
	return out
}

func normalizeGitHubPullRequestAction(action string, state string, merged bool) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "opened", "reopened", "synchronize", "edited", "ready_for_review", "review_requested", "review_request_removed", "labeled", "unlabeled":
		if strings.EqualFold(action, "synchronize") {
			return "updated"
		}
		if strings.EqualFold(action, "edited") {
			return "updated"
		}
		return strings.ToLower(strings.TrimSpace(action))
	case "closed":
		if merged || strings.EqualFold(strings.TrimSpace(state), "merged") {
			return "merged"
		}
		return "closed"
	}
	return ""
}

func extractGitHubIssueIdentifiers(values ...string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		for _, match := range gitHubIdentifierPattern.FindAllString(value, -1) {
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

func (h Handler) gitHubIssuesForIdentifiers(ctx context.Context, workspaceID string, identifiers []string) (map[string]gitHubIssueRecord, error) {
	out := map[string]gitHubIssueRecord{}
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
		var issue gitHubIssueRecord
		if err := rows.Scan(&identifier, &issue.ID, &issue.TeamID, &issue.StateID); err != nil {
			return nil, err
		}
		out[identifier] = issue
	}
	return out, rows.Err()
}

func upsertGitHubPullRequestLink(ctx context.Context, tx pgx.Tx, install gitHubInstall, issueID string, event gitHubPullRequestEvent) (bool, error) {
	eventKey := event.gitHubEventKey()
	var previousEventKey string
	err := tx.QueryRow(ctx, `select coalesce(last_event_key,'') from github_pull_request_link where workspace_integration_id=$1::uuid and issue_id=$2::uuid and repository_id=$3 and pull_request_number=$4 limit 1 for update`, install.IntegrationID, issueID, event.RepositoryID, event.PullRequestNumber).Scan(&previousEventKey)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx, `insert into github_pull_request_link (workspace_id, workspace_integration_id, issue_id, repository_id, repository_full_name, repository_url, pull_request_number, pull_request_id, title, url, head_ref, base_ref, state, last_action, last_event_key, merged_at, updated_at) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())`, install.WorkspaceID, install.IntegrationID, issueID, event.RepositoryID, event.RepositoryFullName, event.RepositoryURL, event.PullRequestNumber, event.PullRequestID, event.Title, event.URL, event.HeadRef, event.BaseRef, event.State, event.Action, eventKey, event.MergedAt)
		return true, err
	}
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `update github_pull_request_link set repository_full_name=$5, repository_url=$6, pull_request_id=$7, title=$8, url=$9, head_ref=$10, base_ref=$11, state=$12, last_action=$13, last_event_key=$14, merged_at=coalesce($15, merged_at), updated_at=now() where workspace_integration_id=$1::uuid and issue_id=$2::uuid and repository_id=$3 and pull_request_number=$4`, install.IntegrationID, issueID, event.RepositoryID, event.PullRequestNumber, event.RepositoryFullName, event.RepositoryURL, event.PullRequestID, event.Title, event.URL, event.HeadRef, event.BaseRef, event.State, event.Action, eventKey, event.MergedAt)
	return previousEventKey != eventKey, err
}

func upsertGitHubCommitLink(ctx context.Context, tx pgx.Tx, install gitHubInstall, issueID string, event gitHubCommitEvent) (bool, error) {
	eventKey := event.gitHubEventKey()
	var previousEventKey string
	err := tx.QueryRow(ctx, `select coalesce(last_event_key,'') from github_commit_link where workspace_integration_id=$1::uuid and issue_id=$2::uuid and repository_id=$3 and sha=$4 limit 1 for update`, install.IntegrationID, issueID, event.RepositoryID, event.SHA).Scan(&previousEventKey)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx, `insert into github_commit_link (workspace_id, workspace_integration_id, issue_id, repository_id, repository_full_name, repository_url, sha, message, url, author_name, author_email, last_event_key, updated_at) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())`, install.WorkspaceID, install.IntegrationID, issueID, event.RepositoryID, event.RepositoryFullName, event.RepositoryURL, event.SHA, event.Message, event.URL, nullString(event.ActorName), nullString(event.ActorEmail), eventKey)
		return true, err
	}
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(ctx, `update github_commit_link set repository_full_name=$5, repository_url=$6, message=$7, url=$8, author_name=$9, author_email=$10, last_event_key=$11, updated_at=now() where workspace_integration_id=$1::uuid and issue_id=$2::uuid and repository_id=$3 and sha=$4`, install.IntegrationID, issueID, event.RepositoryID, event.SHA, event.RepositoryFullName, event.RepositoryURL, event.Message, event.URL, nullString(event.ActorName), nullString(event.ActorEmail), eventKey)
	return previousEventKey != eventKey, err
}

func insertGitHubPullRequestHistory(ctx context.Context, tx pgx.Tx, issueID string, event gitHubPullRequestEvent) error {
	metadata := gitHubPullRequestHistoryMetadata(event)
	raw, _ := json.Marshal(metadata)
	_, err := tx.Exec(ctx, `insert into issue_history (issue_id, actor_id, actor_name, actor_email, event_type, metadata) values ($1::uuid, $2, $3, $4, 'github_pull_request', $5::jsonb)`, issueID, nullString(event.ActorID), nullString(event.ActorName), nullString(event.ActorEmail), raw)
	return err
}

func insertGitHubCommitHistory(ctx context.Context, tx pgx.Tx, issueID string, event gitHubCommitEvent) error {
	metadata := gitHubCommitHistoryMetadata(event)
	raw, _ := json.Marshal(metadata)
	_, err := tx.Exec(ctx, `insert into issue_history (issue_id, actor_id, actor_name, actor_email, event_type, metadata) values ($1::uuid, $2, $3, $4, 'github_commit', $5::jsonb)`, issueID, nullString(event.ActorID), nullString(event.ActorName), nullString(event.ActorEmail), raw)
	return err
}

func applyGitHubMergedWorkflow(ctx context.Context, tx pgx.Tx, install gitHubInstall, issue gitHubIssueRecord, event gitHubPullRequestEvent) error {
	var stateID, category string
	err := tx.QueryRow(ctx, `select ws.id::text, ws.category::text from github_workflow_automation gwa join workflow_state ws on ws.id=gwa.pull_request_merged_state_id and ws.team_id=gwa.team_id where gwa.workspace_integration_id=$1::uuid and gwa.team_id=$2::uuid limit 1`, install.IntegrationID, issue.TeamID).Scan(&stateID, &category)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if stateID == issue.StateID {
		return nil
	}
	var completedAt, canceledAt *time.Time
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
	metadata := gitHubPullRequestHistoryMetadata(event)
	metadata["source"] = "github_workflow_automation"
	metadata["changedFields"] = []string{"stateId"}
	metadata["fromStateId"] = issue.StateID
	metadata["toStateId"] = stateID
	raw, _ := json.Marshal(metadata)
	_, err = tx.Exec(ctx, `insert into issue_history (issue_id, actor_id, actor_name, actor_email, event_type, metadata) values ($1::uuid, $2, $3, $4, 'updated', $5::jsonb)`, issue.ID, nullString(event.ActorID), nullString(event.ActorName), nullString(event.ActorEmail), raw)
	return err
}

func (event gitHubPullRequestEvent) gitHubEventKey() string {
	return event.RepositoryID + ":" + event.PullRequestNumber + ":" + event.Action + ":" + event.DeliveryID
}
func (event gitHubCommitEvent) gitHubEventKey() string {
	return event.RepositoryID + ":" + event.SHA + ":" + event.DeliveryID
}

func gitHubPullRequestHistoryMetadata(event gitHubPullRequestEvent) map[string]any {
	return map[string]any{"source": "github_pull_request", "provider": "github", "action": event.Action, "github": map[string]any{"repositoryId": event.RepositoryID, "repositoryFullName": event.RepositoryFullName, "repositoryUrl": event.RepositoryURL, "pullRequestId": event.PullRequestID, "pullRequestNumber": event.PullRequestNumber, "title": event.Title, "url": event.URL, "state": event.State, "headRef": event.HeadRef, "baseRef": event.BaseRef, "actorLogin": event.ActorLogin}}
}

func gitHubCommitHistoryMetadata(event gitHubCommitEvent) map[string]any {
	return map[string]any{"source": "github_commit", "provider": "github", "action": "linked", "github": map[string]any{"repositoryId": event.RepositoryID, "repositoryFullName": event.RepositoryFullName, "repositoryUrl": event.RepositoryURL, "sha": event.SHA, "message": event.Message, "url": event.URL, "actorLogin": event.ActorLogin}}
}

func gitHubActorIDByProvider(ctx context.Context, tx pgx.Tx, workspaceID string, accountID string) string {
	if accountID == "" {
		return ""
	}
	var userID string
	_ = tx.QueryRow(ctx, `select a.user_id from account a join member m on m.user_id=a.user_id and m.workspace_id=$1::uuid where a.provider_id='github' and a.account_id=$2 limit 1`, workspaceID, accountID).Scan(&userID)
	return userID
}


func (h Handler) recordGitHubEvent(ctx context.Context, install gitHubInstall, eventType, severity, message string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'github',$3,$4,$5,$6::jsonb)`, install.WorkspaceID, install.IntegrationID, eventType, severity, message, raw)
	return err
}

// ── GitHub App DB helpers ──────────────────────────────────────────────────

func (h Handler) saveGitHubInstallState(ctx context.Context, workspaceID string, userID string, state string) error {
	now := time.Now().UTC()
	metadata := map[string]any{
		"installStateHash":      hashSlackSecret(state),
		"installStateExpiresAt": now.Add(10 * time.Minute).Format(time.RFC3339Nano),
		"installStartedAt":      now.Format(time.RFC3339Nano),
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into workspace_integration (workspace_id, provider, status, metadata, connected_by_user_id, connected_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'github', 'installing', $2::jsonb, $3, null, null, null, null, now())
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

func (h Handler) findGitHubInstallState(ctx context.Context, state string) (githubInstallState, error) {
	rows, err := h.DB.Query(ctx, `
		select id::text, workspace_id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb)
		from workspace_integration
		where provider='github' and status='installing'`)
	if err != nil {
		return githubInstallState{}, err
	}
	defer rows.Close()
	stateHash := hashSlackSecret(state)
	for rows.Next() {
		var install githubInstallState
		var metadataRaw []byte
		if err := rows.Scan(&install.ID, &install.WorkspaceID, &install.UserID, &metadataRaw); err != nil {
			return githubInstallState{}, err
		}
		install.Metadata = map[string]any{}
		_ = json.Unmarshal(metadataRaw, &install.Metadata)
		if stringValue(install.Metadata["installStateHash"]) != stateHash {
			continue
		}
		expiresAt, _ := time.Parse(time.RFC3339Nano, stringValue(install.Metadata["installStateExpiresAt"]))
		if expiresAt.IsZero() || expiresAt.Before(time.Now().UTC()) {
			return githubInstallState{}, pgx.ErrNoRows
		}
		return install, nil
	}
	if err := rows.Err(); err != nil {
		return githubInstallState{}, err
	}
	return githubInstallState{}, pgx.ErrNoRows
}

func (h Handler) completeGitHubInstall(ctx context.Context, workspaceID string, userID string, existingIntegrationID string, input githubRegisterRequest) (string, error) {
	now := time.Now().UTC()
	repositories := activateGitHubRepositories(input.Repositories)
	selection := normalizeGitHubRepositorySelection(input.RepositorySelection)
	account := normalizeGitHubAccount(input.Account)
	displayName := account.Login
	if displayName == "" {
		displayName = "GitHub installation " + input.InstallationID
	}
	metadata := map[string]any{
		"installationId":       input.InstallationID,
		"account":              account,
		"repositorySelection":  selection,
		"selectedRepositories": repositories,
		"permissions":          input.Permissions,
		"installedBy":          userID,
	}
	if input.SetupAction != "" {
		metadata["setupAction"] = input.SetupAction
	}
	for key, value := range input.Metadata {
		if !githubMetadataKeyAllowed(key) {
			continue
		}
		metadata[key] = value
	}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return "", err
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var integrationID string
	if existingIntegrationID != "" {
		if _, err := tx.Exec(ctx, `
			update workspace_integration
			set status='connected', external_id=$2, display_name=$3, metadata=$4::jsonb, connected_by_user_id=$5, connected_at=coalesce(connected_at, $6), last_event_at=$6, last_success_at=$6, last_failure_at=null, last_failure_message=null, token_expires_at=null, credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=$6
			where id=$1::uuid`, existingIntegrationID, input.InstallationID, displayName, metadataRaw, userID, now); err != nil {
			return "", err
		}
		integrationID = existingIntegrationID
	} else {
		if err := tx.QueryRow(ctx, `
			insert into workspace_integration (workspace_id, provider, status, external_id, display_name, metadata, connected_by_user_id, connected_at, last_event_at, last_success_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
			values ($1::uuid, 'github', 'connected', $2, $3, $4::jsonb, $5, $6, $6, $6, null, null, null, $6)
			on conflict (workspace_id, provider) do update set
				status='connected', external_id=excluded.external_id, display_name=excluded.display_name, metadata=excluded.metadata, connected_by_user_id=excluded.connected_by_user_id, connected_at=coalesce(workspace_integration.connected_at, excluded.connected_at), last_event_at=excluded.last_event_at, last_success_at=excluded.last_success_at, last_failure_at=null, last_failure_message=null, token_expires_at=null, credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=excluded.updated_at
			returning id::text`, workspaceID, input.InstallationID, displayName, metadataRaw, userID, now).Scan(&integrationID); err != nil {
			return "", err
		}
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at, $2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, integrationID, now); err != nil {
		return "", err
	}
	credential := map[string]any{"installationId": input.InstallationID, "appId": strings.TrimSpace(os.Getenv("GITHUB_APP_ID"))}
	credentialRaw, err := json.Marshal(credential)
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at)
		values ($1::uuid, 'github', $2, $3::jsonb, $4, $5, $5)`, integrationID, credentialRaw, metadataRaw, userID, now); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at)
		values ($1::uuid, $2::uuid, 'github', 'app_installation_connected', 'info', 'GitHub App installation connected.', $3::jsonb, $4)`, workspaceID, integrationID, metadataRaw, now); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return integrationID, nil
}

func (h Handler) resolveGitHubInstall(ctx context.Context, installationID string) (githubResolvedInstall, error) {
	var install githubResolvedInstall
	var metadataRaw []byte
	err := h.DB.QueryRow(ctx, `
		select workspace_id::text, id::text, coalesce(metadata,'{}'::jsonb)
		from workspace_integration
		where provider='github' and external_id=$1 and status in ('connected','degraded')
		limit 1`, installationID).Scan(&install.WorkspaceID, &install.IntegrationID, &metadataRaw)
	if err != nil {
		return githubResolvedInstall{}, err
	}
	install.Metadata = map[string]any{}
	_ = json.Unmarshal(metadataRaw, &install.Metadata)
	return install, nil
}

func (h Handler) recordIgnoredGitHubDelivery(ctx context.Context, deliveryID string, eventType string, reason string, body []byte) (bool, error) {
	payloadRaw := githubDeliveryPayload(eventType, deliveryID, reason, nil, body)
	var id string
	err := h.DB.QueryRow(ctx, `
		insert into provider_webhook_delivery (provider, delivery_id, event_type, status, payload)
		values ('github', $1, $2, 'ignored', $3::jsonb)
		on conflict (provider, delivery_id) do nothing
		returning id::text`, deliveryID, eventType, payloadRaw).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	return false, err
}

func (h Handler) queueGitHubWebhook(ctx context.Context, install githubResolvedInstall, deliveryID string, eventType string, payload map[string]any, body []byte) (bool, string, error) {
	now := time.Now().UTC()
	payloadRaw := githubDeliveryPayload(eventType, deliveryID, "", payload, body)
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return false, "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var deliveryRowID string
	err = tx.QueryRow(ctx, `
		insert into provider_webhook_delivery (provider, delivery_id, workspace_id, workspace_integration_id, event_type, status, payload, created_at)
		values ('github', $1, $2::uuid, $3::uuid, $4, 'accepted', $5::jsonb, $6)
		on conflict (provider, delivery_id) do nothing
		returning id::text`, deliveryID, install.WorkspaceID, install.IntegrationID, eventType, payloadRaw, now).Scan(&deliveryRowID)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, "", nil
	}
	if err != nil {
		return false, "", err
	}
	if !githubRepositoryMappingActive(install.Metadata, payload) {
		if _, err := tx.Exec(ctx, `update provider_webhook_delivery set status='ignored' where id=$1::uuid`, deliveryRowID); err != nil {
			return false, "", err
		}
		if _, err := tx.Exec(ctx, `update workspace_integration set last_event_at=$2, last_failure_at=$2, last_failure_message='GitHub webhook repository is not active for this workspace.', updated_at=$2 where id=$1::uuid`, install.IntegrationID, now); err != nil {
			return false, "", err
		}
		if _, err := tx.Exec(ctx, `
			insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at)
			values ($1::uuid, $2::uuid, 'github', 'webhook_repository_inactive', 'warning', 'GitHub webhook ignored because repository mapping is inactive.', $3::jsonb, $4)`, install.WorkspaceID, install.IntegrationID, payloadRaw, now); err != nil {
			return false, "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return false, "", err
		}
		return false, "inactive_repository_mapping", nil
	}
	var jobID string
	if err := tx.QueryRow(ctx, `
		insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at)
		values ($1::uuid, $2::uuid, 'github', 'webhook_ingestion', 'queued', $3::jsonb, $4, $4)
		returning id::text`, install.WorkspaceID, install.IntegrationID, payloadRaw, now).Scan(&jobID); err != nil {
		return false, "", err
	}
	if _, err := tx.Exec(ctx, `update workspace_integration set last_event_at=$2, last_success_at=$2, last_failure_at=null, last_failure_message=null, updated_at=$2 where id=$1::uuid`, install.IntegrationID, now); err != nil {
		return false, "", err
	}
	if _, err := tx.Exec(ctx, `
		insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at)
		values ($1::uuid, $2::uuid, 'github', $3::uuid, 'webhook_accepted', 'info', 'GitHub webhook accepted and queued.', $4::jsonb, $5)`, install.WorkspaceID, install.IntegrationID, jobID, payloadRaw, now); err != nil {
		return false, "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, "", err
	}
	return false, "", nil
}

func loadGitHubConfig() (githubConfig, bool) {
	cfg := githubConfig{
		AppID:         strings.TrimSpace(os.Getenv("GITHUB_APP_ID")),
		ClientID:      strings.TrimSpace(os.Getenv("GITHUB_CLIENT_ID")),
		PrivateKey:    firstNonEmptyEnv("GITHUB_PRIVATE_KEY", "GITHUB_APP_PRIVATE_KEY"),
		WebhookSecret: strings.TrimSpace(os.Getenv("GITHUB_WEBHOOK_SECRET")),
		AppSlug:       firstNonEmptyEnv("GITHUB_APP_SLUG", "GITHUB_APP_NAME"),
	}
	return cfg, cfg.AppID != "" && cfg.ClientID != "" && cfg.PrivateKey != "" && cfg.WebhookSecret != ""
}

func firstNonEmptyEnv(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func githubInstallationURL(appSlug string, state string) string {
	values := url.Values{}
	values.Set("state", state)
	return "https://github.com/apps/" + url.PathEscape(appSlug) + "/installations/new?" + values.Encode()
}

func githubRedirectURL(status string, message string) string {
	values := url.Values{}
	values.Set("github", status)
	if strings.TrimSpace(message) != "" {
		values.Set("message", message)
	}
	return strings.TrimRight(configuredAppURL(), "/") + "/settings/integrations?" + values.Encode()
}

func verifyGitHubSignature(secret string, signature string, body []byte) bool {
	if secret == "" || signature == "" || !strings.HasPrefix(signature, "sha256=") {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func githubTestSignature(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func hashGitHubSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func gitHubWebhookURL(integrationID string) string {
	return strings.TrimRight(configuredAppURL(), "/") + "/api/integrations/github/webhook/" + integrationID
}

func gitHubDisplayName(input gitHubSetupRequest) string {
	account := strings.TrimSpace(input.AccountLogin)
	if account == "" {
		return "GitHub"
	}
	return account
}

func normalizeGitHubRepositoryInputs(inputs []gitHubRepositoryInput) []gitHubRepositoryInput {
	seen := map[string]bool{}
	out := []gitHubRepositoryInput{}
	for _, input := range inputs {
		repo := gitHubRepositoryInput{ID: strings.TrimSpace(input.ID), Owner: strings.TrimSpace(input.Owner), Name: strings.TrimSpace(input.Name), FullName: strings.TrimSpace(input.FullName), HTMLURL: strings.TrimSpace(input.HTMLURL)}
		if repo.FullName != "" && (repo.Owner == "" || repo.Name == "") {
			parts := strings.SplitN(repo.FullName, "/", 2)
			if len(parts) == 2 {
				if repo.Owner == "" {
					repo.Owner = parts[0]
				}
				if repo.Name == "" {
					repo.Name = parts[1]
				}
			}
		}
		if repo.FullName == "" && repo.Owner != "" && repo.Name != "" {
			repo.FullName = repo.Owner + "/" + repo.Name
		}
		if repo.ID == "" {
			repo.ID = repo.FullName
		}
		if repo.ID == "" || repo.FullName == "" || seen[repo.ID] {
			continue
		}
		seen[repo.ID] = true
		out = append(out, repo)
	}
	return out
}

func gitHubInstallationMatches(expected string, installation *gitHubInstallationPayload) bool {
	if strings.TrimSpace(expected) == "" || installation == nil {
		return false
	}
	return strings.TrimSpace(expected) == gitHubAnyID(installation.ID)
}

func gitHubAnyID(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case json.Number:
		return typed.String()
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	}
}

func githubInstallationID(payload map[string]any) string {
	installation := recordValue(payload["installation"])
	if installation == nil {
		return ""
	}
	return stringValue(installation["id"])
}

func githubRepositoryMappingActive(metadata map[string]any, payload map[string]any) bool {
	repository := recordValue(payload["repository"])
	if repository == nil {
		return true
	}
	selection := normalizeGitHubRepositorySelection(stringValue(metadata["repositorySelection"]))
	if selection == "all" {
		return true
	}
	if selection != "selected" {
		return false
	}
	repoID := stringValue(repository["id"])
	fullName := stringValue(repository["full_name"])
	if fullName == "" {
		fullName = stringValue(repository["fullName"])
	}
	for _, repo := range githubRepositoriesFromMetadata(metadata["selectedRepositories"]) {
		if !repo.Active {
			continue
		}
		if repoID != "" && repo.ID == repoID {
			return true
		}
		if fullName != "" && strings.EqualFold(repo.FullName, fullName) {
			return true
		}
	}
	return false
}

func githubRepositoriesFromMetadata(value any) []githubRepository {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var repos []githubRepository
	if err := json.Unmarshal(raw, &repos); err != nil {
		return nil
	}
	return normalizeGitHubRepositories(repos)
}

func normalizeGitHubRepositories(repositories []githubRepository) []githubRepository {
	out := make([]githubRepository, 0, len(repositories))
	for _, repo := range repositories {
		repo.ID = strings.TrimSpace(repo.ID)
		repo.Name = strings.TrimSpace(repo.Name)
		repo.FullName = strings.TrimSpace(repo.FullName)
		if repo.FullName == "" {
			repo.FullName = repo.Name
		}
		if repo.ID == "" && repo.FullName == "" {
			continue
		}
		out = append(out, repo)
	}
	return out
}

func activateGitHubRepositories(repositories []githubRepository) []githubRepository {
	out := normalizeGitHubRepositories(repositories)
	for index := range out {
		out[index].Active = true
	}
	return out
}

func normalizeGitHubAccount(account githubAccount) githubAccount {
	account.ID = strings.TrimSpace(account.ID)
	account.Login = strings.TrimSpace(account.Login)
	account.Type = strings.TrimSpace(account.Type)
	return account
}

func normalizeGitHubRepositorySelection(selection string) string {
	switch strings.ToLower(strings.TrimSpace(selection)) {
	case "all":
		return "all"
	case "selected", "selected_repositories":
		return "selected"
	default:
		return "unknown"
	}
}

func githubMetadataKeyAllowed(key string) bool {
	switch key {
	case "installationTargetType", "installationTargetId", "installationTargetLogin", "sender", "source":
		return true
	default:
		return false
	}
}

func githubDeliveryPayload(eventType string, deliveryID string, reason string, payload map[string]any, body []byte) []byte {
	record := map[string]any{
		"deliveryId": deliveryID,
		"event":      eventType,
	}
	if action := githubPayloadAction(payload); action != "" {
		record["action"] = action
	}
	if reason != "" {
		record["ignoredReason"] = reason
	}
	if payload != nil {
		record["payload"] = payload
	} else if len(body) > 0 {
		var parsed map[string]any
		if err := json.Unmarshal(body, &parsed); err == nil {
			record["payload"] = parsed
		}
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return []byte(`{}`)
	}
	return raw
}

func githubPayloadAction(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	return stringValue(payload["action"])
}

func githubIntegrationDetails(metadata map[string]any) map[string]any {
	details := map[string]any{}
	if installationID := stringValue(metadata["installationId"]); installationID != "" {
		details["installationId"] = installationID
	}
	if account := recordValue(metadata["account"]); account != nil {
		details["account"] = account
		if login := stringValue(account["login"]); login != "" {
			details["accountLogin"] = login
		}
	}
	selection := normalizeGitHubRepositorySelection(stringValue(metadata["repositorySelection"]))
	if selection != "unknown" {
		details["repositorySelection"] = selection
	}
	repositories := githubRepositoriesFromMetadata(metadata["selectedRepositories"])
	if len(repositories) > 0 {
		details["selectedRepositories"] = repositories
		details["selectedRepositoryCount"] = len(repositories)
	}
	return details
}

func githubRepositorySummary(details map[string]any) string {
	selection := stringValue(details["repositorySelection"])
	if selection == "all" {
		return "All repositories"
	}
	if count := stringValue(details["selectedRepositoryCount"]); count != "" && count != "0" {
		return fmt.Sprintf("%s selected repositories", count)
	}
	return "Repository selection pending"
}

func randomGitHubSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
