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

type zendeskSetupRequest struct {
	Subdomain string `json:"subdomain"`
	Email     string `json:"email"`
	APIToken  string `json:"apiToken"`
}

type zendeskSetupResponse struct {
	Connected     bool   `json:"connected"`
	IntegrationID string `json:"integrationId"`
	Subdomain     string `json:"subdomain"`
	AccountURL    string `json:"accountUrl"`
	DisplayName   string `json:"displayName"`
	ActionBaseURL string `json:"actionBaseUrl"`
	ActionSecret  string `json:"actionSecret"`
}

type zendeskCredential struct {
	Subdomain    string `json:"subdomain"`
	AccountURL    string `json:"accountUrl"`
	Email         string `json:"email"`
	APIToken      string `json:"apiToken"`
	ActionSecret  string `json:"actionSecret"`
	CloseNoteBody string `json:"closeNoteBody"`
}

type zendeskCurrentUser struct {
	User struct {
		ID    int64  `json:"id"`
		Name  string `json:"name"`
		Email string `json:"email"`
	} `json:"user"`
}

type zendeskInstallRecord struct {
	WorkspaceID   string
	IntegrationID string
	ConnectedBy   string
	Subdomain     string
	AccountURL    string
	DisplayName   string
	Metadata      map[string]any
	Credential    zendeskCredential
}

type zendeskRequesterRef struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type zendeskOrganizationRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type zendeskTicketRef struct {
	ID           string                 `json:"id"`
	URL          string                 `json:"url"`
	Subject      string                 `json:"subject"`
	Description  string                 `json:"description"`
	Status       string                 `json:"status"`
	Requester    zendeskRequesterRef    `json:"requester"`
	Organization zendeskOrganizationRef `json:"organization"`
}

type zendeskTicketActionRequest struct {
	Query       string
	IssueID     string
	Identifier  string
	Title       string
	Description string
	TeamID      string
	TeamKey     string
	Priority    string
	Subdomain   string
	Ticket      zendeskTicketRef
	Raw         map[string]any
}

type zendeskIssueActionResponse struct {
	WebURL        string `json:"webUrl"`
	Project       string `json:"project"`
	Identifier    string `json:"identifier"`
	Title         string `json:"title,omitempty"`
	StateName     string `json:"stateName,omitempty"`
	StateCategory string `json:"stateCategory,omitempty"`
}

type zendeskIssueSearchResponse struct {
	Issues []zendeskIssueActionResponse `json:"issues"`
}

type zendeskTicketStatusResponse struct {
	TicketID string                       `json:"ticketId"`
	Linked   bool                         `json:"linked"`
	Issues   []zendeskIssueActionResponse `json:"issues"`
}

func (h Handler) ZendeskSetup(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	var input zendeskSetupRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Zendesk setup payload is invalid", err.Error())
		return
	}
	subdomain, accountURL, err := normalizeZendeskSubdomain(input.Subdomain)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Zendesk subdomain is invalid", err.Error())
		return
	}
	email := strings.ToLower(strings.TrimSpace(input.Email))
	token := strings.TrimSpace(input.APIToken)
	if email == "" || token == "" {
		problem.Write(w, http.StatusBadRequest, "Zendesk email and API token are required", "")
		return
	}
	user, err := validateZendeskCredential(r.Context(), http.DefaultClient, subdomain, accountURL, email, token)
	if err != nil {
		problem.Write(w, http.StatusBadGateway, "Zendesk credential validation failed", err.Error())
		return
	}
	actionSecret, err := randomGitLabSecret()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Zendesk action secret failed", err.Error())
		return
	}
	integrationID, err := h.saveZendeskIntegration(r.Context(), p.WorkspaceID, p.UserID, subdomain, accountURL, email, token, actionSecret, user)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Save Zendesk integration failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, zendeskSetupResponse{Connected: true, IntegrationID: integrationID, Subdomain: subdomain, AccountURL: accountURL, DisplayName: zendeskDisplayName(subdomain, user), ActionBaseURL: zendeskActionBaseURL(), ActionSecret: actionSecret})
}

func (h Handler) ZendeskDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if err := h.revokeProvider(r.Context(), p.WorkspaceID, "zendesk", p.UserID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect Zendesk failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) ZendeskTicketSearch(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.zendeskSignedAction(w, r)
	if !ok {
		return
	}
	query := strings.TrimSpace(input.Query)
	if query == "" {
		problem.JSON(w, http.StatusOK, zendeskIssueSearchResponse{Issues: []zendeskIssueActionResponse{}})
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		select i.identifier,i.title,t.key,ws.name,ws.category::text
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		where t.workspace_id=$1::uuid
			and t.deleted_at is null
			and i.archived_at is null
			and coalesce(t.is_private,false)=false
			and (i.identifier ilike $2 or i.title ilike $2)
		order by i.updated_at desc
		limit 10`, install.WorkspaceID, "%"+escapeSentryLike(query)+"%")
	if err != nil {
		_ = h.recordZendeskEvent(r.Context(), install, "issue_search_failed", "error", err.Error(), input.Raw)
		problem.Write(w, http.StatusInternalServerError, "Search issues failed", err.Error())
		return
	}
	defer rows.Close()
	out := []zendeskIssueActionResponse{}
	for rows.Next() {
		var identifier, title, teamKey, stateName, stateCategory string
		if err := rows.Scan(&identifier, &title, &teamKey, &stateName, &stateCategory); err != nil {
			problem.Write(w, http.StatusInternalServerError, "Search issues failed", err.Error())
			return
		}
		out = append(out, zendeskIssueActionResponse{WebURL: issueBacklink(teamKey, identifier), Project: teamKey, Identifier: identifier, Title: title, StateName: stateName, StateCategory: stateCategory})
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Search issues failed", err.Error())
		return
	}
	_ = h.recordZendeskEvent(r.Context(), install, "issue_search_succeeded", "info", "Zendesk issue search completed.", map[string]any{"query": query, "count": len(out)})
	problem.JSON(w, http.StatusOK, zendeskIssueSearchResponse{Issues: out})
}

func (h Handler) ZendeskTicketLink(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.zendeskSignedAction(w, r)
	if !ok {
		return
	}
	issue, err := h.zendeskIssueForLink(r.Context(), install.WorkspaceID, firstNonEmpty(input.IssueID, input.Identifier))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Zendesk ticket failed", err.Error())
		return
	}
	if err := h.insertZendeskTicketLink(r.Context(), h.DB, install, issue.ID, input.Ticket, input.Raw); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Zendesk ticket failed", err.Error())
		return
	}
	_ = h.recordZendeskEvent(r.Context(), install, "ticket_linked", "info", "Zendesk ticket linked to Exponential issue.", map[string]any{"issueId": issue.ID, "ticketId": input.Ticket.ID})
	problem.JSON(w, http.StatusOK, zendeskIssueActionResponse{WebURL: issueBacklink(issue.TeamKey, issue.Identifier), Project: issue.TeamKey, Identifier: issue.Identifier, Title: issue.Title, StateName: issue.StateName, StateCategory: issue.StateCategory})
}

func (h Handler) ZendeskTicketCreate(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.zendeskSignedAction(w, r)
	if !ok {
		return
	}
	if existing, err := h.zendeskIssueForTicket(r.Context(), install.IntegrationID, input.Ticket.ID); err == nil {
		problem.JSON(w, http.StatusOK, zendeskIssueActionResponse{WebURL: issueBacklink(existing.TeamKey, existing.Identifier), Project: existing.TeamKey, Identifier: existing.Identifier, Title: existing.Title, StateName: existing.StateName, StateCategory: existing.StateCategory})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusInternalServerError, "Create Zendesk issue failed", err.Error())
		return
	}
	issue, err := h.createZendeskIssue(r.Context(), install, input)
	if err != nil {
		_ = h.recordZendeskEvent(r.Context(), install, "issue_creation_failed", "error", err.Error(), input.Raw)
		problem.Write(w, http.StatusBadRequest, "Create Zendesk issue failed", err.Error())
		return
	}
	_ = h.recordZendeskEvent(r.Context(), install, "issue_created", "info", "Zendesk ticket created an Exponential issue.", map[string]any{"issueId": issue.ID, "ticketId": input.Ticket.ID})
	problem.JSON(w, http.StatusOK, zendeskIssueActionResponse{WebURL: issueBacklink(issue.TeamKey, issue.Identifier), Project: issue.TeamKey, Identifier: issue.Identifier, Title: issue.Title, StateName: issue.StateName, StateCategory: issue.StateCategory})
}

func (h Handler) ZendeskTicketStatus(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.zendeskSignedAction(w, r)
	if !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		select i.identifier,i.title,t.key,ws.name,ws.category::text
		from zendesk_ticket_link ztl
		join issue i on i.id=ztl.issue_id
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		where ztl.workspace_integration_id=$1::uuid and ztl.ticket_id=$2 and t.workspace_id=$3::uuid and i.archived_at is null
		order by ztl.updated_at desc`, install.IntegrationID, input.Ticket.ID, install.WorkspaceID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load Zendesk ticket status failed", err.Error())
		return
	}
	defer rows.Close()
	issues := []zendeskIssueActionResponse{}
	for rows.Next() {
		var issue zendeskIssueActionResponse
		if err := rows.Scan(&issue.Identifier, &issue.Title, &issue.Project, &issue.StateName, &issue.StateCategory); err != nil {
			problem.Write(w, http.StatusInternalServerError, "Load Zendesk ticket status failed", err.Error())
			return
		}
		issue.WebURL = issueBacklink(issue.Project, issue.Identifier)
		issues = append(issues, issue)
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load Zendesk ticket status failed", err.Error())
		return
	}
	_ = h.recordZendeskEvent(r.Context(), install, "ticket_status_viewed", "info", "Zendesk ticket status requested.", map[string]any{"ticketId": input.Ticket.ID, "count": len(issues)})
	problem.JSON(w, http.StatusOK, zendeskTicketStatusResponse{TicketID: input.Ticket.ID, Linked: len(issues) > 0, Issues: issues})
}

func (h Handler) zendeskSignedAction(w http.ResponseWriter, r *http.Request) (zendeskInstallRecord, zendeskTicketActionRequest, bool) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Zendesk request body could not be read", err.Error())
		return zendeskInstallRecord{}, zendeskTicketActionRequest{}, false
	}
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		problem.Write(w, http.StatusBadRequest, "Zendesk payload is invalid", err.Error())
		return zendeskInstallRecord{}, zendeskTicketActionRequest{}, false
	}
	input := zendeskTicketActionFromPayload(raw)
	install, err := h.resolveZendeskInstall(r.Context(), input)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Zendesk integration is not connected", "")
		return zendeskInstallRecord{}, zendeskTicketActionRequest{}, false
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Zendesk integration could not be resolved", err.Error())
		return zendeskInstallRecord{}, zendeskTicketActionRequest{}, false
	}
	if !verifyZendeskSignature(install.Credential.ActionSecret, firstNonEmpty(r.Header.Get("X-Exponential-Signature"), r.Header.Get("X-Zendesk-Exponential-Signature")), body) {
		problem.Write(w, http.StatusUnauthorized, "Invalid Zendesk signature", "")
		return zendeskInstallRecord{}, zendeskTicketActionRequest{}, false
	}
	if strings.TrimSpace(input.Ticket.ID) == "" {
		problem.Write(w, http.StatusBadRequest, "Zendesk ticket id is required", "")
		return zendeskInstallRecord{}, zendeskTicketActionRequest{}, false
	}
	return install, input, true
}

func zendeskTicketActionFromPayload(raw map[string]any) zendeskTicketActionRequest {
	data := recordValue(raw["data"])
	if data == nil {
		data = raw
	}
	ticketRecord := firstRecord(raw["ticket"], data["ticket"])
	requesterRecord := firstRecord(raw["requester"], data["requester"], ticketRecord["requester"])
	organizationRecord := firstRecord(raw["organization"], data["organization"], ticketRecord["organization"])
	ticketID := firstNonEmpty(stringValue(raw["ticketId"]), stringValue(raw["ticket_id"]), stringValue(data["ticketId"]), stringValue(data["ticket_id"]), stringValue(ticketRecord["id"]))
	ticketURL := firstNonEmpty(stringValue(raw["ticketUrl"]), stringValue(raw["ticket_url"]), stringValue(raw["url"]), stringValue(data["ticketUrl"]), stringValue(data["ticket_url"]), stringValue(data["url"]), stringValue(ticketRecord["url"]), stringValue(ticketRecord["html_url"]))
	subdomain := firstNonEmpty(stringValue(raw["subdomain"]), stringValue(raw["accountSubdomain"]), stringValue(data["subdomain"]), stringValue(data["accountSubdomain"]), zendeskSubdomainFromURL(ticketURL))
	return zendeskTicketActionRequest{
		Query:       firstNonEmpty(stringValue(raw["query"]), stringValue(raw["q"]), stringValue(data["query"]), stringValue(data["q"])),
		IssueID:     firstNonEmpty(stringValue(raw["exponentialIssueId"]), stringValue(raw["issueIdentifier"]), stringValue(raw["identifier"]), stringValue(data["exponentialIssueId"]), stringValue(data["issueIdentifier"]), stringValue(data["identifier"])),
		Identifier:  firstNonEmpty(stringValue(raw["identifier"]), stringValue(data["identifier"])),
		Title:       firstNonEmpty(stringValue(raw["title"]), stringValue(data["title"]), stringValue(ticketRecord["subject"]), stringValue(ticketRecord["title"])),
		Description: firstNonEmpty(stringValue(raw["description"]), stringValue(data["description"]), stringValue(ticketRecord["description"]), stringValue(ticketRecord["body"])),
		TeamID:      firstNonEmpty(stringValue(raw["teamId"]), stringValue(raw["team_id"]), stringValue(data["teamId"]), stringValue(data["team_id"])),
		TeamKey:     firstNonEmpty(stringValue(raw["teamKey"]), stringValue(raw["team"]), stringValue(data["teamKey"]), stringValue(data["team"])),
		Priority:    firstNonEmpty(stringValue(raw["priority"]), stringValue(data["priority"])),
		Subdomain:   subdomain,
		Ticket: zendeskTicketRef{ID: ticketID, URL: ticketURL, Subject: firstNonEmpty(stringValue(ticketRecord["subject"]), stringValue(raw["title"]), stringValue(data["title"])), Description: firstNonEmpty(stringValue(ticketRecord["description"]), stringValue(ticketRecord["body"]), stringValue(raw["description"]), stringValue(data["description"])), Status: firstNonEmpty(stringValue(ticketRecord["status"]), stringValue(raw["ticketStatus"]), stringValue(data["ticketStatus"])), Requester: zendeskRequesterRef{ID: firstNonEmpty(stringValue(requesterRecord["id"]), stringValue(raw["requesterId"]), stringValue(data["requesterId"])), Name: firstNonEmpty(stringValue(requesterRecord["name"]), stringValue(raw["requesterName"]), stringValue(data["requesterName"])), Email: strings.ToLower(firstNonEmpty(stringValue(requesterRecord["email"]), stringValue(raw["requesterEmail"]), stringValue(data["requesterEmail"])))}, Organization: zendeskOrganizationRef{ID: firstNonEmpty(stringValue(organizationRecord["id"]), stringValue(raw["organizationId"]), stringValue(data["organizationId"])), Name: firstNonEmpty(stringValue(organizationRecord["name"]), stringValue(raw["organizationName"]), stringValue(data["organizationName"]))}},
		Raw: raw,
	}
}

type zendeskIssueRow struct {
	ID            string
	Identifier    string
	Title         string
	TeamKey       string
	StateName     string
	StateCategory string
}

func (h Handler) zendeskIssueForLink(ctx context.Context, workspaceID, requested string) (zendeskIssueRow, error) {
	var issue zendeskIssueRow
	requested = strings.TrimSpace(requested)
	where := "upper(i.identifier)=upper($2)"
	if isUUIDish(requested) {
		where = "(i.id=$2::uuid or upper(i.identifier)=upper($2))"
	}
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,t.key,ws.name,ws.category::text
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		where t.workspace_id=$1::uuid
			and coalesce(t.is_private,false)=false
			and i.archived_at is null
			and `+where+`
		limit 1`, workspaceID, requested).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey, &issue.StateName, &issue.StateCategory)
	return issue, err
}

func (h Handler) zendeskIssueForTicket(ctx context.Context, integrationID, ticketID string) (zendeskIssueRow, error) {
	var issue zendeskIssueRow
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,t.key,ws.name,ws.category::text
		from zendesk_ticket_link ztl
		join issue i on i.id=ztl.issue_id
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		where ztl.workspace_integration_id=$1::uuid and ztl.ticket_id=$2
		limit 1`, integrationID, ticketID).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey, &issue.StateName, &issue.StateCategory)
	return issue, err
}

func (h Handler) createZendeskIssue(ctx context.Context, install zendeskInstallRecord, input zendeskTicketActionRequest) (zendeskIssueRow, error) {
	title := strings.TrimSpace(firstNonEmpty(input.Title, input.Ticket.Subject))
	if title == "" {
		return zendeskIssueRow{}, fmt.Errorf("title is required")
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return zendeskIssueRow{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	team, err := h.sentryPublicTeam(ctx, tx, install.WorkspaceID, input.TeamID, input.TeamKey)
	if err != nil {
		return zendeskIssueRow{}, err
	}
	stateID, err := slackIssueStateByCategory(ctx, tx, team.ID, "triage")
	if errors.Is(err, pgx.ErrNoRows) {
		stateID, err = slackIssueStateByCategory(ctx, tx, team.ID, "backlog")
	}
	if err != nil {
		return zendeskIssueRow{}, err
	}
	creatorID := install.ConnectedBy
	if creatorID == "" {
		creatorID, err = h.workspaceIssueCreator(ctx, install.WorkspaceID)
		if err != nil {
			return zendeskIssueRow{}, err
		}
	}
	var nextNumber int32
	if err := tx.QueryRow(ctx, `select coalesce(max(number),0)+1 from issue where team_id=$1::uuid`, team.ID).Scan(&nextNumber); err != nil {
		return zendeskIssueRow{}, err
	}
	identifier := fmt.Sprintf("%s-%d", team.Key, nextNumber)
	description := zendeskIssueDescriptionHTML(input.Ticket, input.Description)
	var issueID string
	if err := tx.QueryRow(ctx, `
		insert into issue (number,identifier,title,description,team_id,state_id,creator_id,priority)
		values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8)
		returning id::text`, nextNumber, identifier, title, description, team.ID, stateID, creatorID, sentryPriority(input.Priority)).Scan(&issueID); err != nil {
		return zendeskIssueRow{}, err
	}
	history := map[string]any{"identifier": identifier, "title": title, "teamId": team.ID, "source": "zendesk_ticket", "backlink": issueBacklink(team.Key, identifier), "zendesk": zendeskHistoryMetadata(input.Ticket)}
	historyRaw, _ := json.Marshal(history)
	if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,actor_name,actor_email,event_type,metadata) values ($1::uuid,$2,'Zendesk',null,'created',$3::jsonb)`, issueID, nullString(creatorID), historyRaw); err != nil {
		return zendeskIssueRow{}, err
	}
	if err := h.insertZendeskTicketLink(ctx, tx, install, issueID, input.Ticket, input.Raw); err != nil {
		return zendeskIssueRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return zendeskIssueRow{}, err
	}
	return zendeskIssueRow{ID: issueID, Identifier: identifier, Title: title, TeamKey: team.Key, StateName: "", StateCategory: ""}, nil
}

type zendeskLinkExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (h Handler) insertZendeskTicketLink(ctx context.Context, q zendeskLinkExecutor, install zendeskInstallRecord, issueID string, ticket zendeskTicketRef, raw map[string]any) error {
	ticketID := strings.TrimSpace(ticket.ID)
	if ticketID == "" {
		return fmt.Errorf("Zendesk ticket id is required")
	}
	metadata := map[string]any{"ticket": ticket, "raw": raw}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	if _, err := q.Exec(ctx, `
		insert into zendesk_ticket_link (workspace_id, workspace_integration_id, issue_id, ticket_id, ticket_url, ticket_status, requester_id, requester_name, requester_email, organization_id, organization_name, metadata, updated_at)
		values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now())
		on conflict (workspace_integration_id, ticket_id) where workspace_integration_id is not null
		do update set issue_id=excluded.issue_id, ticket_url=excluded.ticket_url, ticket_status=excluded.ticket_status, requester_id=excluded.requester_id, requester_name=excluded.requester_name, requester_email=excluded.requester_email, organization_id=excluded.organization_id, organization_name=excluded.organization_name, metadata=excluded.metadata, updated_at=now()`, install.WorkspaceID, install.IntegrationID, issueID, ticketID, nullString(ticket.URL), nullString(ticket.Status), nullString(ticket.Requester.ID), nullString(ticket.Requester.Name), nullString(ticket.Requester.Email), nullString(ticket.Organization.ID), nullString(ticket.Organization.Name), metadataRaw); err != nil {
		return err
	}
	_, err = q.Exec(ctx, `
		insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id)
		values ($1::uuid,$2::uuid,'zendesk',$3::uuid,$4,'tickets',$5,$5,$6,'inbound',$7)
		on conflict (workspace_integration_id, source_event_id) where workspace_integration_id is not null and source_event_id is not null
		do update set issue_id=excluded.issue_id, external_permalink=excluded.external_permalink, updated_at=now()`, install.WorkspaceID, install.IntegrationID, issueID, install.Subdomain, ticketID, nullString(ticket.URL), zendeskTicketSourceEventID(ticketID))
	return err
}

func zendeskIssueDescriptionHTML(ticket zendeskTicketRef, fallback string) string {
	description := strings.TrimSpace(firstNonEmpty(ticket.Description, fallback))
	if strings.Contains(description, "<") {
		description = sanitizehtml.RichText(description)
	} else if description != "" {
		description = "<p>" + htmlEscapeParagraph(description) + "</p>"
	}
	if ticket.URL == "" {
		return description
	}
	link := `<p><a href="` + htmlEscapeAttribute(ticket.URL) + `">View source in Zendesk</a></p>`
	return sanitizehtml.RichText(description + link)
}

func zendeskHistoryMetadata(ticket zendeskTicketRef) map[string]any {
	return map[string]any{"ticketId": ticket.ID, "ticketUrl": ticket.URL, "status": ticket.Status, "requester": ticket.Requester, "organization": ticket.Organization}
}

func (h Handler) resolveZendeskInstall(ctx context.Context, input zendeskTicketActionRequest) (zendeskInstallRecord, error) {
	integrationID := firstNonEmpty(stringValue(input.Raw["integrationId"]), stringValue(input.Raw["workspaceIntegrationId"]), stringValue(recordValue(input.Raw["data"])["integrationId"]))
	args := []any{}
	where := "wi.provider='zendesk' and wi.status in ('connected','degraded')"
	if integrationID != "" {
		args = append(args, integrationID)
		where += " and wi.id=$1::uuid"
	} else if input.Subdomain != "" {
		args = append(args, strings.ToLower(strings.TrimSpace(input.Subdomain)))
		where += " and (wi.external_id=$1 or wi.metadata->>'subdomain'=$1)"
	}
	var install zendeskInstallRecord
	var metadataRaw []byte
	var credentialRaw []byte
	err := h.DB.QueryRow(ctx, `select wi.workspace_id::text,wi.id::text,coalesce(wi.connected_by_user_id,''),coalesce(wi.external_id,''),coalesce(wi.display_name,''),coalesce(wi.metadata,'{}'::jsonb),pc.encrypted_payload from workspace_integration wi join provider_credential pc on pc.workspace_integration_id=wi.id and pc.provider='zendesk' and pc.active where `+where+` order by wi.connected_at desc limit 1`, args...).Scan(&install.WorkspaceID, &install.IntegrationID, &install.ConnectedBy, &install.Subdomain, &install.DisplayName, &metadataRaw, &credentialRaw)
	if err != nil {
		return install, err
	}
	install.Metadata = readJSONRecord(metadataRaw)
	_ = json.Unmarshal(credentialRaw, &install.Credential)
	install.AccountURL = firstNonEmpty(install.Credential.AccountURL, stringValue(install.Metadata["accountUrl"]))
	return install, nil
}

func normalizeZendeskSubdomain(input string) (string, string, error) {
	value := strings.TrimSpace(strings.ToLower(input))
	if value == "" {
		return "", "", fmt.Errorf("subdomain is required")
	}
	if strings.Contains(value, "://") {
		parsed, err := url.Parse(value)
		if err != nil {
			return "", "", err
		}
		if parsed.Scheme != "https" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Trim(parsed.EscapedPath(), "/") != "" {
			return "", "", fmt.Errorf("Zendesk URL must be an HTTPS origin without credentials, query, fragment, or path")
		}
		value = parsed.Hostname()
	}
	value = strings.TrimSuffix(value, ".zendesk.com")
	if value == "" || strings.ContainsAny(value, "/:@") {
		return "", "", fmt.Errorf("Zendesk subdomain is invalid")
	}
	return value, "https://" + value + ".zendesk.com", nil
}

func validateZendeskCredential(ctx context.Context, client *http.Client, subdomain string, accountURL string, email string, token string) (zendeskCurrentUser, error) {
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, zendeskAPIURL(subdomain, accountURL, "/api/v2/users/me.json"), nil)
	if err != nil {
		return zendeskCurrentUser{}, err
	}
	req.SetBasicAuth(email+"/token", token)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return zendeskCurrentUser{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return zendeskCurrentUser{}, fmt.Errorf("Zendesk rejected the API token")
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return zendeskCurrentUser{}, fmt.Errorf("Zendesk returned HTTP %d", resp.StatusCode)
	}
	var user zendeskCurrentUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return zendeskCurrentUser{}, err
	}
	if user.User.ID == 0 && strings.TrimSpace(user.User.Email) == "" {
		return zendeskCurrentUser{}, fmt.Errorf("Zendesk current user response was incomplete")
	}
	return user, nil
}

func (h Handler) saveZendeskIntegration(ctx context.Context, workspaceID, userID, subdomain, accountURL, email, token, actionSecret string, user zendeskCurrentUser) (string, error) {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	now := time.Now().UTC()
	metadata := map[string]any{"subdomain": subdomain, "accountUrl": accountURL, "zendeskUserId": user.User.ID, "zendeskUserEmail": user.User.Email, "configuredBy": userID, "actionSecretHash": hashSlackSecret(actionSecret)}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return "", err
	}
	displayName := zendeskDisplayName(subdomain, user)
	var integrationID string
	if err := tx.QueryRow(ctx, `
		insert into workspace_integration (workspace_id, provider, status, external_id, display_name, metadata, connected_by_user_id, connected_at, last_event_at, last_success_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'zendesk', 'connected', $2, $3, $4::jsonb, $5, $6, $6, $6, null, null, null, $6)
		on conflict (workspace_id, provider) do update set
			status='connected', external_id=excluded.external_id, display_name=excluded.display_name, metadata=excluded.metadata,
			connected_by_user_id=excluded.connected_by_user_id, connected_at=coalesce(workspace_integration.connected_at, excluded.connected_at),
			last_event_at=excluded.last_event_at, last_success_at=excluded.last_success_at, last_failure_at=null, last_failure_message=null,
			credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=excluded.updated_at
		returning id::text`, workspaceID, subdomain, displayName, metadataRaw, userID, now).Scan(&integrationID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at, $2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, integrationID, now); err != nil {
		return "", err
	}
	credential := zendeskCredential{Subdomain: subdomain, AccountURL: accountURL, Email: email, APIToken: token, ActionSecret: actionSecret, CloseNoteBody: "Linked Exponential issue reached a terminal state."}
	credentialRaw, err := json.Marshal(credential)
	if err != nil {
		return "", err
	}
	credentialMetadataRaw, _ := json.Marshal(map[string]any{"subdomain": subdomain, "accountUrl": accountURL, "zendeskUserId": user.User.ID, "zendeskUserEmail": user.User.Email})
	if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid, 'zendesk', $2, $3::jsonb, $4, $5, $5)`, integrationID, credentialRaw, credentialMetadataRaw, userID, now); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid, $2::uuid, 'zendesk', 'token_validated', 'info', 'Zendesk integration connected.', $3::jsonb, $4)`, workspaceID, integrationID, metadataRaw, now); err != nil {
		return "", err
	}
	return integrationID, tx.Commit(ctx)
}

func (h Handler) recordZendeskEvent(ctx context.Context, install zendeskInstallRecord, eventType, severity, message string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'zendesk',$3,$4,$5,$6::jsonb)`, install.WorkspaceID, install.IntegrationID, eventType, severity, message, raw)
	return err
}

func verifyZendeskSignature(secret string, signature string, body []byte) bool {
	secret = strings.TrimSpace(secret)
	signature = strings.TrimSpace(strings.TrimPrefix(signature, "sha256="))
	if secret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func zendeskAPIURL(subdomain string, accountURL string, path string) string {
	base := strings.TrimSpace(zendeskAPIBaseURL())
	if base == "" {
		base = accountURL
	}
	return strings.TrimRight(base, "/") + path
}

func zendeskAPIBaseURL() string { return strings.TrimSpace(os.Getenv("ZENDESK_API_BASE_URL")) }

func zendeskDisplayName(subdomain string, user zendeskCurrentUser) string {
	if name := strings.TrimSpace(user.User.Name); name != "" {
		return subdomain + " · " + name
	}
	return subdomain + ".zendesk.com"
}

func zendeskActionBaseURL() string {
	return strings.TrimRight(configuredAppURL(), "/") + "/api/integrations/zendesk/tickets"
}

func zendeskSubdomainFromURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" {
		return ""
	}
	return strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".zendesk.com")
}

func zendeskTicketSourceEventID(ticketID string) string { return "zendesk_ticket:" + strings.TrimSpace(ticketID) }
