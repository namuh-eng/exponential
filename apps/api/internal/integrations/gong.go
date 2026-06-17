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
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

const gongMinimumRecordingSeconds = 10 * 60

type gongConnectRequest struct {
	DestinationTeamID   string `json:"destinationTeamId"`
	RoutingGuidance     string `json:"routingGuidance"`
	MentionParticipants bool   `json:"mentionParticipants"`
	PollingCursor       string `json:"pollingCursor"`
}

type gongConnectResponse struct {
	AuthorizationURL string `json:"authorizationUrl"`
	State            string `json:"state"`
	WorkspaceSlug    string `json:"workspaceSlug"`
}

type gongOAuthInstall struct {
	ID          string
	WorkspaceID string
	UserID      string
	Metadata    map[string]any
}

type gongOAuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
	TenantID     string `json:"tenant_id"`
	CompanyID    string `json:"company_id"`
}

type gongIngestRequest struct {
	Call gongCall `json:"call"`
}

type gongIngestResponse struct {
	Processed bool                `json:"processed"`
	Skipped   bool                `json:"skipped"`
	Reason    string              `json:"reason,omitempty"`
	Findings  []gongFindingResult `json:"findings"`
}

type gongFindingResult struct {
	FindingID  string `json:"findingId"`
	IssueID    string `json:"issueId"`
	Identifier string `json:"identifier"`
	Linked     bool   `json:"linked"`
}

type gongCall struct {
	ID              string               `json:"id"`
	Title           string               `json:"title"`
	URL             string               `json:"url"`
	DurationSeconds int                  `json:"durationSeconds"`
	Privacy         string               `json:"privacy"`
	Direction       string               `json:"direction"`
	StartedAt       string               `json:"startedAt"`
	Account         gongAccount          `json:"account"`
	Participants    []gongParticipant    `json:"participants"`
	Transcript      []gongTranscriptLine `json:"transcript"`
}

type gongAccount struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Domain string `json:"domain"`
}

type gongParticipant struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	External bool   `json:"external"`
}

type gongTranscriptLine struct {
	Speaker         string `json:"speaker"`
	SpeakerEmail    string `json:"speakerEmail"`
	SpeakerExternal bool   `json:"speakerExternal"`
	StartMs         int    `json:"startMs"`
	Text            string `json:"text"`
}

type gongFinding struct {
	ID             string
	Title          string
	Description    string
	Excerpt        string
	Speaker        string
	SpeakerEmail   string
	TimestampMs    int
	Permalink      string
	CustomerName   string
	CustomerDomain string
	CustomerEmail  string
}

type gongInstallRecord struct {
	WorkspaceID   string
	IntegrationID string
	ConnectedBy   string
	Metadata      map[string]any
}

func (h Handler) GongConnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	clientID, _, ok := gongOAuthConfig()
	if !ok {
		problem.Write(w, http.StatusPreconditionFailed, "Gong OAuth is not configured", "Add AUTH_GONG_ID and AUTH_GONG_SECRET to enable Gong installation for this workspace.")
		return
	}
	var input gongConnectRequest
	_ = json.NewDecoder(r.Body).Decode(&input)
	teamID, err := h.resolveGongDestinationTeam(r.Context(), p.WorkspaceID, input.DestinationTeamID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusConflict, "Connect Gong needs a public triage team", "Create or select a non-private triage-enabled team before connecting Gong.")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Gong authorization failed", err.Error())
		return
	}
	state, err := randomState()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Gong authorization failed", err.Error())
		return
	}
	workspaceSlug, err := h.workspaceSlug(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Gong authorization failed", err.Error())
		return
	}
	if err := h.saveGongOAuthState(r.Context(), p.WorkspaceID, p.UserID, teamID, state, input); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Gong authorization failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, gongConnectResponse{AuthorizationURL: gongAuthorizationURL(clientID, configuredAppURL(), state), State: state, WorkspaceSlug: workspaceSlug})
}

func (h Handler) GongOAuthCallback(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if gongError := strings.TrimSpace(r.URL.Query().Get("error")); gongError != "" {
		http.Redirect(w, r, gongRedirectURL("error", gongError), http.StatusFound)
		return
	}
	if code == "" || state == "" {
		problem.Write(w, http.StatusBadRequest, "Gong OAuth callback is missing code or state", "")
		return
	}
	_, clientSecret, ok := gongOAuthConfig()
	if !ok {
		problem.Write(w, http.StatusServiceUnavailable, "Gong OAuth is not configured", "")
		return
	}
	install, err := h.findGongOAuthInstall(r.Context(), state)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusBadRequest, "Invalid Gong OAuth state", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Gong OAuth callback failed", err.Error())
		return
	}
	token, err := exchangeGongOAuth(r.Context(), http.DefaultClient, clientSecret, code, gongRedirectURI(configuredAppURL()))
	if err != nil {
		_ = h.recordGongInstallFailure(r.Context(), install.ID, install.WorkspaceID, err.Error())
		problem.Write(w, http.StatusBadGateway, "Gong OAuth exchange failed", err.Error())
		return
	}
	if err := h.completeGongInstall(r.Context(), install, token); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Gong OAuth callback failed", err.Error())
		return
	}
	http.Redirect(w, r, gongRedirectURL("connected", ""), http.StatusFound)
}

func (h Handler) GongDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if err := h.revokeProvider(r.Context(), p.WorkspaceID, "gong", p.UserID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect Gong failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h Handler) GongIngestCall(w http.ResponseWriter, r *http.Request) {
	integrationID := strings.TrimSpace(chi.URLParam(r, "integrationID"))
	if integrationID == "" {
		problem.Write(w, http.StatusBadRequest, "integrationID is required", "")
		return
	}
	install, err := h.resolveGongWebhookInstall(r.Context(), integrationID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Gong integration not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Resolve Gong integration failed", err.Error())
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Gong call body could not be read", err.Error())
		return
	}
	sharedSecret := strings.TrimSpace(stringValue(install.Metadata["sharedSecret"]))
	if sharedSecret == "" {
		problem.Write(w, http.StatusServiceUnavailable, "Gong integration is missing shared secret", "Reconnect the Gong integration to generate a new shared secret.")
		return
	}
	if !verifyGongSignature(sharedSecret, r.Header.Get("X-Gong-Signature"), body) {
		problem.Write(w, http.StatusUnauthorized, "Invalid Gong signature", "")
		return
	}
	var input gongIngestRequest
	if err := json.Unmarshal(body, &input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid Gong call payload", err.Error())
		return
	}
	result, err := h.ingestGongCall(r.Context(), install, input.Call)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Ingest Gong call failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, result)
}

func (h Handler) resolveGongDestinationTeam(ctx context.Context, workspaceID, requestedTeamID string) (string, error) {
	requestedTeamID = strings.TrimSpace(requestedTeamID)
	if requestedTeamID != "" {
		var id string
		err := h.DB.QueryRow(ctx, `select id::text from team where id=$1::uuid and workspace_id=$2::uuid and deleted_at is null and retired_at is null and coalesce(is_private,false)=false and coalesce(triage_enabled,true)`, requestedTeamID, workspaceID).Scan(&id)
		return id, err
	}
	var id string
	err := h.DB.QueryRow(ctx, `select id::text from team where workspace_id=$1::uuid and deleted_at is null and retired_at is null and coalesce(is_private,false)=false and coalesce(triage_enabled,true) order by created_at asc limit 1`, workspaceID).Scan(&id)
	return id, err
}

func (h Handler) saveGongOAuthState(ctx context.Context, workspaceID string, userID string, teamID string, state string, input gongConnectRequest) error {
	sharedSecret, err := randomState()
	if err != nil {
		return err
	}
	metadata := map[string]any{
		"oauthStateHash":      hashSlackSecret(state),
		"oauthStateExpiresAt": time.Now().UTC().Add(15 * time.Minute).Format(time.RFC3339Nano),
		"destinationTeamId":   teamID,
		"routingGuidance":     truncateSlackText(input.RoutingGuidance, 1000),
		"mentionParticipants": input.MentionParticipants,
		"pollingCursor":       strings.TrimSpace(input.PollingCursor),
		"minimumDurationSec":  gongMinimumRecordingSeconds,
		"sharedSecret":        sharedSecret,
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into workspace_integration (workspace_id, provider, status, metadata, connected_by_user_id, connected_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'gong', 'installing', $2::jsonb, $3, null, null, null, null, now())
		on conflict (workspace_id, provider) do update set
			status='installing', metadata=excluded.metadata, connected_by_user_id=excluded.connected_by_user_id,
			credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=now()`, workspaceID, raw, userID)
	return err
}

func (h Handler) findGongOAuthInstall(ctx context.Context, state string) (gongOAuthInstall, error) {
	rows, err := h.DB.Query(ctx, `select id::text, workspace_id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb) from workspace_integration where provider='gong' and status='installing'`)
	if err != nil {
		return gongOAuthInstall{}, err
	}
	defer rows.Close()
	stateHash := hashSlackSecret(state)
	for rows.Next() {
		var install gongOAuthInstall
		var metadataRaw []byte
		if err := rows.Scan(&install.ID, &install.WorkspaceID, &install.UserID, &metadataRaw); err != nil {
			return gongOAuthInstall{}, err
		}
		install.Metadata = map[string]any{}
		_ = json.Unmarshal(metadataRaw, &install.Metadata)
		if stringValue(install.Metadata["oauthStateHash"]) != stateHash {
			continue
		}
		expiresAt, _ := time.Parse(time.RFC3339Nano, stringValue(install.Metadata["oauthStateExpiresAt"]))
		if expiresAt.IsZero() || expiresAt.Before(time.Now().UTC()) {
			return gongOAuthInstall{}, pgx.ErrNoRows
		}
		return install, nil
	}
	if err := rows.Err(); err != nil {
		return gongOAuthInstall{}, err
	}
	return gongOAuthInstall{}, pgx.ErrNoRows
}

func (h Handler) completeGongInstall(ctx context.Context, install gongOAuthInstall, token gongOAuthResponse) error {
	if token.AccessToken == "" {
		return fmt.Errorf("Gong OAuth response did not include an access token")
	}
	now := time.Now().UTC()
	externalID := firstNonEmpty(token.TenantID, token.CompanyID, stringValue(install.Metadata["tenantId"]), install.WorkspaceID)
	metadata := map[string]any{
		"tenantId":            externalID,
		"scopes":              strings.Fields(token.Scope),
		"destinationTeamId":   stringValue(install.Metadata["destinationTeamId"]),
		"routingGuidance":     stringValue(install.Metadata["routingGuidance"]),
		"mentionParticipants": install.Metadata["mentionParticipants"] == true,
		"pollingCursor":       stringValue(install.Metadata["pollingCursor"]),
		"minimumDurationSec":  gongMinimumRecordingSeconds,
		"statusWriteback":     "unsupported",
		"sharedSecret":        stringValue(install.Metadata["sharedSecret"]),
	}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	expiresAt := any(nil)
	if token.ExpiresIn > 0 {
		expiresAt = now.Add(time.Duration(token.ExpiresIn) * time.Second)
	}
	if _, err := tx.Exec(ctx, `
		update workspace_integration
		set status='connected', external_id=$2, display_name=$3, metadata=$4::jsonb, connected_by_user_id=$5,
			connected_at=coalesce(connected_at, $6), last_event_at=$6, last_success_at=$6,
			last_failure_at=null, last_failure_message=null, token_expires_at=$7,
			credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=$6
		where id=$1::uuid`, install.ID, externalID, "Gong", metadataRaw, install.UserID, now, expiresAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at, $2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, install.ID, now); err != nil {
		return err
	}
	credential := map[string]any{"accessToken": token.AccessToken, "refreshToken": token.RefreshToken, "tokenType": token.TokenType, "tenantId": externalID, "scope": token.Scope}
	credentialRaw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid, 'gong', $2, $3::jsonb, $4, $5, $5)`, install.ID, credentialRaw, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid, $2::uuid, 'gong', 'oauth_connected', 'info', 'Gong workspace connected.', $3::jsonb, $4)`, install.WorkspaceID, install.ID, metadataRaw, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h Handler) recordGongInstallFailure(ctx context.Context, integrationID string, workspaceID string, message string) error {
	_, err := h.DB.Exec(ctx, `update workspace_integration set status='error', last_failure_at=now(), last_failure_message=$2, updated_at=now() where id=$1::uuid`, integrationID, message)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid, $2::uuid, 'gong', 'oauth_failed', 'error', $3, '{}'::jsonb)`, workspaceID, integrationID, message)
	return err
}

func (h Handler) resolveGongInstall(ctx context.Context, workspaceID string, integrationID string) (gongInstallRecord, error) {
	integrationID = strings.TrimSpace(integrationID)
	if integrationID == "" {
		return gongInstallRecord{}, fmt.Errorf("integrationID is required")
	}
	var install gongInstallRecord
	var raw []byte
	err := h.DB.QueryRow(ctx, `select workspace_id::text, id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb) from workspace_integration where workspace_id=$1::uuid and provider='gong' and status in ('connected','degraded') and id=$2::uuid order by updated_at desc limit 1`, workspaceID, integrationID).Scan(&install.WorkspaceID, &install.IntegrationID, &install.ConnectedBy, &raw)
	if err != nil {
		return install, err
	}
	install.Metadata = readJSONRecord(raw)
	return install, nil
}

func (h Handler) resolveGongWebhookInstall(ctx context.Context, integrationID string) (gongInstallRecord, error) {
	integrationID = strings.TrimSpace(integrationID)
	if integrationID == "" {
		return gongInstallRecord{}, fmt.Errorf("integrationID is required")
	}
	var install gongInstallRecord
	var raw []byte
	err := h.DB.QueryRow(ctx, `select workspace_id::text, id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb) from workspace_integration where id=$1::uuid and provider='gong' and status in ('connected','degraded') limit 1`, integrationID).Scan(&install.WorkspaceID, &install.IntegrationID, &install.ConnectedBy, &raw)
	if err != nil {
		return install, err
	}
	install.Metadata = readJSONRecord(raw)
	return install, nil
}

func (h Handler) ingestGongCall(ctx context.Context, install gongInstallRecord, call gongCall) (gongIngestResponse, error) {
	if reason := gongSkipReason(call); reason != "" {
		if err := h.recordGongSkippedCall(ctx, install, call, reason); err != nil {
			return gongIngestResponse{}, err
		}
		return gongIngestResponse{Processed: false, Skipped: true, Reason: reason, Findings: []gongFindingResult{}}, nil
	}
	findings := gongExtractFindings(call)
	if len(findings) == 0 {
		if err := h.recordGongSkippedCall(ctx, install, call, "no_actionable_findings"); err != nil {
			return gongIngestResponse{}, err
		}
		return gongIngestResponse{Processed: true, Skipped: true, Reason: "no_actionable_findings", Findings: []gongFindingResult{}}, nil
	}
	results := make([]gongFindingResult, 0, len(findings))
	for _, finding := range findings {
		result, err := h.createOrLinkGongFinding(ctx, install, call, finding)
		if err != nil {
			return gongIngestResponse{}, err
		}
		results = append(results, result)
	}
	return gongIngestResponse{Processed: true, Findings: results}, nil
}

func (h Handler) createOrLinkGongFinding(ctx context.Context, install gongInstallRecord, call gongCall, finding gongFinding) (gongFindingResult, error) {
	var existing gongFindingResult
	err := h.DB.QueryRow(ctx, `select i.id::text,i.identifier from integration_thread_link itl join issue i on i.id=itl.issue_id where itl.workspace_integration_id=$1::uuid and itl.provider='gong' and itl.source_event_id=$2 limit 1`, install.IntegrationID, finding.ID).Scan(&existing.IssueID, &existing.Identifier)
	if err == nil {
		existing.FindingID = finding.ID
		existing.Linked = true
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return gongFindingResult{}, err
	}
	teamID := stringValue(install.Metadata["destinationTeamId"])
	if teamID == "" {
		return gongFindingResult{}, fmt.Errorf("Gong integration is missing destination team")
	}
	creatorID := install.ConnectedBy
	if creatorID == "" {
		creatorID, err = h.workspaceIssueCreator(ctx, install.WorkspaceID)
		if err != nil {
			return gongFindingResult{}, err
		}
	}
	for attempt := 0; attempt < 3; attempt++ {
		result, err := h.tryCreateGongFinding(ctx, install, call, finding, teamID, creatorID)
		if err == nil {
			return result, nil
		}
		if isGongUniqueViolation(err) {
			continue
		}
		return gongFindingResult{}, err
	}
	return gongFindingResult{}, fmt.Errorf("failed to allocate issue number after retries")
}

func (h Handler) tryCreateGongFinding(ctx context.Context, install gongInstallRecord, call gongCall, finding gongFinding, teamID string, creatorID string) (gongFindingResult, error) {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return gongFindingResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	team, err := slackIssueTeamForCreate(ctx, tx, install.WorkspaceID, teamID)
	if err != nil {
		return gongFindingResult{}, err
	}
	stateID, err := slackIssueStateByCategory(ctx, tx, teamID, "triage")
	if err != nil {
		stateID, err = slackIssueStateByCategory(ctx, tx, teamID, "backlog")
		if err != nil {
			return gongFindingResult{}, err
		}
	}
	if _, err := tx.Exec(ctx, `select id from team where id=$1::uuid for update`, teamID); err != nil {
		return gongFindingResult{}, err
	}
	var nextNumber int32
	if err := tx.QueryRow(ctx, `select coalesce(max(number),0)+1 from issue where team_id=$1::uuid`, teamID).Scan(&nextNumber); err != nil {
		return gongFindingResult{}, err
	}
	identifier := fmt.Sprintf("%s-%d", team.Key, nextNumber)
	issueURL := issueBacklink(team.Key, identifier)
	var issueID string
	description := finding.Description
	if install.Metadata["mentionParticipants"] == true {
		description = appendGongParticipants(description, call.Participants)
	}
	if err := tx.QueryRow(ctx, `insert into issue (number,identifier,title,description,team_id,state_id,creator_id,priority) values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,'medium') returning id::text`, nextNumber, identifier, finding.Title, description, teamID, stateID, creatorID).Scan(&issueID); err != nil {
		return gongFindingResult{}, err
	}
	history := map[string]any{"source": "gong_call", "provider": "gong", "callId": call.ID, "findingId": finding.ID, "sourceUrl": finding.Permalink, "issueUrl": issueURL, "customerDomain": finding.CustomerDomain}
	historyRaw, _ := json.Marshal(history)
	if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,actor_name,actor_email,event_type,metadata) values ($1::uuid,$2,'Gong',null,'created',$3::jsonb)`, issueID, nullString(creatorID), historyRaw); err != nil {
		return gongFindingResult{}, err
	}
	customerID, err := upsertGongCustomer(ctx, tx, install.WorkspaceID, call, finding)
	if err != nil {
		return gongFindingResult{}, err
	}
	body := finding.Description
	var requestID string
	if err := tx.QueryRow(ctx, `insert into customer_request (workspace_id, customer_id, title, body, source, source_url, external_provider, external_id, important, created_by_user_id) values ($1::uuid,$2::uuid,$3,$4,'Gong',$5,'gong',$6,true,$7) on conflict (workspace_id, external_provider, external_id) where external_provider is not null and external_id is not null do update set customer_id=excluded.customer_id, title=excluded.title, body=excluded.body, source=excluded.source, source_url=excluded.source_url, important=excluded.important, updated_at=now() returning id::text`, install.WorkspaceID, customerID, finding.Title, body, finding.Permalink, finding.ID, nullString(creatorID)).Scan(&requestID); err != nil {
		return gongFindingResult{}, err
	}
	if _, err := tx.Exec(ctx, `insert into issue_customer_request (issue_id, customer_request_id, created_by_user_id) values ($1::uuid,$2::uuid,$3) on conflict do nothing`, issueID, requestID, nullString(creatorID)); err != nil {
		return gongFindingResult{}, err
	}
	if _, err := tx.Exec(ctx, `insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id) values ($1::uuid,$2::uuid,'gong',$3::uuid,$4,$5,$6,$7,$8,'inbound',$9) on conflict (workspace_integration_id, source_event_id) where workspace_integration_id is not null and source_event_id is not null do update set issue_id=excluded.issue_id, external_permalink=excluded.external_permalink, updated_at=now()`, install.WorkspaceID, install.IntegrationID, issueID, call.Account.ID, "gong", call.ID, finding.ID, finding.Permalink, finding.ID); err != nil {
		return gongFindingResult{}, err
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'gong','finding_linked','info','Gong finding linked to issue.', $3::jsonb)`, install.WorkspaceID, install.IntegrationID, historyRaw); err != nil {
		return gongFindingResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return gongFindingResult{}, err
	}
	return gongFindingResult{FindingID: finding.ID, IssueID: issueID, Identifier: identifier}, nil
}

func upsertGongCustomer(ctx context.Context, tx pgx.Tx, workspaceID string, call gongCall, finding gongFinding) (string, error) {
	domain := strings.ToLower(strings.TrimSpace(firstNonEmpty(finding.CustomerDomain, call.Account.Domain, domainFromEmail(finding.CustomerEmail))))
	name := firstNonEmpty(finding.CustomerName, call.Account.Name, domain, "Unknown customer")
	if domain != "" {
		var id string
		err := tx.QueryRow(ctx, `select id::text from customer where workspace_id=$1::uuid and lower(domain)=lower($2) limit 1`, workspaceID, domain).Scan(&id)
		if err == nil {
			_, updateErr := tx.Exec(ctx, `update customer set name=$2, source=coalesce(nullif(source,''),'gong'), updated_at=now() where id=$1::uuid`, id, name)
			return id, updateErr
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	var id string
	err := tx.QueryRow(ctx, `insert into customer (workspace_id, name, domain, source, created_at, updated_at) values ($1::uuid,$2,$3,'gong',now(),now()) returning id::text`, workspaceID, name, nullString(domain)).Scan(&id)
	return id, err
}

func (h Handler) recordGongSkippedCall(ctx context.Context, install gongInstallRecord, call gongCall, reason string) error {
	payload, _ := json.Marshal(map[string]any{"callId": call.ID, "reason": reason, "durationSeconds": call.DurationSeconds, "privacy": call.Privacy})
	_, err := h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'gong','call_skipped','info','Gong call skipped.', $3::jsonb)`, install.WorkspaceID, install.IntegrationID, payload)
	return err
}

func gongSkipReason(call gongCall) string {
	if strings.TrimSpace(call.ID) == "" {
		return "missing_call_id"
	}
	if call.DurationSeconds > 0 && call.DurationSeconds < gongMinimumRecordingSeconds {
		return "recording_too_short"
	}
	privacy := strings.ToLower(strings.TrimSpace(call.Privacy))
	if privacy == "private" || privacy == "internal" || privacy == "team_only" {
		return "private_or_internal"
	}
	if !gongHasExternalParticipant(call) {
		return "no_external_participant"
	}
	return ""
}

func gongHasExternalParticipant(call gongCall) bool {
	for _, participant := range call.Participants {
		if participant.External || strings.EqualFold(participant.Role, "customer") || strings.EqualFold(participant.Role, "external") {
			return true
		}
	}
	for _, line := range call.Transcript {
		if line.SpeakerExternal {
			return true
		}
	}
	return false
}

func gongExtractFindings(call gongCall) []gongFinding {
	seen := map[string]bool{}
	findings := []gongFinding{}
	for _, line := range call.Transcript {
		excerpt := normalizeWhitespace(line.Text)
		if excerpt == "" || !gongActionableText(excerpt) || !gongExternalSpeaker(call, line) {
			continue
		}
		id := gongFindingID(call.ID, line.StartMs, excerpt)
		if seen[id] {
			continue
		}
		seen[id] = true
		customerEmail := strings.ToLower(strings.TrimSpace(line.SpeakerEmail))
		finding := gongFinding{ID: id, Title: gongFindingTitle(call, excerpt), Excerpt: excerpt, Speaker: strings.TrimSpace(line.Speaker), SpeakerEmail: customerEmail, TimestampMs: line.StartMs, Permalink: gongTimestampPermalink(call.URL, line.StartMs), CustomerName: call.Account.Name, CustomerDomain: firstNonEmpty(call.Account.Domain, domainFromEmail(customerEmail)), CustomerEmail: customerEmail}
		finding.Description = gongFindingDescription(call, finding)
		findings = append(findings, finding)
	}
	sort.SliceStable(findings, func(i, j int) bool { return findings[i].TimestampMs < findings[j].TimestampMs })
	return findings
}

func gongActionableText(text string) bool {
	lower := strings.ToLower(text)
	keywords := []string{"can you add", "could you add", "we need", "we want", "we'd like", "we would like", "i need", "i want", "feature request", "request", "bug", "broken", "doesn't work", "pain", "wish", "blocker"}
	for _, keyword := range keywords {
		if strings.Contains(lower, keyword) {
			return true
		}
	}
	return false
}

func gongExternalSpeaker(call gongCall, line gongTranscriptLine) bool {
	if line.SpeakerExternal {
		return true
	}
	email := strings.ToLower(strings.TrimSpace(line.SpeakerEmail))
	if email == "" {
		return false
	}
	for _, participant := range call.Participants {
		if strings.EqualFold(participant.Email, email) {
			return participant.External || strings.EqualFold(participant.Role, "customer") || strings.EqualFold(participant.Role, "external")
		}
	}
	return false
}

func gongFindingID(callID string, timestampMs int, excerpt string) string {
	sum := sha256.Sum256([]byte(callID + ":" + strconv.Itoa(timestampMs) + ":" + strings.ToLower(normalizeWhitespace(excerpt))))
	return callID + ":" + hex.EncodeToString(sum[:8])
}

func gongFindingTitle(call gongCall, excerpt string) string {
	base := strings.Trim(strings.TrimSuffix(excerpt, "."), " ")
	if len([]rune(base)) > 96 {
		base = string([]rune(base)[:96]) + "…"
	}
	account := firstNonEmpty(call.Account.Name, call.Account.Domain, "Customer")
	return truncateSlackText(account+": "+base, 500)
}

func gongFindingDescription(call gongCall, finding gongFinding) string {
	parts := []string{"Gong customer call finding", ""}
	if call.Title != "" {
		parts = append(parts, "Call: "+call.Title)
	}
	if finding.Speaker != "" || finding.SpeakerEmail != "" {
		speaker := strings.TrimSpace(finding.Speaker)
		if finding.SpeakerEmail != "" {
			speaker = strings.TrimSpace(speaker + " <" + finding.SpeakerEmail + ">")
		}
		parts = append(parts, "Speaker: "+speaker)
	}
	parts = append(parts, "Timestamp: "+formatGongTimestamp(finding.TimestampMs), "", "> "+finding.Excerpt)
	if finding.Permalink != "" {
		parts = append(parts, "", "Source: "+finding.Permalink)
	}
	return strings.Join(parts, "\n")
}

func appendGongParticipants(description string, participants []gongParticipant) string {
	lines := []string{}
	seen := map[string]bool{}
	for _, participant := range participants {
		if !participant.External && !strings.EqualFold(participant.Role, "customer") && !strings.EqualFold(participant.Role, "external") {
			continue
		}
		label := strings.TrimSpace(participant.Name)
		if participant.Email != "" {
			label = strings.TrimSpace(label + " <" + strings.ToLower(strings.TrimSpace(participant.Email)) + ">")
		}
		if label == "" || seen[strings.ToLower(label)] {
			continue
		}
		seen[strings.ToLower(label)] = true
		lines = append(lines, "- "+label)
	}
	if len(lines) == 0 {
		return description
	}
	return description + "\n\nParticipants:\n" + strings.Join(lines, "\n")
}

func gongTimestampPermalink(rawURL string, timestampMs int) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	values := parsed.Query()
	values.Set("t", strconv.Itoa(timestampMs/1000))
	parsed.RawQuery = values.Encode()
	return parsed.String()
}

func formatGongTimestamp(timestampMs int) string {
	if timestampMs < 0 {
		timestampMs = 0
	}
	seconds := timestampMs / 1000
	return fmt.Sprintf("%02d:%02d", seconds/60, seconds%60)
}

func normalizeWhitespace(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func domainFromEmail(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	at := strings.LastIndex(email, "@")
	if at < 0 || at == len(email)-1 {
		return ""
	}
	return email[at+1:]
}

func gongOAuthConfig() (clientID string, clientSecret string, ok bool) {
	clientID = strings.TrimSpace(os.Getenv("AUTH_GONG_ID"))
	clientSecret = strings.TrimSpace(os.Getenv("AUTH_GONG_SECRET"))
	return clientID, clientSecret, clientID != "" && clientSecret != ""
}

func gongConfigured() bool {
	_, _, ok := gongOAuthConfig()
	return ok
}

func gongIntegrationDetails(metadata map[string]any) map[string]any {
	details := map[string]any{}
	for _, key := range []string{"destinationTeamId", "routingGuidance", "pollingCursor", "minimumDurationSec", "statusWriteback"} {
		if value := stringValue(metadata[key]); value != "" {
			details[key] = value
		}
	}
	if value, ok := metadata["mentionParticipants"].(bool); ok {
		details["mentionParticipants"] = value
	}
	if value := stringValue(metadata["tenantId"]); value != "" {
		details["tenantId"] = value
	}
	return details
}

func gongRedirectURI(appURL string) string {
	return strings.TrimRight(appURL, "/") + "/api/integrations/gong/oauth/callback"
}

func gongAuthorizationURL(clientID, appURL, state string) string {
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("response_type", "code")
	values.Set("redirect_uri", gongRedirectURI(appURL))
	values.Set("scope", "api:calls:read:extensive api:calls:read:transcript")
	values.Set("state", state)
	return gongAPIBaseURL() + "/oauth2/authorize?" + values.Encode()
}

func gongRedirectURL(status string, message string) string {
	values := url.Values{}
	values.Set("gong", status)
	if strings.TrimSpace(message) != "" {
		values.Set("message", message)
	}
	return strings.TrimRight(configuredAppURL(), "/") + "/settings/integrations?" + values.Encode()
}

func gongAPIBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("GONG_API_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://app.gong.io"
}

func exchangeGongOAuth(ctx context.Context, client *http.Client, clientSecret string, code string, redirectURI string) (gongOAuthResponse, error) {
	clientID, _, ok := gongOAuthConfig()
	if !ok {
		return gongOAuthResponse{}, fmt.Errorf("Gong OAuth is not configured")
	}
	values := url.Values{}
	values.Set("grant_type", "authorization_code")
	values.Set("client_id", clientID)
	values.Set("client_secret", clientSecret)
	values.Set("code", code)
	values.Set("redirect_uri", redirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gongAPIBaseURL()+"/oauth2/token", strings.NewReader(values.Encode()))
	if err != nil {
		return gongOAuthResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return gongOAuthResponse{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return gongOAuthResponse{}, fmt.Errorf("Gong OAuth returned HTTP %d", resp.StatusCode)
	}
	var token gongOAuthResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return gongOAuthResponse{}, err
	}
	return token, nil
}

// verifyGongSignature verifies the HMAC-SHA256 signature of a Gong webhook
// payload using the per-integration shared secret. The header value may be
// a raw hex digest or prefixed with "sha256=".
func verifyGongSignature(sharedSecret string, signature string, body []byte) bool {
	if sharedSecret == "" || signature == "" {
		return false
	}
	signature = strings.TrimPrefix(signature, "sha256=")
	mac := hmac.New(sha256.New, []byte(sharedSecret))
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func isGongUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
