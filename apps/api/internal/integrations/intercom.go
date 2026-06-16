package integrations

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	"github.com/namuh-eng/exponential/apps/api/internal/sanitizehtml"
)

type intercomConnectResponse struct {
	AuthorizationURL string `json:"authorizationUrl"`
	State            string `json:"state"`
	WorkspaceSlug    string `json:"workspaceSlug"`
}

type intercomOAuthInstall struct {
	ID          string
	WorkspaceID string
	UserID      string
	Metadata    map[string]any
}

type intercomOAuthToken struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	AppID       string `json:"app_id"`
	Scope       string `json:"scope"`
}

type intercomMeResponse struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	Name  string `json:"name"`
	Email string `json:"email"`
	App   struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"app"`
	AppID string `json:"app_id"`
}

type intercomCredential struct {
	AccessToken string   `json:"accessToken"`
	TokenType   string   `json:"tokenType"`
	AppID       string   `json:"appId"`
	AdminID     string   `json:"adminId,omitempty"`
	Scopes      []string `json:"scopes"`
}

type intercomInstallRecord struct {
	WorkspaceID   string
	IntegrationID string
	ConnectedBy   string
	AppID         string
	DisplayName   string
	Metadata      map[string]any
}

type intercomConversationAction struct {
	AppID          string
	ConversationID string
	Permalink      string
	Title          string
	Description    string
	IssueID        string
	TeamID         string
	ContactID      string
	ContactName    string
	ContactEmail   string
	CompanyID      string
	CompanyName    string
	Raw            map[string]any
}

type intercomIssueDescriptor struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
	WebURL     string `json:"webUrl"`
	Status     string `json:"status"`
	Assignee   string `json:"assignee"`
}

type intercomActionResponse struct {
	OK      bool                      `json:"ok"`
	Message string                    `json:"message,omitempty"`
	Issue   *intercomIssueDescriptor  `json:"issue,omitempty"`
	Issues  []intercomIssueDescriptor `json:"issues,omitempty"`
	Meta    map[string]any            `json:"meta,omitempty"`
}

func (h Handler) IntercomConnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	clientID, _, ok := intercomOAuthConfig()
	if !ok {
		problem.JSON(w, http.StatusPreconditionFailed, map[string]string{"error": "Intercom OAuth is not configured", "message": "Add AUTH_INTERCOM_ID and AUTH_INTERCOM_SECRET to enable Intercom installation for this workspace."})
		return
	}
	state, err := randomState()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Intercom authorization failed", err.Error())
		return
	}
	workspaceSlug, err := h.workspaceSlug(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Intercom authorization failed", err.Error())
		return
	}
	if err := h.saveIntercomOAuthState(r.Context(), p.WorkspaceID, p.UserID, state); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Intercom authorization failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, intercomConnectResponse{AuthorizationURL: intercomAuthorizationURL(clientID, configuredAppURL(), state), State: state, WorkspaceSlug: workspaceSlug})
}

func (h Handler) IntercomDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if err := h.revokeProvider(r.Context(), p.WorkspaceID, "intercom", p.UserID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect Intercom failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) IntercomOAuthCallback(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if intercomError := strings.TrimSpace(r.URL.Query().Get("error")); intercomError != "" {
		http.Redirect(w, r, intercomRedirectURL("error", intercomError), http.StatusFound)
		return
	}
	if code == "" || state == "" {
		problem.Write(w, http.StatusBadRequest, "Intercom OAuth callback is missing code or state", "")
		return
	}
	clientID, clientSecret, ok := intercomOAuthConfig()
	if !ok {
		problem.Write(w, http.StatusServiceUnavailable, "Intercom OAuth is not configured", "")
		return
	}
	install, err := h.findIntercomOAuthInstall(r.Context(), state)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusBadRequest, "Invalid Intercom OAuth state", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Intercom OAuth callback failed", err.Error())
		return
	}
	token, err := exchangeIntercomOAuth(r.Context(), http.DefaultClient, clientID, clientSecret, code, intercomRedirectURI(configuredAppURL()))
	if err != nil {
		_ = h.recordIntercomInstallFailure(r.Context(), install.ID, install.WorkspaceID, err.Error())
		problem.Write(w, http.StatusBadGateway, "Intercom OAuth exchange failed", err.Error())
		return
	}
	me, err := fetchIntercomMe(r.Context(), http.DefaultClient, token.AccessToken)
	if err != nil {
		_ = h.recordIntercomInstallFailure(r.Context(), install.ID, install.WorkspaceID, err.Error())
		problem.Write(w, http.StatusBadGateway, "Intercom workspace fetch failed", err.Error())
		return
	}
	if err := h.completeIntercomInstall(r.Context(), install, token, me); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Intercom OAuth callback failed", err.Error())
		return
	}
	http.Redirect(w, r, intercomRedirectURL("connected", ""), http.StatusFound)
}

func (h Handler) IntercomIssueSearch(w http.ResponseWriter, r *http.Request) {
	action, install, ok := h.readIntercomAction(w, r)
	if !ok {
		return
	}
	issues, err := h.searchIntercomIssues(r.Context(), install.WorkspaceID, firstNonEmpty(action.Title, action.Description, action.IssueID))
	if err != nil {
		_ = h.recordIntercomEvent(r.Context(), install, "issue_search_failed", "error", safeIntercomError(err), action.safePayload())
		problem.Write(w, http.StatusInternalServerError, "Search Intercom issues failed", err.Error())
		return
	}
	_ = h.recordIntercomEvent(r.Context(), install, "issue_search", "info", "Intercom issue search completed.", map[string]any{"conversationId": action.ConversationID, "resultCount": len(issues)})
	problem.JSON(w, http.StatusOK, intercomActionResponse{OK: true, Issues: issues})
}

func (h Handler) IntercomIssueStatus(w http.ResponseWriter, r *http.Request) {
	action, install, ok := h.readIntercomAction(w, r)
	if !ok {
		return
	}
	issue, err := h.intercomIssueStatus(r.Context(), install, action)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.JSON(w, http.StatusOK, intercomActionResponse{OK: true, Message: "No Exponential issue is linked to this Intercom conversation."})
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load Intercom linked issue failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, intercomActionResponse{OK: true, Issue: &issue})
}

func (h Handler) IntercomIssueLink(w http.ResponseWriter, r *http.Request) {
	action, install, ok := h.readIntercomAction(w, r)
	if !ok {
		return
	}
	if action.ConversationID == "" || action.IssueID == "" {
		problem.Write(w, http.StatusBadRequest, "Intercom link requires conversationId and issueId", "")
		return
	}
	issue, err := h.findIntercomIssueForLink(r.Context(), install.WorkspaceID, action.IssueID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Issue is not linkable from Intercom", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load issue failed", err.Error())
		return
	}
	if err := h.upsertIntercomConversationLink(r.Context(), install, action, issue.ID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Intercom conversation failed", err.Error())
		return
	}
	_ = h.queueIntercomNote(r.Context(), install, action.ConversationID, fmt.Sprintf("Linked to Exponential issue <a href=\"%s\">%s</a>.", issue.WebURL, issue.Identifier))
	_ = h.recordIntercomEvent(r.Context(), install, "issue_linked", "info", "Intercom conversation linked to an issue.", map[string]any{"conversationId": action.ConversationID, "issueId": issue.ID})
	problem.JSON(w, http.StatusOK, intercomActionResponse{OK: true, Message: "Issue linked.", Issue: &issue})
}

func (h Handler) IntercomIssueUnlink(w http.ResponseWriter, r *http.Request) {
	action, install, ok := h.readIntercomAction(w, r)
	if !ok {
		return
	}
	if action.ConversationID == "" {
		problem.Write(w, http.StatusBadRequest, "Intercom unlink requires conversationId", "")
		return
	}
	if _, err := h.DB.Exec(r.Context(), `update integration_thread_link set issue_id=null, updated_at=now() where workspace_integration_id=$1::uuid and provider='intercom' and external_channel_id=$2`, install.IntegrationID, action.ConversationID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Unlink Intercom conversation failed", err.Error())
		return
	}
	_ = h.recordIntercomEvent(r.Context(), install, "issue_unlinked", "info", "Intercom conversation unlinked from its issue.", map[string]any{"conversationId": action.ConversationID})
	problem.JSON(w, http.StatusOK, intercomActionResponse{OK: true, Message: "Issue unlinked."})
}

func (h Handler) IntercomIssueCreate(w http.ResponseWriter, r *http.Request) {
	action, install, ok := h.readIntercomAction(w, r)
	if !ok {
		return
	}
	if action.ConversationID == "" {
		problem.Write(w, http.StatusBadRequest, "Intercom create issue requires conversationId", "")
		return
	}
	if issue, err := h.intercomIssueStatus(r.Context(), install, action); err == nil {
		problem.JSON(w, http.StatusOK, intercomActionResponse{OK: true, Message: "Conversation already has a linked issue.", Issue: &issue})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusInternalServerError, "Load Intercom linked issue failed", err.Error())
		return
	}
	issue, err := h.createIntercomIssue(r.Context(), install, action)
	if err != nil {
		_ = h.recordIntercomEvent(r.Context(), install, "issue_create_failed", "error", safeIntercomError(err), action.safePayload())
		problem.Write(w, http.StatusInternalServerError, "Create issue from Intercom failed", err.Error())
		return
	}
	_ = h.queueIntercomNote(r.Context(), install, action.ConversationID, fmt.Sprintf("Created Exponential issue <a href=\"%s\">%s</a> from this Intercom conversation.", issue.WebURL, issue.Identifier))
	_ = h.recordIntercomEvent(r.Context(), install, "issue_created", "info", "Intercom conversation created an issue.", map[string]any{"conversationId": action.ConversationID, "issueId": issue.ID})
	problem.JSON(w, http.StatusOK, intercomActionResponse{OK: true, Message: "Issue created.", Issue: &issue})
}

func (h Handler) readIntercomAction(w http.ResponseWriter, r *http.Request) (intercomConversationAction, intercomInstallRecord, bool) {
	action, ok := readVerifiedIntercomAction(w, r)
	if !ok {
		return intercomConversationAction{}, intercomInstallRecord{}, false
	}
	if action.AppID == "" {
		problem.Write(w, http.StatusBadRequest, "Intercom action is missing app_id", "")
		return intercomConversationAction{}, intercomInstallRecord{}, false
	}
	install, err := h.resolveIntercomInstall(r.Context(), action.AppID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusAccepted, "Intercom is not connected to this Exponential workspace", "")
		return intercomConversationAction{}, intercomInstallRecord{}, false
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Resolve Intercom integration failed", err.Error())
		return intercomConversationAction{}, intercomInstallRecord{}, false
	}
	return action, install, true
}

func readVerifiedIntercomAction(w http.ResponseWriter, r *http.Request) (intercomConversationAction, bool) {
	secret := intercomSigningSecret()
	if secret == "" {
		problem.Write(w, http.StatusServiceUnavailable, "Intercom signing secret is not configured", "")
		return intercomConversationAction{}, false
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Intercom action body could not be read", err.Error())
		return intercomConversationAction{}, false
	}
	if !verifyIntercomSignature(secret, r.Header.Get("X-Hub-Signature"), r.Header.Get("X-Intercom-Signature"), body) {
		problem.Write(w, http.StatusUnauthorized, "Invalid Intercom signature", "")
		return intercomConversationAction{}, false
	}
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		problem.Write(w, http.StatusBadRequest, "Intercom action payload is invalid", err.Error())
		return intercomConversationAction{}, false
	}
	return intercomActionFromPayload(raw), true
}

func intercomActionFromPayload(raw map[string]any) intercomConversationAction {
	conversation := firstNamedRecord(raw, "conversation")
	dataItem := firstNamedRecord(firstNamedRecord(raw, "data"), "item")
	contact := firstNamedRecord(raw, "contact", "user", "customer")
	company := firstNamedRecord(raw, "company")
	if len(company) == 0 {
		companies := firstArray(contact, "companies")
		if len(companies) > 0 {
			company = recordValue(companies[0])
		}
	}
	conversationID := firstNonEmpty(stringValue(raw["conversationId"]), stringValue(raw["conversation_id"]), stringValue(conversation["id"]), stringValue(dataItem["id"]))
	permalink := firstNonEmpty(stringValue(raw["permalink"]), stringValue(raw["conversationUrl"]), stringValue(raw["conversation_url"]), stringValue(conversation["permalink"]), stringValue(conversation["url"]))
	body := firstNonEmpty(stringValue(raw["description"]), stringValue(raw["body"]), stringValue(conversation["body"]), stringValue(dataItem["body"]))
	return intercomConversationAction{
		AppID:          firstNonEmpty(stringValue(raw["app_id"]), stringValue(raw["appId"]), stringValue(raw["workspace_id"]), stringValue(raw["workspaceId"])),
		ConversationID: conversationID,
		Permalink:      permalink,
		Title:          firstNonEmpty(stringValue(raw["title"]), stringValue(raw["subject"]), stringValue(conversation["title"]), stringValue(conversation["subject"]), defaultIntercomIssueTitle(body, conversationID)),
		Description:    body,
		IssueID:        firstNonEmpty(stringValue(raw["issueId"]), stringValue(raw["issue_id"]), stringValue(raw["identifier"])),
		TeamID:         firstNonEmpty(stringValue(raw["teamId"]), stringValue(raw["team_id"])),
		ContactID:      firstNonEmpty(stringValue(raw["contactId"]), stringValue(raw["contact_id"]), stringValue(contact["id"])),
		ContactName:    firstNonEmpty(stringValue(raw["contactName"]), stringValue(raw["contact_name"]), stringValue(contact["name"])),
		ContactEmail:   firstNonEmpty(stringValue(raw["contactEmail"]), stringValue(raw["contact_email"]), stringValue(contact["email"])),
		CompanyID:      firstNonEmpty(stringValue(raw["companyId"]), stringValue(raw["company_id"]), stringValue(company["id"])),
		CompanyName:    firstNonEmpty(stringValue(raw["companyName"]), stringValue(raw["company_name"]), stringValue(company["name"])),
		Raw:            raw,
	}
}

func (a intercomConversationAction) safePayload() map[string]any {
	return map[string]any{"appId": a.AppID, "conversationId": a.ConversationID, "contactId": a.ContactID, "companyId": a.CompanyID}
}

func (h Handler) saveIntercomOAuthState(ctx context.Context, workspaceID string, userID string, state string) error {
	now := time.Now().UTC()
	metadata := map[string]any{"oauthStateHash": hashSlackSecret(state), "oauthStateExpiresAt": now.Add(10 * time.Minute).Format(time.RFC3339Nano), "oauthStartedAt": now.Format(time.RFC3339Nano)}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into workspace_integration (workspace_id, provider, status, metadata, connected_by_user_id, connected_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'intercom', 'installing', $2::jsonb, $3, null, null, null, null, now())
		on conflict (workspace_id, provider) do update set status='installing', metadata=excluded.metadata, connected_by_user_id=excluded.connected_by_user_id, credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=now()`, workspaceID, raw, userID)
	return err
}

func (h Handler) findIntercomOAuthInstall(ctx context.Context, state string) (intercomOAuthInstall, error) {
	rows, err := h.DB.Query(ctx, `select id::text, workspace_id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb) from workspace_integration where provider='intercom' and status='installing'`)
	if err != nil {
		return intercomOAuthInstall{}, err
	}
	defer rows.Close()
	stateHash := hashSlackSecret(state)
	for rows.Next() {
		var install intercomOAuthInstall
		var metadataRaw []byte
		if err := rows.Scan(&install.ID, &install.WorkspaceID, &install.UserID, &metadataRaw); err != nil {
			return intercomOAuthInstall{}, err
		}
		install.Metadata = map[string]any{}
		_ = json.Unmarshal(metadataRaw, &install.Metadata)
		if stringValue(install.Metadata["oauthStateHash"]) != stateHash {
			continue
		}
		expiresAt, _ := time.Parse(time.RFC3339Nano, stringValue(install.Metadata["oauthStateExpiresAt"]))
		if expiresAt.IsZero() || expiresAt.Before(time.Now().UTC()) {
			return intercomOAuthInstall{}, pgx.ErrNoRows
		}
		return install, nil
	}
	if err := rows.Err(); err != nil {
		return intercomOAuthInstall{}, err
	}
	return intercomOAuthInstall{}, pgx.ErrNoRows
}

func (h Handler) completeIntercomInstall(ctx context.Context, install intercomOAuthInstall, token intercomOAuthToken, me intercomMeResponse) error {
	appID := firstNonEmpty(me.App.ID, me.AppID, token.AppID)
	if token.AccessToken == "" || appID == "" {
		return fmt.Errorf("Intercom OAuth response did not include an access token and app id")
	}
	displayName := firstNonEmpty(me.App.Name, appID)
	now := time.Now().UTC()
	metadata := map[string]any{"appId": appID, "appName": displayName, "adminId": me.ID, "adminEmail": me.Email, "adminName": me.Name, "installedBy": install.UserID, "scopes": strings.Fields(token.Scope)}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	credential := intercomCredential{AccessToken: token.AccessToken, TokenType: firstNonEmpty(token.TokenType, "Bearer"), AppID: appID, AdminID: me.ID, Scopes: strings.Fields(token.Scope)}
	credentialRaw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `update workspace_integration set status='connected', external_id=$2, display_name=$3, metadata=$4::jsonb, connected_by_user_id=$5, connected_at=coalesce(connected_at,$6), last_event_at=$6, last_success_at=$6, last_failure_at=null, last_failure_message=null, token_expires_at=null, credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=$6 where id=$1::uuid`, install.ID, appID, displayName, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at,$2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, install.ID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid,'intercom',$2,$3::jsonb,$4,$5,$5)`, install.ID, credentialRaw, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'intercom','oauth_connected','info','Intercom workspace connected.',$3::jsonb,$4)`, install.WorkspaceID, install.ID, metadataRaw, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h Handler) recordIntercomInstallFailure(ctx context.Context, integrationID string, workspaceID string, message string) error {
	_, err := h.DB.Exec(ctx, `update workspace_integration set status='error', last_failure_at=now(), last_failure_message=$2, updated_at=now() where id=$1::uuid`, integrationID, message)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'intercom','oauth_failed','error',$3,'{}'::jsonb)`, workspaceID, integrationID, message)
	return err
}

func (h Handler) resolveIntercomInstall(ctx context.Context, appID string) (intercomInstallRecord, error) {
	var install intercomInstallRecord
	var metadataRaw []byte
	err := h.DB.QueryRow(ctx, `select workspace_id::text, id::text, coalesce(connected_by_user_id,''), coalesce(external_id,''), coalesce(display_name,''), coalesce(metadata,'{}'::jsonb) from workspace_integration where provider='intercom' and external_id=$1 and status in ('connected','degraded') limit 1`, appID).Scan(&install.WorkspaceID, &install.IntegrationID, &install.ConnectedBy, &install.AppID, &install.DisplayName, &metadataRaw)
	if err != nil {
		return install, err
	}
	install.Metadata = map[string]any{}
	_ = json.Unmarshal(metadataRaw, &install.Metadata)
	return install, nil
}

func (h Handler) createIntercomIssue(ctx context.Context, install intercomInstallRecord, action intercomConversationAction) (intercomIssueDescriptor, error) {
	team, err := h.intercomIssueTeam(ctx, install.WorkspaceID, action.TeamID)
	if err != nil {
		return intercomIssueDescriptor{}, err
	}
	creatorID, err := h.workspaceIssueCreator(ctx, install.WorkspaceID)
	if err != nil {
		return intercomIssueDescriptor{}, err
	}
	priority := h.workspaceCustomerRequestPriority(ctx, install.WorkspaceID)
	description := intercomIssueDescriptionHTML(action)
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return intercomIssueDescriptor{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	stateID, err := intercomIssueState(ctx, tx, team.ID, team.TriageEnabled)
	if err != nil {
		return intercomIssueDescriptor{}, err
	}
	var nextNumber int32
	if err := tx.QueryRow(ctx, `select coalesce(max(number),0)+1 from issue where team_id=$1::uuid`, team.ID).Scan(&nextNumber); err != nil {
		return intercomIssueDescriptor{}, err
	}
	identifier := fmt.Sprintf("%s-%d", team.Key, nextNumber)
	var issueID string
	if err := tx.QueryRow(ctx, `insert into issue (number,identifier,title,description,team_id,state_id,creator_id,priority) values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8) returning id::text`, nextNumber, identifier, truncateSlackText(action.Title, 500), description, team.ID, stateID, creatorID, priority).Scan(&issueID); err != nil {
		return intercomIssueDescriptor{}, err
	}
	historyRaw, _ := json.Marshal(map[string]any{"identifier": identifier, "title": action.Title, "source": "intercom_conversation", "intercom": action.safePayload(), "backlink": issueBacklink(team.Key, identifier)})
	if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,actor_name,actor_email,event_type,metadata) values ($1::uuid,$2,null,null,'created',$3::jsonb)`, issueID, creatorID, historyRaw); err != nil {
		return intercomIssueDescriptor{}, err
	}
	if err := h.upsertIntercomConversationLinkTx(ctx, tx, install, action, issueID); err != nil {
		return intercomIssueDescriptor{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return intercomIssueDescriptor{}, err
	}
	issue, err := h.intercomIssueStatus(ctx, install, action)
	if err != nil {
		return intercomIssueDescriptor{ID: issueID, Identifier: identifier, Title: action.Title, WebURL: issueBacklink(team.Key, identifier), Status: "", Assignee: ""}, nil
	}
	return issue, nil
}

func (h Handler) intercomIssueTeam(ctx context.Context, workspaceID string, preferredTeamID string) (slackIssueTeamOption, error) {
	var team slackIssueTeamOption
	var raw []byte
	if strings.TrimSpace(preferredTeamID) != "" {
		err := h.DB.QueryRow(ctx, `select id::text,key,name,coalesce(settings,'{}'::jsonb),coalesce(triage_enabled,true) from team where id=$1::uuid and workspace_id=$2::uuid and coalesce(is_private,false)=false and deleted_at is null and retired_at is null`, preferredTeamID, workspaceID).Scan(&team.ID, &team.Key, &team.Name, &raw, &team.TriageEnabled)
		if err != nil {
			return team, err
		}
		team.Settings = readJSONRecord(raw)
		return team, nil
	}
	err := h.DB.QueryRow(ctx, `select id::text,key,name,coalesce(settings,'{}'::jsonb),coalesce(triage_enabled,true) from team where workspace_id=$1::uuid and coalesce(is_private,false)=false and deleted_at is null and retired_at is null order by key asc limit 1`, workspaceID).Scan(&team.ID, &team.Key, &team.Name, &raw, &team.TriageEnabled)
	team.Settings = readJSONRecord(raw)
	return team, err
}

func intercomIssueState(ctx context.Context, q slackCreateQuerier, teamID string, triageEnabled bool) (string, error) {
	category := "backlog"
	if triageEnabled {
		category = "triage"
	}
	return slackIssueStateByCategory(ctx, q, teamID, category)
}

func (h Handler) workspaceCustomerRequestPriority(ctx context.Context, workspaceID string) string {
	var raw []byte
	if err := h.DB.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid`, workspaceID).Scan(&raw); err != nil {
		return "medium"
	}
	priority := stringValue(recordValue(recordValue(readJSONRecord(raw)["collaboration"])["customerRequests"])["defaultPriority"])
	if !validSlackPriority(priority) || priority == "none" {
		return "medium"
	}
	return priority
}

func (h Handler) findIntercomIssueForLink(ctx context.Context, workspaceID string, issueRef string) (intercomIssueDescriptor, error) {
	var issue intercomIssueDescriptor
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,ws.name,coalesce(u.name,'')
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		left join "user" u on u.id=i.assignee_id
		where t.workspace_id=$1::uuid and coalesce(t.is_private,false)=false and i.archived_at is null and (i.id::text=$2 or upper(i.identifier)=upper($2))
		limit 1`, workspaceID, strings.TrimSpace(issueRef)).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.Status, &issue.Assignee)
	if err != nil {
		return issue, err
	}
	issue.WebURL = issueBacklink(strings.Split(issue.Identifier, "-")[0], issue.Identifier)
	return issue, nil
}

func (h Handler) searchIntercomIssues(ctx context.Context, workspaceID string, query string) ([]intercomIssueDescriptor, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		query = "%"
	} else {
		query = "%" + strings.ToLower(query) + "%"
	}
	rows, err := h.DB.Query(ctx, `
		select i.id::text,i.identifier,i.title,ws.name,coalesce(u.name,'')
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		left join "user" u on u.id=i.assignee_id
		where t.workspace_id=$1::uuid and coalesce(t.is_private,false)=false and i.archived_at is null and (lower(i.title) like $2 or lower(i.identifier) like $2)
		order by i.updated_at desc
		limit 10`, workspaceID, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []intercomIssueDescriptor{}
	for rows.Next() {
		var issue intercomIssueDescriptor
		if err := rows.Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.Status, &issue.Assignee); err != nil {
			return nil, err
		}
		issue.WebURL = issueBacklink(strings.Split(issue.Identifier, "-")[0], issue.Identifier)
		out = append(out, issue)
	}
	return out, rows.Err()
}

func (h Handler) intercomIssueStatus(ctx context.Context, install intercomInstallRecord, action intercomConversationAction) (intercomIssueDescriptor, error) {
	var issue intercomIssueDescriptor
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,ws.name,coalesce(u.name,'')
		from integration_thread_link itl
		join issue i on i.id=itl.issue_id
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		left join "user" u on u.id=i.assignee_id
		where itl.workspace_integration_id=$1::uuid and itl.provider='intercom' and itl.external_channel_id=$2 and coalesce(t.is_private,false)=false
		limit 1`, install.IntegrationID, action.ConversationID).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.Status, &issue.Assignee)
	if err != nil {
		return issue, err
	}
	issue.WebURL = issueBacklink(strings.Split(issue.Identifier, "-")[0], issue.Identifier)
	return issue, nil
}

func (h Handler) upsertIntercomConversationLink(ctx context.Context, install intercomInstallRecord, action intercomConversationAction, issueID string) error {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := h.upsertIntercomConversationLinkTx(ctx, tx, install, action, issueID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h Handler) upsertIntercomConversationLinkTx(ctx context.Context, q interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, install intercomInstallRecord, action intercomConversationAction, issueID string) error {
	_, err := q.Exec(ctx, `
		insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id)
		values ($1::uuid,$2::uuid,'intercom',$3::uuid,$4,$5,$5,$5,$6,'inbound',$5)
		on conflict (workspace_integration_id, external_channel_id, external_message_ts) where workspace_integration_id is not null
		do update set issue_id=excluded.issue_id, external_permalink=excluded.external_permalink, updated_at=now()`, install.WorkspaceID, install.IntegrationID, issueID, firstNonEmpty(action.CompanyID, action.AppID), action.ConversationID, action.Permalink)
	return err
}

func (h Handler) queueIntercomNote(ctx context.Context, install intercomInstallRecord, conversationID string, body string) error {
	if conversationID == "" || body == "" {
		return nil
	}
	payload := map[string]any{"type": "conversation_note", "conversationId": conversationID, "body": body}
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at) values ($1::uuid,$2::uuid,'intercom','outbound_delivery','queued',$3::jsonb,now(),now())`, install.WorkspaceID, install.IntegrationID, raw)
	return err
}

func (h Handler) recordIntercomEvent(ctx context.Context, install intercomInstallRecord, eventType, severity, message string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'intercom',$3,$4,$5,$6::jsonb)`, install.WorkspaceID, install.IntegrationID, eventType, severity, message, raw)
	return err
}

func intercomOAuthConfig() (clientID string, clientSecret string, ok bool) {
	clientID = strings.TrimSpace(os.Getenv("AUTH_INTERCOM_ID"))
	clientSecret = strings.TrimSpace(os.Getenv("AUTH_INTERCOM_SECRET"))
	return clientID, clientSecret, clientID != "" && clientSecret != ""
}

func intercomConfigured() bool {
	clientID, clientSecret, ok := intercomOAuthConfig()
	return ok && clientID != "" && clientSecret != "" && intercomSigningSecret() != ""
}

func intercomSigningSecret() string {
	if v := strings.TrimSpace(os.Getenv("INTERCOM_SIGNING_SECRET")); v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv("AUTH_INTERCOM_SECRET"))
}

func intercomRedirectURI(appURL string) string {
	return strings.TrimRight(appURL, "/") + "/api/integrations/intercom/oauth/callback"
}

func intercomAuthorizationURL(clientID, appURL, state string) string {
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("state", state)
	values.Set("redirect_uri", intercomRedirectURI(appURL))
	return "https://app.intercom.com/oauth?" + values.Encode()
}

func intercomRedirectURL(status string, message string) string {
	values := url.Values{}
	values.Set("intercom", status)
	if strings.TrimSpace(message) != "" {
		values.Set("message", message)
	}
	return strings.TrimRight(configuredAppURL(), "/") + "/settings/integrations?" + values.Encode()
}

func intercomAPIBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("INTERCOM_API_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://api.intercom.io"
}

func exchangeIntercomOAuth(ctx context.Context, client *http.Client, clientID, clientSecret, code, redirectURI string) (intercomOAuthToken, error) {
	body, _ := json.Marshal(map[string]string{"client_id": clientID, "client_secret": clientSecret, "code": code, "grant_type": "authorization_code", "redirect_uri": redirectURI})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, intercomAPIBaseURL()+"/auth/eagle/token", bytes.NewReader(body))
	if err != nil {
		return intercomOAuthToken{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return intercomOAuthToken{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return intercomOAuthToken{}, fmt.Errorf("Intercom OAuth returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var token intercomOAuthToken
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return intercomOAuthToken{}, err
	}
	if token.AccessToken == "" {
		return intercomOAuthToken{}, fmt.Errorf("Intercom OAuth response did not include an access token")
	}
	return token, nil
}

func fetchIntercomMe(ctx context.Context, client *http.Client, accessToken string) (intercomMeResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, intercomAPIBaseURL()+"/me", nil)
	if err != nil {
		return intercomMeResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return intercomMeResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return intercomMeResponse{}, fmt.Errorf("Intercom /me returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var me intercomMeResponse
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		return intercomMeResponse{}, err
	}
	return me, nil
}

func verifyIntercomSignature(secret string, hubSignature string, intercomSignature string, body []byte) bool {
	if secret == "" {
		return false
	}
	if verifyHMACSignature(secret, hubSignature, body, "sha1") || verifyHMACSignature(secret, hubSignature, body, "sha256") {
		return true
	}
	return verifyHMACSignature(secret, intercomSignature, body, "sha256")
}

func verifyHMACSignature(secret string, signature string, body []byte, algorithm string) bool {
	signature = strings.TrimSpace(signature)
	if signature == "" {
		return false
	}
	prefix := algorithm + "="
	if strings.HasPrefix(signature, prefix) {
		signature = strings.TrimPrefix(signature, prefix)
	}
	var expected string
	switch algorithm {
	case "sha1":
		mac := hmac.New(sha1.New, []byte(secret))
		_, _ = mac.Write(body)
		expected = hex.EncodeToString(mac.Sum(nil))
	case "sha256":
		mac := hmac.New(sha256.New, []byte(secret))
		_, _ = mac.Write(body)
		expected = hex.EncodeToString(mac.Sum(nil))
	default:
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func intercomIssueDescriptionHTML(action intercomConversationAction) string {
	parts := []string{}
	if strings.TrimSpace(action.Description) != "" {
		parts = append(parts, "<p>"+strings.ReplaceAll(html.EscapeString(strings.TrimSpace(action.Description)), "\n", "<br>")+"</p>")
	}
	if action.ContactName != "" || action.ContactEmail != "" {
		parts = append(parts, "<p>Customer: "+html.EscapeString(firstNonEmpty(action.ContactName, action.ContactEmail))+"</p>")
	}
	if action.CompanyName != "" {
		parts = append(parts, "<p>Company: "+html.EscapeString(action.CompanyName)+"</p>")
	}
	if action.Permalink != "" {
		parts = append(parts, `<p><a href="`+html.EscapeString(action.Permalink)+`">View source conversation in Intercom</a></p>`)
	}
	return sanitizehtml.RichText(strings.Join(parts, ""))
}

func defaultIntercomIssueTitle(body string, conversationID string) string {
	for _, line := range strings.Split(strings.TrimSpace(body), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			return truncateSlackText(line, 120)
		}
	}
	if conversationID != "" {
		return "Intercom conversation " + conversationID
	}
	return "Intercom conversation"
}

func safeIntercomError(err error) string {
	message := err.Error()
	if strings.Contains(strings.ToLower(message), "token") || strings.Contains(strings.ToLower(message), "secret") {
		return "Intercom provider request failed."
	}
	return message
}

func firstNamedRecord(root map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		if value := recordValue(root[key]); value != nil {
			return value
		}
	}
	return nil
}

func firstArray(root map[string]any, keys ...string) []any {
	for _, key := range keys {
		if values, ok := root[key].([]any); ok {
			return values
		}
	}
	return nil
}
