package integrations

import (
	"bytes"
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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	"github.com/namuh-eng/exponential/apps/api/internal/sanitizehtml"
)

type frontSetupRequest struct {
	APIToken  string `json:"apiToken"`
	CompanyID string `json:"companyId"`
	BaseURL   string `json:"baseUrl"`
}

type frontSetupResponse struct {
	ID          string `json:"id"`
	Provider    string `json:"provider"`
	Status      string `json:"status"`
	DisplayName string `json:"displayName"`
}

type frontInstallRecord struct {
	WorkspaceID   string
	IntegrationID string
	ConnectedBy   string
	ExternalID    string
	DisplayName   string
	Metadata      map[string]any
}

type frontCredential struct {
	APIToken string `json:"apiToken"`
	BaseURL  string `json:"baseUrl"`
}

type frontConversationRef struct {
	ID           string         `json:"id"`
	Subject      string         `json:"subject"`
	Permalink    string         `json:"permalink"`
	MessageID    string         `json:"messageId"`
	InboxID      string         `json:"inboxId"`
	ContactID    string         `json:"contactId"`
	ContactEmail string         `json:"contactEmail"`
	ContactName  string         `json:"contactName"`
	AccountID    string         `json:"accountId"`
	AccountName  string         `json:"accountName"`
	Metadata     map[string]any `json:"metadata"`
}

type frontIssueActionRequest struct {
	WorkspaceSlug string               `json:"workspaceSlug"`
	CompanyID     string               `json:"companyId"`
	Query         string               `json:"query"`
	IssueID       string               `json:"issueId"`
	Identifier    string               `json:"identifier"`
	Title         string               `json:"title"`
	Description   string               `json:"description"`
	TeamID        string               `json:"teamId"`
	TeamKey       string               `json:"teamKey"`
	Priority      string               `json:"priority"`
	Conversation  frontConversationRef `json:"conversation"`
	Raw           map[string]any       `json:"-"`
}

type frontIssueActionResponse struct {
	ID         string  `json:"id"`
	Identifier string  `json:"identifier"`
	Title      string  `json:"title"`
	Status     string  `json:"status"`
	Assignee   *string `json:"assignee"`
	WebURL     string  `json:"webUrl"`
}

type frontIssueSearchResponse struct {
	Issues []frontIssueActionResponse `json:"issues"`
}

type frontIssueRow struct {
	ID         string
	Identifier string
	Title      string
	TeamKey    string
	StateName  string
	Assignee   *string
}

func (h Handler) FrontSetup(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	var input frontSetupRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	input.APIToken = strings.TrimSpace(input.APIToken)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	baseURL := frontAPIBaseURL(input.BaseURL)
	if input.APIToken == "" {
		problem.Write(w, http.StatusBadRequest, "Front API token is required", "")
		return
	}
	if err := validateFrontToken(r.Context(), http.DefaultClient, baseURL, input.APIToken); err != nil {
		problem.Write(w, http.StatusBadGateway, "Front token validation failed", err.Error())
		return
	}
	id, err := h.completeFrontInstall(r.Context(), p.WorkspaceID, p.UserID, input.CompanyID, baseURL, input.APIToken)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Connect Front failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, frontSetupResponse{ID: id, Provider: "front", Status: "connected", DisplayName: frontDisplayName(input.CompanyID)})
}

func (h Handler) FrontDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if err := h.revokeProvider(r.Context(), p.WorkspaceID, "front", p.UserID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect Front failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) FrontIssueSearch(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.frontSignedAction(w, r)
	if !ok {
		return
	}
	query := strings.TrimSpace(input.Query)
	if query == "" {
		problem.JSON(w, http.StatusOK, frontIssueSearchResponse{Issues: []frontIssueActionResponse{}})
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		select i.id::text,i.identifier,i.title,t.key,ws.name,case when u.id is null then null else coalesce(u.name,u.email) end
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		left join "user" u on u.id=i.assignee_id
		where t.workspace_id=$1::uuid
			and t.deleted_at is null
			and i.archived_at is null
			and coalesce(t.is_private,false)=false
			and (i.identifier ilike $2 or i.title ilike $2)
		order by i.updated_at desc
		limit 10`, install.WorkspaceID, "%"+escapeSentryLike(query)+"%")
	if err != nil {
		_ = h.recordFrontEvent(r.Context(), install, "issue_search_failed", "error", err.Error(), input.Raw)
		problem.Write(w, http.StatusInternalServerError, "Search Front linkable issues failed", err.Error())
		return
	}
	defer rows.Close()
	out := []frontIssueActionResponse{}
	for rows.Next() {
		var issue frontIssueRow
		if err := rows.Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey, &issue.StateName, &issue.Assignee); err != nil {
			problem.Write(w, http.StatusInternalServerError, "Search Front linkable issues failed", err.Error())
			return
		}
		out = append(out, frontIssueResponse(issue))
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Search Front linkable issues failed", err.Error())
		return
	}
	_ = h.recordFrontEvent(r.Context(), install, "issue_search_succeeded", "info", "Front issue search completed.", map[string]any{"query": query, "count": len(out)})
	problem.JSON(w, http.StatusOK, frontIssueSearchResponse{Issues: out})
}

func (h Handler) FrontIssueLink(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.frontSignedAction(w, r)
	if !ok {
		return
	}
	if strings.TrimSpace(input.Conversation.ID) == "" {
		problem.Write(w, http.StatusBadRequest, "Front conversation id is required", "")
		return
	}
	issue, err := h.frontIssueForLink(r.Context(), install.WorkspaceID, firstNonEmpty(input.IssueID, input.Identifier))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Front conversation failed", err.Error())
		return
	}
	if err := h.insertFrontIssueLink(r.Context(), install, issue.ID, input.Conversation, false); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Front conversation failed", err.Error())
		return
	}
	_ = h.recordFrontEvent(r.Context(), install, "issue_linked", "info", "Front conversation linked to Exponential issue.", map[string]any{"issueId": issue.ID, "conversationId": input.Conversation.ID})
	problem.JSON(w, http.StatusOK, frontIssueResponse(issue))
}

func (h Handler) FrontIssueCreate(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.frontSignedAction(w, r)
	if !ok {
		return
	}
	if existing, err := h.frontIssueForCreatedConversation(r.Context(), install.IntegrationID, input.Conversation.ID); err == nil {
		problem.JSON(w, http.StatusOK, frontIssueResponse(existing))
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusInternalServerError, "Create issue from Front failed", err.Error())
		return
	}
	issue, err := h.createFrontIssue(r.Context(), install, input)
	if err != nil {
		_ = h.recordFrontEvent(r.Context(), install, "issue_creation_failed", "error", err.Error(), input.Raw)
		problem.Write(w, http.StatusBadRequest, "Create issue from Front failed", err.Error())
		return
	}
	_ = h.recordFrontEvent(r.Context(), install, "issue_created", "info", "Front conversation created an Exponential issue.", map[string]any{"issueId": issue.ID, "conversationId": input.Conversation.ID})
	problem.JSON(w, http.StatusOK, frontIssueResponse(issue))
}

func (h Handler) FrontIssueUnlink(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.frontSignedAction(w, r)
	if !ok {
		return
	}
	conversationID := strings.TrimSpace(input.Conversation.ID)
	requested := firstNonEmpty(input.IssueID, input.Identifier)
	if conversationID == "" || requested == "" {
		problem.Write(w, http.StatusBadRequest, "Front conversation id and issue id are required", "")
		return
	}
	issue, err := h.frontIssueForLink(r.Context(), install.WorkspaceID, requested)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Unlink Front conversation failed", err.Error())
		return
	}
	_, err = h.DB.Exec(r.Context(), `delete from integration_thread_link where workspace_integration_id=$1::uuid and provider='front' and issue_id=$2::uuid and external_thread_ts=$3`, install.IntegrationID, issue.ID, conversationID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Unlink Front conversation failed", err.Error())
		return
	}
	_ = h.recordFrontEvent(r.Context(), install, "issue_unlinked", "info", "Front conversation unlinked from Exponential issue.", map[string]any{"issueId": issue.ID, "conversationId": conversationID})
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) completeFrontInstall(ctx context.Context, workspaceID string, userID string, companyID string, baseURL string, token string) (string, error) {
	now := time.Now().UTC()
	metadata := map[string]any{"companyId": companyID, "baseUrl": baseURL, "reopenOnDone": true, "connectedBy": "front_setup"}
	metadataRaw, _ := json.Marshal(metadata)
	credential := frontCredential{APIToken: token, BaseURL: baseURL}
	credentialRaw, _ := json.Marshal(credential)
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var integrationID string
	if err := tx.QueryRow(ctx, `
		insert into workspace_integration (workspace_id, provider, status, external_id, display_name, metadata, connected_by_user_id, connected_at, last_event_at, last_success_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'front', 'connected', $2, $3, $4::jsonb, $5, $6, $6, $6, null, null, null, $6)
		on conflict (workspace_id, provider) do update set
			status='connected', external_id=excluded.external_id, display_name=excluded.display_name, metadata=excluded.metadata,
			connected_by_user_id=excluded.connected_by_user_id, connected_at=coalesce(workspace_integration.connected_at, excluded.connected_at),
			last_event_at=excluded.last_event_at, last_success_at=excluded.last_success_at, last_failure_at=null, last_failure_message=null,
			credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=excluded.updated_at
		returning id::text`, workspaceID, nullString(companyID), frontDisplayName(companyID), metadataRaw, userID, now).Scan(&integrationID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at,$2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, integrationID, now); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid,'front',$2,$3::jsonb,$4,$5,$5)`, integrationID, credentialRaw, metadataRaw, userID, now); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'front','token_validated','info','Front integration connected.',$3::jsonb,$4)`, workspaceID, integrationID, metadataRaw, now); err != nil {
		return "", err
	}
	return integrationID, tx.Commit(ctx)
}

func (h Handler) frontSignedAction(w http.ResponseWriter, r *http.Request) (frontInstallRecord, frontIssueActionRequest, bool) {
	secret := strings.TrimSpace(os.Getenv("FRONT_APP_SECRET"))
	if secret == "" {
		problem.Write(w, http.StatusServiceUnavailable, "Front app secret is not configured", "")
		return frontInstallRecord{}, frontIssueActionRequest{}, false
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Front request body could not be read", err.Error())
		return frontInstallRecord{}, frontIssueActionRequest{}, false
	}
	if !verifyFrontSignature(secret, r.Header.Get("X-Front-Signature"), body) {
		problem.Write(w, http.StatusUnauthorized, "Invalid Front signature", "")
		return frontInstallRecord{}, frontIssueActionRequest{}, false
	}
	var input frontIssueActionRequest
	if err := json.Unmarshal(body, &input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Front payload is invalid", err.Error())
		return frontInstallRecord{}, frontIssueActionRequest{}, false
	}
	var raw map[string]any
	_ = json.Unmarshal(body, &raw)
	input.Raw = raw
	input.normalize()
	install, err := h.resolveFrontInstall(r.Context(), input)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Front integration is not connected", "")
		return frontInstallRecord{}, frontIssueActionRequest{}, false
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Front integration could not be resolved", err.Error())
		return frontInstallRecord{}, frontIssueActionRequest{}, false
	}
	return install, input, true
}

func (input *frontIssueActionRequest) normalize() {
	input.WorkspaceSlug = strings.TrimSpace(input.WorkspaceSlug)
	input.CompanyID = strings.TrimSpace(input.CompanyID)
	input.Query = strings.TrimSpace(input.Query)
	input.IssueID = strings.TrimSpace(input.IssueID)
	input.Identifier = strings.ToUpper(strings.TrimSpace(input.Identifier))
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.TeamID = strings.TrimSpace(input.TeamID)
	input.TeamKey = strings.TrimSpace(input.TeamKey)
	input.Priority = strings.TrimSpace(input.Priority)
	input.Conversation.ID = strings.TrimSpace(input.Conversation.ID)
	input.Conversation.Subject = strings.TrimSpace(input.Conversation.Subject)
	input.Conversation.Permalink = strings.TrimSpace(input.Conversation.Permalink)
	input.Conversation.MessageID = strings.TrimSpace(input.Conversation.MessageID)
	input.Conversation.InboxID = strings.TrimSpace(input.Conversation.InboxID)
	input.Conversation.ContactID = strings.TrimSpace(input.Conversation.ContactID)
	input.Conversation.ContactEmail = strings.ToLower(strings.TrimSpace(input.Conversation.ContactEmail))
	input.Conversation.ContactName = strings.TrimSpace(input.Conversation.ContactName)
	input.Conversation.AccountID = strings.TrimSpace(input.Conversation.AccountID)
	input.Conversation.AccountName = strings.TrimSpace(input.Conversation.AccountName)
}

func (h Handler) resolveFrontInstall(ctx context.Context, input frontIssueActionRequest) (frontInstallRecord, error) {
	args := []any{}
	where := "wi.provider='front' and wi.status in ('connected','degraded')"
	join := ""
	if input.WorkspaceSlug != "" {
		args = append(args, input.WorkspaceSlug)
		join = " join workspace w on w.id=wi.workspace_id"
		where += " and w.url_slug=$1"
	} else if input.CompanyID != "" {
		args = append(args, input.CompanyID)
		where += " and (wi.external_id=$1 or wi.metadata->>'companyId'=$1)"
	} else {
		return frontInstallRecord{}, pgx.ErrNoRows
	}
	var install frontInstallRecord
	var metadataRaw []byte
	err := h.DB.QueryRow(ctx, `select wi.workspace_id::text,wi.id::text,coalesce(wi.connected_by_user_id,''),coalesce(wi.external_id,''),coalesce(wi.display_name,''),coalesce(wi.metadata,'{}'::jsonb) from workspace_integration wi`+join+` where `+where+` order by wi.connected_at desc limit 1`, args...).Scan(&install.WorkspaceID, &install.IntegrationID, &install.ConnectedBy, &install.ExternalID, &install.DisplayName, &metadataRaw)
	if err != nil {
		return install, err
	}
	install.Metadata = readJSONRecord(metadataRaw)
	return install, nil
}

func (h Handler) frontIssueForLink(ctx context.Context, workspaceID, requested string) (frontIssueRow, error) {
	var issue frontIssueRow
	requested = strings.TrimSpace(requested)
	where := "upper(i.identifier)=upper($2)"
	if isUUIDish(requested) {
		where = "(i.id=$2::uuid or upper(i.identifier)=upper($2))"
	}
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,t.key,ws.name,case when u.id is null then null else coalesce(u.name,u.email) end
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		left join "user" u on u.id=i.assignee_id
		where t.workspace_id=$1::uuid
			and coalesce(t.is_private,false)=false
			and i.archived_at is null
			and `+where+`
		limit 1`, workspaceID, requested).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey, &issue.StateName, &issue.Assignee)
	return issue, err
}

func (h Handler) frontIssueForCreatedConversation(ctx context.Context, integrationID, conversationID string) (frontIssueRow, error) {
	var issue frontIssueRow
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,t.key,ws.name,case when u.id is null then null else coalesce(u.name,u.email) end
		from integration_thread_link itl
		join issue i on i.id=itl.issue_id
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		left join "user" u on u.id=i.assignee_id
		where itl.workspace_integration_id=$1::uuid and itl.provider='front' and itl.source_event_id=$2
		limit 1`, integrationID, frontCreatedSourceEventID(conversationID)).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey, &issue.StateName, &issue.Assignee)
	return issue, err
}

func (h Handler) createFrontIssue(ctx context.Context, install frontInstallRecord, input frontIssueActionRequest) (frontIssueRow, error) {
	if input.Conversation.ID == "" {
		return frontIssueRow{}, fmt.Errorf("Front conversation id is required")
	}
	title := strings.TrimSpace(firstNonEmpty(input.Title, input.Conversation.Subject))
	if title == "" {
		return frontIssueRow{}, fmt.Errorf("title is required")
	}
	priority := sentryPriority(input.Priority)
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return frontIssueRow{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	team, err := h.sentryPublicTeam(ctx, tx, install.WorkspaceID, input.TeamID, input.TeamKey)
	if err != nil {
		return frontIssueRow{}, err
	}
	stateID, err := slackIssueStateByCategory(ctx, tx, team.ID, "backlog")
	if err != nil {
		return frontIssueRow{}, err
	}
	creatorID := install.ConnectedBy
	if creatorID == "" {
		creatorID, err = h.workspaceIssueCreator(ctx, install.WorkspaceID)
		if err != nil {
			return frontIssueRow{}, err
		}
	}
	var nextNumber int32
	if err := tx.QueryRow(ctx, `select coalesce(max(number),0)+1 from issue where team_id=$1::uuid`, team.ID).Scan(&nextNumber); err != nil {
		return frontIssueRow{}, err
	}
	identifier := fmt.Sprintf("%s-%d", team.Key, nextNumber)
	description := frontIssueDescriptionHTML(input.Description, input.Conversation)
	var issueID string
	if err := tx.QueryRow(ctx, `
		insert into issue (number,identifier,title,description,team_id,state_id,creator_id,priority)
		values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8)
		returning id::text`, nextNumber, identifier, title, description, team.ID, stateID, creatorID, priority).Scan(&issueID); err != nil {
		return frontIssueRow{}, err
	}
	history := map[string]any{"identifier": identifier, "title": title, "teamId": team.ID, "source": "front_conversation", "front": frontHistoryMetadata(input.Conversation)}
	historyRaw, _ := json.Marshal(history)
	if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,actor_name,actor_email,event_type,metadata) values ($1::uuid,$2,'Front',null,'created',$3::jsonb)`, issueID, nullString(creatorID), historyRaw); err != nil {
		return frontIssueRow{}, err
	}
	if err := insertFrontIssueLinkTx(ctx, tx, install, issueID, input.Conversation, true); err != nil {
		return frontIssueRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return frontIssueRow{}, err
	}
	return frontIssueRow{ID: issueID, Identifier: identifier, Title: title, TeamKey: team.Key, StateName: "Backlog"}, nil
}

func (h Handler) insertFrontIssueLink(ctx context.Context, install frontInstallRecord, issueID string, conversation frontConversationRef, created bool) error {
	return insertFrontIssueLinkTx(ctx, h.DB, install, issueID, conversation, created)
}

type frontLinkExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func insertFrontIssueLinkTx(ctx context.Context, q frontLinkExecutor, install frontInstallRecord, issueID string, conversation frontConversationRef, created bool) error {
	conversationID := strings.TrimSpace(conversation.ID)
	if conversationID == "" {
		return fmt.Errorf("Front conversation id is required")
	}
	channelID := firstNonEmpty(conversation.InboxID, conversationID)
	messageID := firstNonEmpty(issueID, conversation.MessageID, conversationID)
	sourceEventID := conversationID + ":" + issueID
	if created {
		sourceEventID = frontCreatedSourceEventID(conversationID)
		messageID = firstNonEmpty(conversation.MessageID, "created:"+conversationID)
	}
	_, err := q.Exec(ctx, `
		insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id)
		values ($1::uuid,$2::uuid,'front',$3::uuid,$4,$5,$6,$7,$8,'inbound',$9)
		on conflict (workspace_integration_id, source_event_id) where workspace_integration_id is not null and source_event_id is not null
		do update set issue_id=excluded.issue_id, external_permalink=excluded.external_permalink, updated_at=now()`, install.WorkspaceID, install.IntegrationID, issueID, firstNonEmpty(install.ExternalID, stringValue(install.Metadata["companyId"])), channelID, conversationID, messageID, conversation.Permalink, sourceEventID)
	return err
}

func frontCreatedSourceEventID(conversationID string) string { return "created:" + strings.TrimSpace(conversationID) }

func frontHistoryMetadata(conversation frontConversationRef) map[string]any {
	return map[string]any{
		"conversationId": conversation.ID,
		"messageId":      conversation.MessageID,
		"inboxId":        conversation.InboxID,
		"permalink":      conversation.Permalink,
		"contact": map[string]any{
			"id":    conversation.ContactID,
			"email": conversation.ContactEmail,
			"name":  conversation.ContactName,
		},
		"account": map[string]any{
			"id":   conversation.AccountID,
			"name": conversation.AccountName,
		},
	}
}

func frontIssueDescriptionHTML(description string, conversation frontConversationRef) string {
	description = strings.TrimSpace(description)
	if strings.Contains(description, "<") {
		description = sanitizehtml.RichText(description)
	} else if description != "" {
		description = "<p>" + htmlEscapeParagraph(description) + "</p>"
	}
	if conversation.Permalink == "" {
		return description
	}
	link := `<p><a href="` + htmlEscapeAttribute(conversation.Permalink) + `">View source conversation in Front</a></p>`
	return sanitizehtml.RichText(description + link)
}

func frontIssueResponse(issue frontIssueRow) frontIssueActionResponse {
	return frontIssueActionResponse{ID: issue.ID, Identifier: issue.Identifier, Title: issue.Title, Status: issue.StateName, Assignee: issue.Assignee, WebURL: issueBacklink(issue.TeamKey, issue.Identifier)}
}

func (h Handler) recordFrontEvent(ctx context.Context, install frontInstallRecord, eventType string, severity string, message string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'front',$3,$4,$5,$6::jsonb)`, install.WorkspaceID, install.IntegrationID, eventType, severity, message, raw)
	return err
}

func verifyFrontSignature(secret string, signature string, body []byte) bool {
	secret = strings.TrimSpace(secret)
	signature = strings.TrimSpace(signature)
	if secret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	signature = strings.TrimPrefix(signature, "sha256=")
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func frontAPIBaseURL(value string) string {
	baseURL := strings.TrimRight(strings.TrimSpace(value), "/")
	if baseURL == "" {
		baseURL = strings.TrimRight(strings.TrimSpace(os.Getenv("FRONT_API_BASE_URL")), "/")
	}
	if baseURL == "" {
		baseURL = "https://api2.frontapp.com"
	}
	return baseURL
}

func validateFrontToken(ctx context.Context, client *http.Client, baseURL string, token string) error {
	endpoint, err := url.JoinPath(baseURL, "/teammates")
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("Front API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func frontDisplayName(companyID string) string {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return "Front"
	}
	return "Front " + companyID
}

func postFrontJSON(ctx context.Context, client *http.Client, credential frontCredential, method string, path string, body any) error {
	baseURL := frontAPIBaseURL(credential.BaseURL)
	endpoint, err := url.JoinPath(baseURL, path)
	if err != nil {
		return err
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+credential.APIToken)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusNoContent || (resp.StatusCode >= 200 && resp.StatusCode < 300) {
		return nil
	}
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return fmt.Errorf("Front API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
}
