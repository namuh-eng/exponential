package integrations

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

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
	if err := h.disconnectProvider(r.Context(), p.WorkspaceID, p.UserID, "github"); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect GitHub failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) GitHubWebhook(w http.ResponseWriter, r *http.Request) {
	secret := strings.TrimSpace(os.Getenv("GITHUB_WEBHOOK_SECRET"))
	if secret == "" {
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
	credentialRaw, err := encryptedProviderCredentialJSON(credential)
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
