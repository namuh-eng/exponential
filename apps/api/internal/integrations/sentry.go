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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	"github.com/namuh-eng/exponential/apps/api/internal/sanitizehtml"
)

type sentryConnectResponse = slackConnectResponse

type sentryOAuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	Scope        string `json:"scope"`
}

type sentryOrganization struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type sentryOAuthInstall struct {
	ID          string
	WorkspaceID string
	UserID      string
	Metadata    map[string]any
}

type sentryInstallRecord struct {
	WorkspaceID   string
	IntegrationID string
	ConnectedBy   string
	ExternalID    string
	DisplayName   string
	Metadata      map[string]any
}

type sentryIssueRef struct {
	ID      string
	ShortID string
	Title   string
	WebURL  string
	Project sentryProjectRef
}

type sentryProjectRef struct {
	ID   string
	Slug string
	Name string
}

type sentryIssueActionRequest struct {
	Query         string
	IssueID       string
	Identifier    string
	Title         string
	Description   string
	TeamID        string
	TeamKey       string
	AssigneeEmail string
	Priority      string
	SentryIssue   sentryIssueRef
	Raw           map[string]any
}

type sentryIssueActionResponse struct {
	WebURL     string `json:"webUrl"`
	Project    string `json:"project"`
	Identifier string `json:"identifier"`
}

type sentryIssueSearchResponse struct {
	Issues []sentryIssueActionResponse `json:"issues"`
}

func (h Handler) SentryConnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	clientID, _, ok := sentryOAuthConfig()
	if !ok {
		problem.JSON(w, http.StatusPreconditionFailed, map[string]string{"error": "Sentry OAuth is not configured", "message": "Add AUTH_SENTRY_ID and AUTH_SENTRY_SECRET to enable Sentry installation for this workspace."})
		return
	}
	state, err := randomState()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Sentry authorization failed", err.Error())
		return
	}
	workspaceSlug, err := h.workspaceSlug(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Sentry authorization failed", err.Error())
		return
	}
	if err := h.saveSentryOAuthState(r.Context(), p.WorkspaceID, p.UserID, state); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Sentry authorization failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, sentryConnectResponse{AuthorizationURL: sentryAuthorizationURL(clientID, configuredAppURL(), state), State: state, WorkspaceSlug: workspaceSlug})
}

func (h Handler) SentryDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if err := h.disconnectProvider(r.Context(), p.WorkspaceID, p.UserID, "sentry"); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect Sentry failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) SentryOAuthCallback(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if sentryError := strings.TrimSpace(r.URL.Query().Get("error")); sentryError != "" {
		http.Redirect(w, r, sentryRedirectURL("error", sentryError), http.StatusFound)
		return
	}
	if code == "" || state == "" {
		problem.Write(w, http.StatusBadRequest, "Sentry OAuth callback is missing code or state", "")
		return
	}
	clientID, clientSecret, ok := sentryOAuthConfig()
	if !ok {
		problem.Write(w, http.StatusServiceUnavailable, "Sentry OAuth is not configured", "")
		return
	}
	install, err := h.findSentryOAuthInstall(r.Context(), state)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusBadRequest, "Invalid Sentry OAuth state", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Sentry OAuth callback failed", err.Error())
		return
	}
	token, err := exchangeSentryOAuth(r.Context(), http.DefaultClient, clientID, clientSecret, code, sentryRedirectURI(configuredAppURL()))
	if err != nil {
		_ = h.recordSentryInstallFailure(r.Context(), install.ID, install.WorkspaceID, err.Error())
		problem.Write(w, http.StatusBadGateway, "Sentry OAuth exchange failed", err.Error())
		return
	}
	org, err := fetchSentryOrganization(r.Context(), http.DefaultClient, token.AccessToken)
	if err != nil {
		_ = h.recordSentryInstallFailure(r.Context(), install.ID, install.WorkspaceID, err.Error())
		problem.Write(w, http.StatusBadGateway, "Sentry organization lookup failed", err.Error())
		return
	}
	if err := h.completeSentryInstall(r.Context(), install, token, org); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Sentry OAuth callback failed", err.Error())
		return
	}
	http.Redirect(w, r, sentryRedirectURL("connected", ""), http.StatusFound)
}

func (h Handler) SentryIssueSearch(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.sentrySignedAction(w, r)
	if !ok {
		return
	}
	query := strings.TrimSpace(input.Query)
	if query == "" {
		problem.JSON(w, http.StatusOK, sentryIssueSearchResponse{Issues: []sentryIssueActionResponse{}})
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		select i.identifier,i.title,t.key
		from issue i
		join team t on t.id=i.team_id
		where t.workspace_id=$1::uuid
			and t.deleted_at is null
			and i.archived_at is null
			and coalesce(t.is_private,false)=false
			and (i.identifier ilike $2 or i.title ilike $2)
		order by i.updated_at desc
		limit 10`, install.WorkspaceID, "%"+escapeSentryLike(query)+"%")
	if err != nil {
		_ = h.recordSentryEvent(r.Context(), install, "issue_search_failed", "error", err.Error(), input.Raw)
		problem.Write(w, http.StatusInternalServerError, "Search issues failed", err.Error())
		return
	}
	defer rows.Close()
	out := []sentryIssueActionResponse{}
	for rows.Next() {
		var identifier, title, teamKey string
		if err := rows.Scan(&identifier, &title, &teamKey); err != nil {
			problem.Write(w, http.StatusInternalServerError, "Search issues failed", err.Error())
			return
		}
		out = append(out, sentryIssueActionResponse{WebURL: issueBacklink(teamKey, identifier), Project: teamKey, Identifier: identifier + " · " + title})
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Search issues failed", err.Error())
		return
	}
	_ = h.recordSentryEvent(r.Context(), install, "issue_search_succeeded", "info", "Sentry issue search completed.", map[string]any{"query": query, "count": len(out)})
	problem.JSON(w, http.StatusOK, sentryIssueSearchResponse{Issues: out})
}

func (h Handler) SentryIssueLink(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.sentrySignedAction(w, r)
	if !ok {
		return
	}
	issue, err := h.sentryIssueForLink(r.Context(), install.WorkspaceID, firstNonEmpty(input.IssueID, input.Identifier))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Sentry issue failed", err.Error())
		return
	}
	if err := h.insertSentryIssueLink(r.Context(), install, issue.ID, input.SentryIssue); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Sentry issue failed", err.Error())
		return
	}
	_ = h.recordSentryEvent(r.Context(), install, "issue_linked", "info", "Sentry issue linked to Exponential issue.", map[string]any{"issueId": issue.ID, "sentryIssueId": input.SentryIssue.ID})
	problem.JSON(w, http.StatusOK, sentryIssueActionResponse{WebURL: issueBacklink(issue.TeamKey, issue.Identifier), Project: issue.TeamKey, Identifier: issue.Identifier})
}

func (h Handler) SentryIssueCreate(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.sentrySignedAction(w, r)
	if !ok {
		return
	}
	if existing, err := h.sentryIssueForSource(r.Context(), install.IntegrationID, input.SentryIssue.ID); err == nil {
		problem.JSON(w, http.StatusOK, sentryIssueActionResponse{WebURL: issueBacklink(existing.TeamKey, existing.Identifier), Project: existing.TeamKey, Identifier: existing.Identifier})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusInternalServerError, "Create Sentry issue failed", err.Error())
		return
	}
	issue, err := h.createSentryIssue(r.Context(), install, input)
	if err != nil {
		_ = h.recordSentryEvent(r.Context(), install, "issue_creation_failed", "error", err.Error(), input.Raw)
		problem.Write(w, http.StatusBadRequest, "Create Sentry issue failed", err.Error())
		return
	}
	_ = h.recordSentryEvent(r.Context(), install, "issue_created", "info", "Sentry issue created an Exponential issue.", map[string]any{"issueId": issue.ID, "sentryIssueId": input.SentryIssue.ID})
	problem.JSON(w, http.StatusOK, sentryIssueActionResponse{WebURL: issueBacklink(issue.TeamKey, issue.Identifier), Project: issue.TeamKey, Identifier: issue.Identifier})
}

func (h Handler) sentrySignedAction(w http.ResponseWriter, r *http.Request) (sentryInstallRecord, sentryIssueActionRequest, bool) {
	secret := sentryWebhookSecret()
	if secret == "" {
		problem.Write(w, http.StatusServiceUnavailable, "Sentry webhook secret is not configured", "")
		return sentryInstallRecord{}, sentryIssueActionRequest{}, false
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Sentry request body could not be read", err.Error())
		return sentryInstallRecord{}, sentryIssueActionRequest{}, false
	}
	if !verifySentrySignature(secret, r.Header.Get("Sentry-Hook-Signature"), body) {
		problem.Write(w, http.StatusUnauthorized, "Invalid Sentry signature", "")
		return sentryInstallRecord{}, sentryIssueActionRequest{}, false
	}
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		problem.Write(w, http.StatusBadRequest, "Sentry payload is invalid", err.Error())
		return sentryInstallRecord{}, sentryIssueActionRequest{}, false
	}
	input := sentryIssueActionFromPayload(raw)
	install, err := h.resolveSentryInstall(r.Context(), input)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Sentry integration is not connected", "")
		return sentryInstallRecord{}, sentryIssueActionRequest{}, false
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Sentry integration could not be resolved", err.Error())
		return sentryInstallRecord{}, sentryIssueActionRequest{}, false
	}
	return install, input, true
}

func sentryIssueActionFromPayload(raw map[string]any) sentryIssueActionRequest {
	data := recordValue(raw["data"])
	if data == nil {
		data = raw
	}
	issueRecord := firstRecord(raw["issue"], data["issue"], raw["sentryIssue"], data["sentryIssue"], raw["event"], data["event"])
	projectRecord := firstRecord(raw["project"], data["project"], issueRecord["project"])
	webURL := firstNonEmpty(stringValue(raw["webUrl"]), stringValue(raw["web_url"]), stringValue(raw["url"]), stringValue(data["webUrl"]), stringValue(data["web_url"]), stringValue(data["url"]), stringValue(issueRecord["web_url"]), stringValue(issueRecord["permalink"]), stringValue(issueRecord["url"]))
	issueID := firstNonEmpty(stringValue(raw["sentryIssueId"]), stringValue(raw["sentry_issue_id"]), stringValue(raw["issueId"]), stringValue(data["sentryIssueId"]), stringValue(data["sentry_issue_id"]), stringValue(data["issueId"]), stringValue(issueRecord["id"]), stringValue(issueRecord["issue_id"]))
	project := sentryProjectRef{ID: firstNonEmpty(stringValue(projectRecord["id"]), stringValue(raw["projectId"]), stringValue(data["projectId"])), Slug: firstNonEmpty(stringValue(projectRecord["slug"]), stringValue(projectRecord["name"]), stringValue(raw["project"]), stringValue(data["project"])), Name: firstNonEmpty(stringValue(projectRecord["name"]), stringValue(projectRecord["slug"]))}
	return sentryIssueActionRequest{
		Query:         firstNonEmpty(stringValue(raw["query"]), stringValue(raw["q"]), stringValue(data["query"]), stringValue(data["q"])),
		IssueID:       firstNonEmpty(stringValue(raw["exponentialIssueId"]), stringValue(raw["issueIdentifier"]), stringValue(raw["identifier"]), stringValue(data["exponentialIssueId"]), stringValue(data["issueIdentifier"]), stringValue(data["identifier"])),
		Identifier:    firstNonEmpty(stringValue(raw["identifier"]), stringValue(data["identifier"])),
		Title:         firstNonEmpty(stringValue(raw["title"]), stringValue(data["title"]), stringValue(issueRecord["title"]), stringValue(issueRecord["short_id"])),
		Description:   firstNonEmpty(stringValue(raw["description"]), stringValue(data["description"]), stringValue(issueRecord["culprit"]), stringValue(issueRecord["metadata"])),
		TeamID:        firstNonEmpty(stringValue(raw["teamId"]), stringValue(raw["team_id"]), stringValue(data["teamId"]), stringValue(data["team_id"])),
		TeamKey:       firstNonEmpty(stringValue(raw["teamKey"]), stringValue(raw["team"]), stringValue(data["teamKey"]), stringValue(data["team"])),
		AssigneeEmail: strings.ToLower(firstNonEmpty(stringValue(raw["assigneeEmail"]), stringValue(raw["assignee_email"]), stringValue(data["assigneeEmail"]), stringValue(data["assignee_email"]))),
		Priority:      firstNonEmpty(stringValue(raw["priority"]), stringValue(data["priority"])),
		SentryIssue:   sentryIssueRef{ID: issueID, ShortID: firstNonEmpty(stringValue(issueRecord["short_id"]), stringValue(raw["sentryShortId"]), stringValue(data["sentryShortId"])), Title: firstNonEmpty(stringValue(issueRecord["title"]), stringValue(raw["sentryTitle"]), stringValue(data["sentryTitle"])), WebURL: webURL, Project: project},
		Raw:           raw,
	}
}

func firstRecord(values ...any) map[string]any {
	for _, value := range values {
		if record := recordValue(value); record != nil {
			return record
		}
	}
	return map[string]any{}
}

func (h Handler) resolveSentryInstall(ctx context.Context, input sentryIssueActionRequest) (sentryInstallRecord, error) {
	org := sentryOrgID(input.Raw)
	args := []any{}
	where := "wi.provider='sentry' and wi.status in ('connected','degraded')"
	if org != "" {
		args = append(args, org)
		where += " and (wi.external_id=$1 or wi.metadata->>'orgSlug'=$1 or wi.metadata->>'organizationSlug'=$1 or wi.metadata->>'installationId'=$1)"
	}
	var install sentryInstallRecord
	var metadataRaw []byte
	err := h.DB.QueryRow(ctx, `select wi.workspace_id::text,wi.id::text,coalesce(wi.connected_by_user_id,''),coalesce(wi.external_id,''),coalesce(wi.display_name,''),coalesce(wi.metadata,'{}'::jsonb) from workspace_integration wi where `+where+` order by wi.connected_at desc limit 1`, args...).Scan(&install.WorkspaceID, &install.IntegrationID, &install.ConnectedBy, &install.ExternalID, &install.DisplayName, &metadataRaw)
	if err != nil {
		return install, err
	}
	install.Metadata = readJSONRecord(metadataRaw)
	return install, nil
}

func sentryOrgID(raw map[string]any) string {
	org := firstRecord(raw["organization"], recordValue(raw["data"])["organization"])
	install := firstRecord(raw["installation"], recordValue(raw["data"])["installation"])
	return firstNonEmpty(stringValue(org["id"]), stringValue(org["slug"]), stringValue(raw["organization"]), stringValue(raw["orgSlug"]), stringValue(install["uuid"]), stringValue(install["id"]))
}

type sentryIssueRow struct {
	ID         string
	Identifier string
	Title      string
	TeamKey    string
}

func (h Handler) sentryIssueForLink(ctx context.Context, workspaceID, requested string) (sentryIssueRow, error) {
	var issue sentryIssueRow
	requested = strings.TrimSpace(requested)
	where := "upper(i.identifier)=upper($2)"
	if isUUIDish(requested) {
		where = "(i.id=$2::uuid or upper(i.identifier)=upper($2))"
	}
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,t.key
		from issue i
		join team t on t.id=i.team_id
		where t.workspace_id=$1::uuid
			and coalesce(t.is_private,false)=false
			and i.archived_at is null
			and `+where+`
		limit 1`, workspaceID, requested).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey)
	return issue, err
}

func (h Handler) sentryIssueForSource(ctx context.Context, integrationID, sourceEventID string) (sentryIssueRow, error) {
	var issue sentryIssueRow
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,t.key
		from integration_thread_link itl
		join issue i on i.id=itl.issue_id
		join team t on t.id=i.team_id
		where itl.workspace_integration_id=$1::uuid and itl.provider='sentry' and itl.source_event_id=$2
		limit 1`, integrationID, sourceEventID).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey)
	return issue, err
}

func (h Handler) createSentryIssue(ctx context.Context, install sentryInstallRecord, input sentryIssueActionRequest) (sentryIssueRow, error) {
	if strings.TrimSpace(input.SentryIssue.ID) == "" {
		return sentryIssueRow{}, fmt.Errorf("Sentry issue id is required")
	}
	title := strings.TrimSpace(firstNonEmpty(input.Title, input.SentryIssue.Title, input.SentryIssue.ShortID))
	if title == "" {
		return sentryIssueRow{}, fmt.Errorf("title is required")
	}
	priority := sentryPriority(input.Priority)
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return sentryIssueRow{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	team, err := h.sentryPublicTeam(ctx, tx, install.WorkspaceID, input.TeamID, input.TeamKey)
	if err != nil {
		return sentryIssueRow{}, err
	}
	stateID, err := slackIssueStateByCategory(ctx, tx, team.ID, "backlog")
	if err != nil {
		return sentryIssueRow{}, err
	}
	creatorID := install.ConnectedBy
	if creatorID == "" {
		creatorID, err = h.workspaceIssueCreator(ctx, install.WorkspaceID)
		if err != nil {
			return sentryIssueRow{}, err
		}
	}
	assigneeID := ""
	if input.AssigneeEmail != "" {
		assigneeID, _ = sentryMemberByEmail(ctx, tx, install.WorkspaceID, input.AssigneeEmail)
	}
	var nextNumber int32
	if err := tx.QueryRow(ctx, `select coalesce(max(number),0)+1 from issue where team_id=$1::uuid`, team.ID).Scan(&nextNumber); err != nil {
		return sentryIssueRow{}, err
	}
	identifier := fmt.Sprintf("%s-%d", team.Key, nextNumber)
	description := sentryIssueDescriptionHTML(input.Description, input.SentryIssue)
	var issueID string
	if err := tx.QueryRow(ctx, `
		insert into issue (number,identifier,title,description,team_id,state_id,assignee_id,creator_id,priority)
		values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8,$9)
		returning id::text`, nextNumber, identifier, title, description, team.ID, stateID, nullString(assigneeID), creatorID, priority).Scan(&issueID); err != nil {
		return sentryIssueRow{}, err
	}
	history := map[string]any{"identifier": identifier, "title": title, "teamId": team.ID, "source": "sentry_issue", "sentry": map[string]any{"issueId": input.SentryIssue.ID, "shortId": input.SentryIssue.ShortID, "webUrl": input.SentryIssue.WebURL, "projectId": input.SentryIssue.Project.ID, "project": firstNonEmpty(input.SentryIssue.Project.Slug, input.SentryIssue.Project.Name)}}
	historyRaw, _ := json.Marshal(history)
	if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,actor_name,actor_email,event_type,metadata) values ($1::uuid,$2,'Sentry',null,'created',$3::jsonb)`, issueID, nullString(creatorID), historyRaw); err != nil {
		return sentryIssueRow{}, err
	}
	if err := h.insertSentryIssueLinkTx(ctx, tx, install, issueID, input.SentryIssue); err != nil {
		return sentryIssueRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return sentryIssueRow{}, err
	}
	return sentryIssueRow{ID: issueID, Identifier: identifier, Title: title, TeamKey: team.Key}, nil
}

func (h Handler) sentryPublicTeam(ctx context.Context, q slackCreateQuerier, workspaceID, teamID, teamKey string) (slackIssueTeamOption, error) {
	var team slackIssueTeamOption
	if strings.TrimSpace(teamID) != "" {
		err := q.QueryRow(ctx, `select id::text,key,name,coalesce(triage_enabled,true) from team where id=$1::uuid and workspace_id=$2::uuid and deleted_at is null and retired_at is null and coalesce(is_private,false)=false`, teamID, workspaceID).Scan(&team.ID, &team.Key, &team.Name, &team.TriageEnabled)
		return team, err
	}
	if strings.TrimSpace(teamKey) != "" {
		err := q.QueryRow(ctx, `select id::text,key,name,coalesce(triage_enabled,true) from team where upper(key)=upper($1) and workspace_id=$2::uuid and deleted_at is null and retired_at is null and coalesce(is_private,false)=false`, teamKey, workspaceID).Scan(&team.ID, &team.Key, &team.Name, &team.TriageEnabled)
		return team, err
	}
	err := q.QueryRow(ctx, `select id::text,key,name,coalesce(triage_enabled,true) from team where workspace_id=$1::uuid and deleted_at is null and retired_at is null and coalesce(is_private,false)=false order by key asc limit 1`, workspaceID).Scan(&team.ID, &team.Key, &team.Name, &team.TriageEnabled)
	return team, err
}

func sentryMemberByEmail(ctx context.Context, q slackCreateQuerier, workspaceID, email string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `select u.id from "user" u join member m on m.user_id=u.id where m.workspace_id=$1::uuid and lower(u.email)=lower($2) limit 1`, workspaceID, email).Scan(&id)
	return id, err
}

func (h Handler) insertSentryIssueLink(ctx context.Context, install sentryInstallRecord, issueID string, issue sentryIssueRef) error {
	return h.insertSentryIssueLinkTx(ctx, h.DB, install, issueID, issue)
}

type sentryLinkExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (h Handler) insertSentryIssueLinkTx(ctx context.Context, q sentryLinkExecutor, install sentryInstallRecord, issueID string, issue sentryIssueRef) error {
	project := firstNonEmpty(issue.Project.ID, issue.Project.Slug, "sentry")
	issueIDExternal := firstNonEmpty(issue.ID, issue.ShortID)
	if issueIDExternal == "" {
		return fmt.Errorf("Sentry issue id is required")
	}
	_, err := q.Exec(ctx, `
		insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id)
		values ($1::uuid,$2::uuid,'sentry',$3::uuid,$4,$5,$6,$7,$8,'inbound',$9)
		on conflict (workspace_integration_id, source_event_id) where workspace_integration_id is not null and source_event_id is not null
		do update set issue_id=excluded.issue_id, external_permalink=excluded.external_permalink, updated_at=now()`, install.WorkspaceID, install.IntegrationID, issueID, firstNonEmpty(install.ExternalID, stringValue(install.Metadata["orgSlug"])), project, issueIDExternal, issueIDExternal, issue.WebURL, issueIDExternal)
	return err
}

func sentryIssueDescriptionHTML(description string, issue sentryIssueRef) string {
	description = strings.TrimSpace(description)
	if strings.Contains(description, "<") {
		description = sanitizehtml.RichText(description)
	} else if description != "" {
		description = "<p>" + htmlEscapeParagraph(description) + "</p>"
	}
	if issue.WebURL == "" {
		return description
	}
	link := `<p><a href="` + htmlEscapeAttribute(issue.WebURL) + `">View source in Sentry</a></p>`
	return sanitizehtml.RichText(description + link)
}

func htmlEscapeParagraph(value string) string {
	value = strings.ReplaceAll(value, "&", "&amp;")
	value = strings.ReplaceAll(value, "<", "&lt;")
	value = strings.ReplaceAll(value, ">", "&gt;")
	value = strings.ReplaceAll(value, "\n", "<br>")
	return value
}

func htmlEscapeAttribute(value string) string {
	value = strings.ReplaceAll(value, "&", "&amp;")
	value = strings.ReplaceAll(value, `"`, "&quot;")
	value = strings.ReplaceAll(value, "<", "&lt;")
	value = strings.ReplaceAll(value, ">", "&gt;")
	return value
}

func sentryPriority(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "urgent", "high", "medium", "low":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "none"
	}
}

func isUUIDish(value string) bool {
	value = strings.TrimSpace(value)
	return len(value) == 36 && strings.Count(value, "-") == 4
}

func (h Handler) saveSentryOAuthState(ctx context.Context, workspaceID string, userID string, state string) error {
	now := time.Now().UTC()
	metadata := map[string]any{"oauthStateHash": hashSlackSecret(state), "oauthStateExpiresAt": now.Add(10 * time.Minute).Format(time.RFC3339Nano), "oauthStartedAt": now.Format(time.RFC3339Nano), "autoResolve": true}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into workspace_integration (workspace_id, provider, status, metadata, connected_by_user_id, connected_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'sentry', 'installing', $2::jsonb, $3, null, null, null, null, now())
		on conflict (workspace_id, provider) do update set status='installing', metadata=excluded.metadata, connected_by_user_id=excluded.connected_by_user_id, credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=now()`, workspaceID, raw, userID)
	return err
}

func (h Handler) findSentryOAuthInstall(ctx context.Context, state string) (sentryOAuthInstall, error) {
	rows, err := h.DB.Query(ctx, `select id::text, workspace_id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb) from workspace_integration where provider='sentry' and status='installing'`)
	if err != nil {
		return sentryOAuthInstall{}, err
	}
	defer rows.Close()
	stateHash := hashSlackSecret(state)
	for rows.Next() {
		var install sentryOAuthInstall
		var metadataRaw []byte
		if err := rows.Scan(&install.ID, &install.WorkspaceID, &install.UserID, &metadataRaw); err != nil {
			return sentryOAuthInstall{}, err
		}
		install.Metadata = readJSONRecord(metadataRaw)
		if stringValue(install.Metadata["oauthStateHash"]) != stateHash {
			continue
		}
		expiresAt, _ := time.Parse(time.RFC3339Nano, stringValue(install.Metadata["oauthStateExpiresAt"]))
		if expiresAt.IsZero() || expiresAt.Before(time.Now().UTC()) {
			return sentryOAuthInstall{}, pgx.ErrNoRows
		}
		return install, nil
	}
	if err := rows.Err(); err != nil {
		return sentryOAuthInstall{}, err
	}
	return sentryOAuthInstall{}, pgx.ErrNoRows
}

func (h Handler) completeSentryInstall(ctx context.Context, install sentryOAuthInstall, token sentryOAuthResponse, org sentryOrganization) error {
	if token.AccessToken == "" || org.Slug == "" {
		return fmt.Errorf("Sentry OAuth response did not include access token and organization")
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	now := time.Now().UTC()
	expiresAt := (*time.Time)(nil)
	if token.ExpiresIn > 0 {
		value := now.Add(time.Duration(token.ExpiresIn) * time.Second)
		expiresAt = &value
	}
	metadata := map[string]any{"orgId": org.ID, "orgSlug": org.Slug, "orgName": firstNonEmpty(org.Name, org.Slug), "scopes": strings.Fields(token.Scope), "installedBy": install.UserID, "autoResolve": true}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update workspace_integration
		set status='connected', external_id=$2, display_name=$3, metadata=$4::jsonb, connected_by_user_id=$5, connected_at=coalesce(connected_at,$6), last_event_at=$6, last_success_at=$6, last_failure_at=null, last_failure_message=null, token_expires_at=$7, credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=$6
		where id=$1::uuid`, install.ID, org.Slug, firstNonEmpty(org.Name, org.Slug), metadataRaw, install.UserID, now, expiresAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at,$2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, install.ID, now); err != nil {
		return err
	}
	credential := map[string]any{"accessToken": token.AccessToken, "refreshToken": token.RefreshToken, "tokenType": token.TokenType, "scope": token.Scope, "orgSlug": org.Slug}
	credentialRaw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid,'sentry',$2,$3::jsonb,$4,$5,$5)`, install.ID, credentialRaw, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'sentry','oauth_connected','info','Sentry organization connected.',$3::jsonb,$4)`, install.WorkspaceID, install.ID, metadataRaw, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h Handler) recordSentryInstallFailure(ctx context.Context, integrationID string, workspaceID string, message string) error {
	_, err := h.DB.Exec(ctx, `update workspace_integration set status='error', last_failure_at=now(), last_failure_message=$2, updated_at=now() where id=$1::uuid`, integrationID, message)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'sentry','oauth_failed','error',$3,'{}'::jsonb)`, workspaceID, integrationID, message)
	return err
}

func (h Handler) recordSentryEvent(ctx context.Context, install sentryInstallRecord, eventType, severity, message string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'sentry',$3,$4,$5,$6::jsonb)`, install.WorkspaceID, install.IntegrationID, eventType, severity, message, raw)
	return err
}

func sentryOAuthConfig() (clientID string, clientSecret string, ok bool) {
	clientID = strings.TrimSpace(os.Getenv("AUTH_SENTRY_ID"))
	clientSecret = strings.TrimSpace(os.Getenv("AUTH_SENTRY_SECRET"))
	return clientID, clientSecret, clientID != "" && clientSecret != ""
}

func sentryConfigured() bool {
	_, _, ok := sentryOAuthConfig()
	return ok && sentryWebhookSecret() != ""
}

func sentryWebhookSecret() string {
	if v := strings.TrimSpace(os.Getenv("SENTRY_WEBHOOK_SECRET")); v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv("AUTH_SENTRY_SECRET"))
}

func sentryRedirectURI(appURL string) string {
	return strings.TrimRight(appURL, "/") + "/api/integrations/sentry/oauth/callback"
}

func sentryAuthorizationURL(clientID, appURL, state string) string {
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("response_type", "code")
	values.Set("redirect_uri", sentryRedirectURI(appURL))
	values.Set("scope", "event:read event:write org:read member:read project:read")
	values.Set("state", state)
	return sentryBaseURL() + "/oauth/authorize/?" + values.Encode()
}

func sentryRedirectURL(status string, message string) string {
	values := url.Values{}
	values.Set("sentry", status)
	if strings.TrimSpace(message) != "" {
		values.Set("message", message)
	}
	return strings.TrimRight(configuredAppURL(), "/") + "/settings/integrations?" + values.Encode()
}

func sentryBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("SENTRY_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://sentry.io"
}

func exchangeSentryOAuth(ctx context.Context, client *http.Client, clientID, clientSecret, code string, redirectURI string) (sentryOAuthResponse, error) {
	values := url.Values{}
	values.Set("grant_type", "authorization_code")
	values.Set("client_id", clientID)
	values.Set("client_secret", clientSecret)
	values.Set("code", code)
	values.Set("redirect_uri", redirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sentryBaseURL()+"/oauth/token/", strings.NewReader(values.Encode()))
	if err != nil {
		return sentryOAuthResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return sentryOAuthResponse{}, err
	}
	defer resp.Body.Close()
	var token sentryOAuthResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return sentryOAuthResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return sentryOAuthResponse{}, fmt.Errorf("Sentry OAuth returned HTTP %d", resp.StatusCode)
	}
	return token, nil
}

func fetchSentryOrganization(ctx context.Context, client *http.Client, accessToken string) (sentryOrganization, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sentryBaseURL()+"/api/0/organizations/", nil)
	if err != nil {
		return sentryOrganization{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := client.Do(req)
	if err != nil {
		return sentryOrganization{}, err
	}
	defer resp.Body.Close()
	var orgs []sentryOrganization
	if err := json.NewDecoder(resp.Body).Decode(&orgs); err != nil {
		return sentryOrganization{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return sentryOrganization{}, fmt.Errorf("Sentry organizations returned HTTP %d", resp.StatusCode)
	}
	if len(orgs) == 0 || orgs[0].Slug == "" {
		return sentryOrganization{}, fmt.Errorf("Sentry OAuth did not return an accessible organization")
	}
	return orgs[0], nil
}

func verifySentrySignature(secret string, signature string, body []byte) bool {
	if secret == "" || signature == "" {
		return false
	}
	signature = strings.TrimPrefix(strings.TrimSpace(signature), "sha256=")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func escapeSentryLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}
