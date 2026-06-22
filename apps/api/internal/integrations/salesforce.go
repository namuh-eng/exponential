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

type salesforceConnectResponse = slackConnectResponse

type salesforceOAuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	InstanceURL  string `json:"instance_url"`
	ID           string `json:"id"`
	TokenType    string `json:"token_type"`
	IssuedAt     string `json:"issued_at"`
	Signature    string `json:"signature"`
	Scope        string `json:"scope"`
}

type salesforceUserInfo struct {
	OrganizationID   string `json:"organization_id"`
	OrganizationName string `json:"organization_name"`
	UserID           string `json:"user_id"`
	Username         string `json:"preferred_username"`
	Email            string `json:"email"`
	Name             string `json:"name"`
}

type salesforceOAuthInstall struct {
	ID          string
	WorkspaceID string
	UserID      string
	Metadata    map[string]any
}

type salesforceInstallRecord struct {
	WorkspaceID   string
	IntegrationID string
	ConnectedBy   string
	ExternalID    string
	DisplayName   string
	Metadata      map[string]any
}

type salesforceCaseRef struct {
	ID             string         `json:"id"`
	Number         string         `json:"number"`
	Subject        string         `json:"subject"`
	URL            string         `json:"url"`
	AccountID      string         `json:"accountId"`
	AccountName    string         `json:"accountName"`
	ContactID      string         `json:"contactId"`
	ContactName    string         `json:"contactName"`
	ContactEmail   string         `json:"contactEmail"`
	RequesterEmail string         `json:"requesterEmail"`
	InstanceURL    string         `json:"instanceUrl"`
	Metadata       map[string]any `json:"metadata"`
}

type salesforceCaseActionRequest struct {
	OrganizationID string
	Query          string
	IssueID        string
	Identifier     string
	ProjectID      string
	ProjectSlug    string
	Title          string
	Description    string
	TeamID         string
	TeamKey        string
	Priority       string
	Case           salesforceCaseRef
	Raw            map[string]any
}

type salesforceIssueActionResponse struct {
	WebURL         string `json:"webUrl"`
	IssueID        string `json:"issueId,omitempty"`
	Project        string `json:"project"`
	Identifier     string `json:"identifier"`
	Status         string `json:"status"`
	StatusCategory string `json:"statusCategory"`
	Priority       string `json:"priority"`
	CaseID         string `json:"caseId,omitempty"`
	CaseNumber     string `json:"caseNumber,omitempty"`
}

type salesforceIssueSearchResponse struct {
	Issues []salesforceIssueActionResponse `json:"issues"`
}

type salesforceProjectActionResponse struct {
	WebURL     string `json:"webUrl"`
	ProjectID  string `json:"projectId"`
	Name       string `json:"name"`
	Slug       string `json:"slug"`
	Status     string `json:"status"`
	Priority   string `json:"priority"`
	CaseID     string `json:"caseId,omitempty"`
	CaseNumber string `json:"caseNumber,omitempty"`
}

type salesforceProjectSearchResponse struct {
	Projects []salesforceProjectActionResponse `json:"projects"`
}

func (h Handler) SalesforceConnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	clientID, _, ok := salesforceOAuthConfig()
	if !ok {
		problem.JSON(w, http.StatusPreconditionFailed, map[string]string{"error": "Salesforce OAuth is not configured", "message": "Add AUTH_SALESFORCE_ID and AUTH_SALESFORCE_SECRET to enable Salesforce installation for this workspace."})
		return
	}
	state, err := randomState()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Salesforce authorization failed", err.Error())
		return
	}
	workspaceSlug, err := h.workspaceSlug(r.Context(), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "No active workspace found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Salesforce authorization failed", err.Error())
		return
	}
	if err := h.saveSalesforceOAuthState(r.Context(), p.WorkspaceID, p.UserID, state); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Salesforce authorization failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, salesforceConnectResponse{AuthorizationURL: salesforceAuthorizationURL(clientID, configuredAppURL(), state), State: state, WorkspaceSlug: workspaceSlug})
}

func (h Handler) SalesforceDisconnect(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canManage(p.Role) {
		problem.Write(w, http.StatusForbidden, "Forbidden", "")
		return
	}
	if err := h.disconnectProvider(r.Context(), p.WorkspaceID, p.UserID, "salesforce"); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Disconnect Salesforce failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (h Handler) SalesforceOAuthCallback(w http.ResponseWriter, r *http.Request) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if salesforceError := strings.TrimSpace(r.URL.Query().Get("error")); salesforceError != "" {
		http.Redirect(w, r, salesforceRedirectURL("error", salesforceError), http.StatusFound)
		return
	}
	if code == "" || state == "" {
		problem.Write(w, http.StatusBadRequest, "Salesforce OAuth callback is missing code or state", "")
		return
	}
	clientID, clientSecret, ok := salesforceOAuthConfig()
	if !ok {
		problem.Write(w, http.StatusServiceUnavailable, "Salesforce OAuth is not configured", "")
		return
	}
	install, err := h.findSalesforceOAuthInstall(r.Context(), state)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusBadRequest, "Invalid Salesforce OAuth state", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Salesforce OAuth callback failed", err.Error())
		return
	}
	token, err := exchangeSalesforceOAuth(r.Context(), http.DefaultClient, clientID, clientSecret, code, salesforceRedirectURI(configuredAppURL()))
	if err != nil {
		_ = h.recordSalesforceInstallFailure(r.Context(), install.ID, install.WorkspaceID, err.Error())
		problem.Write(w, http.StatusBadGateway, "Salesforce OAuth exchange failed", err.Error())
		return
	}
	info, err := fetchSalesforceUserInfo(r.Context(), http.DefaultClient, token)
	if err != nil {
		_ = h.recordSalesforceInstallFailure(r.Context(), install.ID, install.WorkspaceID, err.Error())
		problem.Write(w, http.StatusBadGateway, "Salesforce org lookup failed", err.Error())
		return
	}
	if err := h.completeSalesforceInstall(r.Context(), install, token, info); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Salesforce OAuth callback failed", err.Error())
		return
	}
	http.Redirect(w, r, salesforceRedirectURL("connected", ""), http.StatusFound)
}

func (h Handler) SalesforceIssueSearch(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.salesforceSignedAction(w, r)
	if !ok {
		return
	}
	query := strings.TrimSpace(input.Query)
	if query == "" {
		problem.JSON(w, http.StatusOK, salesforceIssueSearchResponse{Issues: []salesforceIssueActionResponse{}})
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		select i.id::text,i.identifier,i.title,t.key,ws.name,ws.category::text,i.priority::text
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		where t.workspace_id=$1::uuid
			and t.deleted_at is null
			and i.archived_at is null
			and coalesce(t.is_private,false)=false
			and (i.identifier ilike $2 or i.title ilike $2)
		order by i.updated_at desc
		limit 10`, install.WorkspaceID, "%"+escapeSalesforceLike(query)+"%")
	if err != nil {
		_ = h.recordSalesforceEvent(r.Context(), install, "issue_search_failed", "error", err.Error(), input.Raw)
		problem.Write(w, http.StatusInternalServerError, "Search issues failed", err.Error())
		return
	}
	defer rows.Close()
	out := []salesforceIssueActionResponse{}
	for rows.Next() {
		var issueID, identifier, title, teamKey, status, category, priority string
		if err := rows.Scan(&issueID, &identifier, &title, &teamKey, &status, &category, &priority); err != nil {
			problem.Write(w, http.StatusInternalServerError, "Search issues failed", err.Error())
			return
		}
		out = append(out, salesforceIssueActionResponse{WebURL: issueBacklink(teamKey, identifier), IssueID: issueID, Project: teamKey, Identifier: identifier + " · " + title, Status: status, StatusCategory: category, Priority: priority})
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Search issues failed", err.Error())
		return
	}
	_ = h.recordSalesforceEvent(r.Context(), install, "issue_search_succeeded", "info", "Salesforce issue search completed.", map[string]any{"query": query, "count": len(out)})
	problem.JSON(w, http.StatusOK, salesforceIssueSearchResponse{Issues: out})
}

func (h Handler) SalesforceIssueLink(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.salesforceSignedAction(w, r)
	if !ok {
		return
	}
	issue, err := h.salesforceIssueForLink(r.Context(), install.WorkspaceID, firstNonEmpty(input.IssueID, input.Identifier))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Salesforce case failed", err.Error())
		return
	}
	if err := h.insertSalesforceCaseIssueLink(r.Context(), install, issue.ID, input.Case, input.Raw); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Salesforce case failed", err.Error())
		return
	}
	if err := h.queueSalesforceCaseStatus(r.Context(), install, issue); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Queue Salesforce status sync failed", err.Error())
		return
	}
	_ = h.recordSalesforceEvent(r.Context(), install, "case_issue_linked", "info", "Salesforce case linked to Exponential issue.", map[string]any{"issueId": issue.ID, "caseId": input.Case.ID, "caseNumber": input.Case.Number})
	problem.JSON(w, http.StatusOK, salesforceIssueActionResponse{WebURL: issueBacklink(issue.TeamKey, issue.Identifier), IssueID: issue.ID, Project: issue.TeamKey, Identifier: issue.Identifier, Status: issue.StatusName, StatusCategory: issue.StatusCategory, Priority: issue.Priority, CaseID: input.Case.ID, CaseNumber: input.Case.Number})
}

func (h Handler) SalesforceIssueCreate(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.salesforceSignedAction(w, r)
	if !ok {
		return
	}
	if existing, err := h.salesforceIssueForSource(r.Context(), install.IntegrationID, input.Case.ID); err == nil {
		problem.JSON(w, http.StatusOK, salesforceIssueActionResponse{WebURL: issueBacklink(existing.TeamKey, existing.Identifier), IssueID: existing.ID, Project: existing.TeamKey, Identifier: existing.Identifier, Status: existing.StatusName, StatusCategory: existing.StatusCategory, Priority: existing.Priority, CaseID: input.Case.ID, CaseNumber: input.Case.Number})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusInternalServerError, "Create Salesforce issue failed", err.Error())
		return
	}
	issue, err := h.createSalesforceIssue(r.Context(), install, input)
	if err != nil {
		_ = h.recordSalesforceEvent(r.Context(), install, "issue_creation_failed", "error", err.Error(), input.Raw)
		problem.Write(w, http.StatusBadRequest, "Create Salesforce issue failed", err.Error())
		return
	}
	_ = h.recordSalesforceEvent(r.Context(), install, "issue_created", "info", "Salesforce case created an Exponential issue.", map[string]any{"issueId": issue.ID, "caseId": input.Case.ID, "caseNumber": input.Case.Number})
	problem.JSON(w, http.StatusOK, salesforceIssueActionResponse{WebURL: issueBacklink(issue.TeamKey, issue.Identifier), IssueID: issue.ID, Project: issue.TeamKey, Identifier: issue.Identifier, Status: issue.StatusName, StatusCategory: issue.StatusCategory, Priority: issue.Priority, CaseID: input.Case.ID, CaseNumber: input.Case.Number})
}

func (h Handler) SalesforceProjectSearch(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.salesforceSignedAction(w, r)
	if !ok {
		return
	}
	query := strings.TrimSpace(input.Query)
	if query == "" {
		problem.JSON(w, http.StatusOK, salesforceProjectSearchResponse{Projects: []salesforceProjectActionResponse{}})
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		select p.id::text,p.name,p.slug,p.status::text,p.priority::text
		from project p
		where p.workspace_id=$1::uuid
			and (p.name ilike $2 or p.slug ilike $2)
			and not exists (
				select 1 from project_team pt join team t on t.id=pt.team_id
				where pt.project_id=p.id and coalesce(t.is_private,false)=true
			)
		order by p.updated_at desc
		limit 10`, install.WorkspaceID, "%"+escapeSalesforceLike(query)+"%")
	if err != nil {
		_ = h.recordSalesforceEvent(r.Context(), install, "project_search_failed", "error", err.Error(), input.Raw)
		problem.Write(w, http.StatusInternalServerError, "Search projects failed", err.Error())
		return
	}
	defer rows.Close()
	out := []salesforceProjectActionResponse{}
	for rows.Next() {
		var project salesforceProjectRow
		if err := rows.Scan(&project.ID, &project.Name, &project.Slug, &project.Status, &project.Priority); err != nil {
			problem.Write(w, http.StatusInternalServerError, "Search projects failed", err.Error())
			return
		}
		out = append(out, project.salesforceResponse())
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Search projects failed", err.Error())
		return
	}
	_ = h.recordSalesforceEvent(r.Context(), install, "project_search_succeeded", "info", "Salesforce project search completed.", map[string]any{"query": query, "count": len(out)})
	problem.JSON(w, http.StatusOK, salesforceProjectSearchResponse{Projects: out})
}

func (h Handler) SalesforceProjectLink(w http.ResponseWriter, r *http.Request) {
	install, input, ok := h.salesforceSignedAction(w, r)
	if !ok {
		return
	}
	project, err := h.salesforceProjectForLink(r.Context(), install.WorkspaceID, firstNonEmpty(input.ProjectID, input.ProjectSlug))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Project not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Salesforce case failed", err.Error())
		return
	}
	if err := h.insertSalesforceCaseProjectLink(r.Context(), install, project.ID, input.Case, input.Raw); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Salesforce case failed", err.Error())
		return
	}
	_ = h.recordSalesforceEvent(r.Context(), install, "case_project_linked", "info", "Salesforce case linked to Exponential project.", map[string]any{"projectId": project.ID, "caseId": input.Case.ID, "caseNumber": input.Case.Number})
	response := project.salesforceResponse()
	response.CaseID = input.Case.ID
	response.CaseNumber = input.Case.Number
	problem.JSON(w, http.StatusOK, response)
}

func (h Handler) salesforceSignedAction(w http.ResponseWriter, r *http.Request) (salesforceInstallRecord, salesforceCaseActionRequest, bool) {
	secret := salesforceComponentSecret()
	if secret == "" {
		problem.Write(w, http.StatusServiceUnavailable, "Salesforce component secret is not configured", "")
		return salesforceInstallRecord{}, salesforceCaseActionRequest{}, false
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Salesforce request body could not be read", err.Error())
		return salesforceInstallRecord{}, salesforceCaseActionRequest{}, false
	}
	if !verifySalesforceSignature(secret, r.Header.Get("X-Salesforce-Signature"), body) {
		problem.Write(w, http.StatusUnauthorized, "Invalid Salesforce signature", "")
		return salesforceInstallRecord{}, salesforceCaseActionRequest{}, false
	}
	var raw map[string]any
	if err := json.Unmarshal(body, &raw); err != nil {
		problem.Write(w, http.StatusBadRequest, "Salesforce payload is invalid", err.Error())
		return salesforceInstallRecord{}, salesforceCaseActionRequest{}, false
	}
	input := salesforceCaseActionFromPayload(raw)
	install, err := h.resolveSalesforceInstall(r.Context(), input)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Salesforce integration is not connected", "")
		return salesforceInstallRecord{}, salesforceCaseActionRequest{}, false
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Salesforce integration could not be resolved", err.Error())
		return salesforceInstallRecord{}, salesforceCaseActionRequest{}, false
	}
	return install, input, true
}

func salesforceCaseActionFromPayload(raw map[string]any) salesforceCaseActionRequest {
	data := recordValue(raw["data"])
	if data == nil {
		data = raw
	}
	caseRecord := firstRecord(raw["case"], raw["salesforceCase"], data["case"], data["salesforceCase"])
	orgRecord := firstRecord(raw["organization"], raw["org"], data["organization"], data["org"])
	caseID := firstNonEmpty(stringValue(raw["caseId"]), stringValue(raw["case_id"]), stringValue(data["caseId"]), stringValue(data["case_id"]), stringValue(caseRecord["id"]), stringValue(caseRecord["Id"]))
	caseNumber := firstNonEmpty(stringValue(raw["caseNumber"]), stringValue(raw["case_number"]), stringValue(data["caseNumber"]), stringValue(data["case_number"]), stringValue(caseRecord["caseNumber"]), stringValue(caseRecord["CaseNumber"]))
	caseURL := firstNonEmpty(stringValue(raw["caseUrl"]), stringValue(raw["caseURL"]), stringValue(raw["url"]), stringValue(data["caseUrl"]), stringValue(data["url"]), stringValue(caseRecord["url"]), stringValue(caseRecord["CaseUrl"]))
	instanceURL := firstNonEmpty(stringValue(raw["instanceUrl"]), stringValue(raw["instance_url"]), stringValue(data["instanceUrl"]), stringValue(data["instance_url"]), stringValue(caseRecord["instanceUrl"]), stringValue(caseRecord["InstanceUrl"]))
	caseRef := salesforceCaseRef{
		ID:             caseID,
		Number:         caseNumber,
		Subject:        firstNonEmpty(stringValue(raw["subject"]), stringValue(data["subject"]), stringValue(caseRecord["subject"]), stringValue(caseRecord["Subject"])),
		URL:            caseURL,
		AccountID:      firstNonEmpty(stringValue(raw["accountId"]), stringValue(data["accountId"]), stringValue(caseRecord["accountId"]), stringValue(caseRecord["AccountId"])),
		AccountName:    firstNonEmpty(stringValue(raw["accountName"]), stringValue(data["accountName"]), stringValue(caseRecord["accountName"]), stringValue(caseRecord["AccountName"])),
		ContactID:      firstNonEmpty(stringValue(raw["contactId"]), stringValue(data["contactId"]), stringValue(caseRecord["contactId"]), stringValue(caseRecord["ContactId"])),
		ContactName:    firstNonEmpty(stringValue(raw["contactName"]), stringValue(data["contactName"]), stringValue(caseRecord["contactName"]), stringValue(caseRecord["ContactName"])),
		ContactEmail:   strings.ToLower(firstNonEmpty(stringValue(raw["contactEmail"]), stringValue(data["contactEmail"]), stringValue(caseRecord["contactEmail"]), stringValue(caseRecord["ContactEmail"]))),
		RequesterEmail: strings.ToLower(firstNonEmpty(stringValue(raw["requesterEmail"]), stringValue(data["requesterEmail"]), stringValue(caseRecord["requesterEmail"]))),
		InstanceURL:    instanceURL,
		Metadata:       recordValue(caseRecord["metadata"]),
	}
	return salesforceCaseActionRequest{
		OrganizationID: firstNonEmpty(stringValue(raw["organizationId"]), stringValue(raw["orgId"]), stringValue(raw["salesforceOrgId"]), stringValue(data["organizationId"]), stringValue(data["orgId"]), stringValue(orgRecord["id"]), stringValue(orgRecord["organization_id"])),
		Query:          firstNonEmpty(stringValue(raw["query"]), stringValue(raw["q"]), stringValue(data["query"]), stringValue(data["q"])),
		IssueID:        firstNonEmpty(stringValue(raw["exponentialIssueId"]), stringValue(raw["issueIdentifier"]), stringValue(raw["identifier"]), stringValue(data["exponentialIssueId"]), stringValue(data["issueIdentifier"]), stringValue(data["identifier"])),
		Identifier:     firstNonEmpty(stringValue(raw["identifier"]), stringValue(data["identifier"])),
		ProjectID:      firstNonEmpty(stringValue(raw["projectId"]), stringValue(raw["exponentialProjectId"]), stringValue(data["projectId"]), stringValue(data["exponentialProjectId"])),
		ProjectSlug:    firstNonEmpty(stringValue(raw["projectSlug"]), stringValue(raw["slug"]), stringValue(data["projectSlug"]), stringValue(data["slug"])),
		Title:          firstNonEmpty(stringValue(raw["title"]), stringValue(data["title"]), caseRef.Subject),
		Description:    firstNonEmpty(stringValue(raw["description"]), stringValue(data["description"]), stringValue(caseRecord["Description"]), stringValue(caseRecord["description"])),
		TeamID:         firstNonEmpty(stringValue(raw["teamId"]), stringValue(raw["team_id"]), stringValue(data["teamId"]), stringValue(data["team_id"])),
		TeamKey:        firstNonEmpty(stringValue(raw["teamKey"]), stringValue(raw["team"]), stringValue(data["teamKey"]), stringValue(data["team"])),
		Priority:       firstNonEmpty(stringValue(raw["priority"]), stringValue(data["priority"]), stringValue(caseRecord["Priority"]), stringValue(caseRecord["priority"])),
		Case:           caseRef,
		Raw:            raw,
	}
}

func (h Handler) resolveSalesforceInstall(ctx context.Context, input salesforceCaseActionRequest) (salesforceInstallRecord, error) {
	orgID := strings.TrimSpace(input.OrganizationID)
	if orgID == "" {
		return salesforceInstallRecord{}, pgx.ErrNoRows
	}
	var install salesforceInstallRecord
	var metadataRaw []byte
	err := h.DB.QueryRow(ctx, `
		select workspace_id::text,id::text,coalesce(connected_by_user_id,''),coalesce(external_id,''),coalesce(display_name,''),coalesce(metadata,'{}'::jsonb)
		from workspace_integration
		where provider='salesforce'
			and status in ('connected','degraded')
			and (external_id=$1 or metadata->>'orgId'=$1 or metadata->>'organizationId'=$1)
		order by connected_at desc
		limit 1`, orgID).Scan(&install.WorkspaceID, &install.IntegrationID, &install.ConnectedBy, &install.ExternalID, &install.DisplayName, &metadataRaw)
	if err != nil {
		return install, err
	}
	install.Metadata = readJSONRecord(metadataRaw)
	return install, nil
}

type salesforceIssueRow struct {
	ID             string
	Identifier     string
	Title          string
	TeamKey        string
	StatusName     string
	StatusCategory string
	Priority       string
}

func (h Handler) salesforceIssueForLink(ctx context.Context, workspaceID, requested string) (salesforceIssueRow, error) {
	var issue salesforceIssueRow
	requested = strings.TrimSpace(requested)
	where := "upper(i.identifier)=upper($2)"
	if isUUIDish(requested) {
		where = "(i.id=$2::uuid or upper(i.identifier)=upper($2))"
	}
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,t.key,ws.name,ws.category::text,i.priority::text
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		where t.workspace_id=$1::uuid
			and coalesce(t.is_private,false)=false
			and i.archived_at is null
			and `+where+`
		limit 1`, workspaceID, requested).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey, &issue.StatusName, &issue.StatusCategory, &issue.Priority)
	return issue, err
}

func (h Handler) salesforceIssueForSource(ctx context.Context, integrationID, caseID string) (salesforceIssueRow, error) {
	var issue salesforceIssueRow
	err := h.DB.QueryRow(ctx, `
		select i.id::text,i.identifier,i.title,t.key,ws.name,ws.category::text,i.priority::text
		from integration_thread_link itl
		join issue i on i.id=itl.issue_id
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		where itl.workspace_integration_id=$1::uuid and itl.provider='salesforce' and itl.source_event_id=$2
		limit 1`, integrationID, caseID).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamKey, &issue.StatusName, &issue.StatusCategory, &issue.Priority)
	return issue, err
}

type salesforceProjectRow struct {
	ID       string
	Name     string
	Slug     string
	Status   string
	Priority string
}

func (p salesforceProjectRow) salesforceResponse() salesforceProjectActionResponse {
	return salesforceProjectActionResponse{WebURL: strings.TrimRight(configuredAppURL(), "/") + "/project/" + url.PathEscape(p.Slug), ProjectID: p.ID, Name: p.Name, Slug: p.Slug, Status: p.Status, Priority: p.Priority}
}

func (h Handler) salesforceProjectForLink(ctx context.Context, workspaceID, requested string) (salesforceProjectRow, error) {
	var project salesforceProjectRow
	requested = strings.TrimSpace(requested)
	where := "p.slug=$2"
	if isUUIDish(requested) {
		where = "(p.id=$2::uuid or p.slug=$2)"
	}
	err := h.DB.QueryRow(ctx, `
		select p.id::text,p.name,p.slug,p.status::text,p.priority::text
		from project p
		where p.workspace_id=$1::uuid
			and `+where+`
			and not exists (
				select 1 from project_team pt join team t on t.id=pt.team_id
				where pt.project_id=p.id and coalesce(t.is_private,false)=true
			)
		limit 1`, workspaceID, requested).Scan(&project.ID, &project.Name, &project.Slug, &project.Status, &project.Priority)
	return project, err
}

func (h Handler) createSalesforceIssue(ctx context.Context, install salesforceInstallRecord, input salesforceCaseActionRequest) (salesforceIssueRow, error) {
	if strings.TrimSpace(input.Case.ID) == "" {
		return salesforceIssueRow{}, fmt.Errorf("Salesforce case id is required")
	}
	title := strings.TrimSpace(firstNonEmpty(input.Title, input.Case.Subject, input.Case.Number))
	if title == "" {
		return salesforceIssueRow{}, fmt.Errorf("title is required")
	}
	priority := salesforcePriority(input.Priority)
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return salesforceIssueRow{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	team, err := h.sentryPublicTeam(ctx, tx, install.WorkspaceID, input.TeamID, input.TeamKey)
	if err != nil {
		return salesforceIssueRow{}, err
	}
	stateID, err := slackIssueStateByCategory(ctx, tx, team.ID, "backlog")
	if err != nil {
		return salesforceIssueRow{}, err
	}
	creatorID := install.ConnectedBy
	if creatorID == "" {
		creatorID, err = h.workspaceIssueCreator(ctx, install.WorkspaceID)
		if err != nil {
			return salesforceIssueRow{}, err
		}
	}
	var nextNumber int32
	if err := tx.QueryRow(ctx, `select coalesce(max(number),0)+1 from issue where team_id=$1::uuid`, team.ID).Scan(&nextNumber); err != nil {
		return salesforceIssueRow{}, err
	}
	identifier := fmt.Sprintf("%s-%d", team.Key, nextNumber)
	description := salesforceIssueDescriptionHTML(input.Description, input.Case)
	var issueID string
	if err := tx.QueryRow(ctx, `
		insert into issue (number,identifier,title,description,team_id,state_id,creator_id,priority)
		values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8)
		returning id::text`, nextNumber, identifier, title, description, team.ID, stateID, creatorID, priority).Scan(&issueID); err != nil {
		return salesforceIssueRow{}, err
	}
	history := map[string]any{"identifier": identifier, "title": title, "teamId": team.ID, "source": "salesforce_case", "salesforce": map[string]any{"caseId": input.Case.ID, "caseNumber": input.Case.Number, "caseUrl": salesforceCaseURL(install, input.Case), "orgId": install.ExternalID, "accountId": input.Case.AccountID, "contactId": input.Case.ContactID}}
	historyRaw, _ := json.Marshal(history)
	if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,actor_name,actor_email,event_type,metadata) values ($1::uuid,$2,'Salesforce',null,'created',$3::jsonb)`, issueID, nullString(creatorID), historyRaw); err != nil {
		return salesforceIssueRow{}, err
	}
	if err := h.insertSalesforceCaseIssueLinkTx(ctx, tx, install, issueID, input.Case, input.Raw); err != nil {
		return salesforceIssueRow{}, err
	}
	issue := salesforceIssueRow{ID: issueID, Identifier: identifier, Title: title, TeamKey: team.Key, StatusName: "Backlog", StatusCategory: "backlog", Priority: priority}
	if err := h.queueSalesforceCaseStatusTx(ctx, tx, install, issue); err != nil {
		return salesforceIssueRow{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return salesforceIssueRow{}, err
	}
	return issue, nil
}

type salesforceLinkExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (h Handler) insertSalesforceCaseIssueLink(ctx context.Context, install salesforceInstallRecord, issueID string, caseRef salesforceCaseRef, raw map[string]any) error {
	return h.insertSalesforceCaseIssueLinkTx(ctx, h.DB, install, issueID, caseRef, raw)
}

func (h Handler) insertSalesforceCaseIssueLinkTx(ctx context.Context, q salesforceLinkExecutor, install salesforceInstallRecord, issueID string, caseRef salesforceCaseRef, raw map[string]any) error {
	if strings.TrimSpace(caseRef.ID) == "" {
		return fmt.Errorf("Salesforce case id is required")
	}
	metadataRaw, err := json.Marshal(salesforceSourceMetadata(install, caseRef, raw))
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, `
		insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id, external_metadata)
		values ($1::uuid,$2::uuid,'salesforce',$3::uuid,$4,'case',$5,$6,$7,'inbound',$5,$8::jsonb)
		on conflict (workspace_integration_id, source_event_id) where workspace_integration_id is not null and source_event_id is not null
		do update set issue_id=excluded.issue_id, external_permalink=excluded.external_permalink, external_metadata=integration_thread_link.external_metadata || excluded.external_metadata, updated_at=now()`, install.WorkspaceID, install.IntegrationID, issueID, install.ExternalID, caseRef.ID, firstNonEmpty(caseRef.Number, caseRef.ID), salesforceCaseURL(install, caseRef), metadataRaw)
	return err
}

func (h Handler) insertSalesforceCaseProjectLink(ctx context.Context, install salesforceInstallRecord, projectID string, caseRef salesforceCaseRef, raw map[string]any) error {
	if strings.TrimSpace(caseRef.ID) == "" {
		return fmt.Errorf("Salesforce case id is required")
	}
	metadataRaw, err := json.Marshal(salesforceSourceMetadata(install, caseRef, raw))
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into integration_thread_link (workspace_id, workspace_integration_id, provider, project_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id, external_metadata)
		values ($1::uuid,$2::uuid,'salesforce',$3::uuid,$4,'case',$5,$6,$7,'inbound',$5,$8::jsonb)
		on conflict (workspace_integration_id, source_event_id) where workspace_integration_id is not null and source_event_id is not null
		do update set project_id=excluded.project_id, external_permalink=excluded.external_permalink, external_metadata=integration_thread_link.external_metadata || excluded.external_metadata, updated_at=now()`, install.WorkspaceID, install.IntegrationID, projectID, install.ExternalID, caseRef.ID, firstNonEmpty(caseRef.Number, caseRef.ID), salesforceCaseURL(install, caseRef), metadataRaw)
	return err
}

func salesforceSourceMetadata(install salesforceInstallRecord, caseRef salesforceCaseRef, raw map[string]any) map[string]any {
	return map[string]any{
		"provider":       "salesforce",
		"sourceType":     "case",
		"orgId":          install.ExternalID,
		"instanceUrl":    firstNonEmpty(caseRef.InstanceURL, stringValue(install.Metadata["instanceUrl"])),
		"caseId":         caseRef.ID,
		"caseNumber":     caseRef.Number,
		"caseUrl":        salesforceCaseURL(install, caseRef),
		"accountId":      caseRef.AccountID,
		"accountName":    caseRef.AccountName,
		"contactId":      caseRef.ContactID,
		"contactName":    caseRef.ContactName,
		"contactEmail":   caseRef.ContactEmail,
		"requesterEmail": caseRef.RequesterEmail,
		"raw":            raw,
	}
}

func salesforceCaseURL(install salesforceInstallRecord, caseRef salesforceCaseRef) string {
	if strings.TrimSpace(caseRef.URL) != "" {
		return strings.TrimSpace(caseRef.URL)
	}
	base := firstNonEmpty(caseRef.InstanceURL, stringValue(install.Metadata["instanceUrl"]))
	if base == "" || caseRef.ID == "" {
		return ""
	}
	return strings.TrimRight(base, "/") + "/" + url.PathEscape(caseRef.ID)
}

func (h Handler) queueSalesforceCaseStatus(ctx context.Context, install salesforceInstallRecord, issue salesforceIssueRow) error {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := h.queueSalesforceCaseStatusTx(ctx, tx, install, issue); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h Handler) queueSalesforceCaseStatusTx(ctx context.Context, tx pgx.Tx, install salesforceInstallRecord, issue salesforceIssueRow) error {
	payload := map[string]any{"type": "sync_case_status", "issueId": issue.ID, "identifier": issue.Identifier, "status": issue.StatusName, "statusCategory": issue.StatusCategory, "priority": issue.Priority, "issueUrl": issueBacklink(issue.TeamKey, issue.Identifier)}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at) values ($1::uuid,$2::uuid,'salesforce','outbound_delivery','queued',$3::jsonb,now(),now())`, install.WorkspaceID, install.IntegrationID, raw)
	return err
}

func salesforceIssueDescriptionHTML(description string, caseRef salesforceCaseRef) string {
	description = strings.TrimSpace(description)
	if description == "" {
		description = strings.TrimSpace(caseRef.Subject)
	}
	if strings.Contains(description, "<") {
		description = sanitizehtml.RichText(description)
	} else if description != "" {
		description = "<p>" + htmlEscapeParagraph(description) + "</p>"
	}
	parts := []string{}
	if caseRef.AccountName != "" {
		parts = append(parts, "Account: "+htmlEscapeParagraph(caseRef.AccountName))
	}
	if firstNonEmpty(caseRef.ContactName, caseRef.ContactEmail, caseRef.RequesterEmail) != "" {
		parts = append(parts, "Requester: "+htmlEscapeParagraph(firstNonEmpty(caseRef.ContactName, caseRef.ContactEmail, caseRef.RequesterEmail)))
	}
	for _, part := range parts {
		description += "<p>" + part + "</p>"
	}
	if caseRef.URL != "" {
		description += `<p><a href="` + htmlEscapeAttribute(caseRef.URL) + `">View source case in Salesforce</a></p>`
	}
	return sanitizehtml.RichText(description)
}

func salesforcePriority(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "urgent", "critical", "p0":
		return "urgent"
	case "high", "p1":
		return "high"
	case "medium", "normal", "p2":
		return "medium"
	case "low", "p3":
		return "low"
	default:
		return "none"
	}
}

func (h Handler) saveSalesforceOAuthState(ctx context.Context, workspaceID string, userID string, state string) error {
	now := time.Now().UTC()
	metadata := map[string]any{"oauthStateHash": hashSlackSecret(state), "oauthStateExpiresAt": now.Add(10 * time.Minute).Format(time.RFC3339Nano), "oauthStartedAt": now.Format(time.RFC3339Nano), "syncStatusEnabled": true, "completionFollowUpEnabled": true}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `
		insert into workspace_integration (workspace_id, provider, status, metadata, connected_by_user_id, connected_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at)
		values ($1::uuid, 'salesforce', 'installing', $2::jsonb, $3, null, null, null, null, now())
		on conflict (workspace_id, provider) do update set status='installing', metadata=excluded.metadata, connected_by_user_id=excluded.connected_by_user_id, credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=now()`, workspaceID, raw, userID)
	return err
}

func (h Handler) findSalesforceOAuthInstall(ctx context.Context, state string) (salesforceOAuthInstall, error) {
	rows, err := h.DB.Query(ctx, `select id::text, workspace_id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb) from workspace_integration where provider='salesforce' and status='installing'`)
	if err != nil {
		return salesforceOAuthInstall{}, err
	}
	defer rows.Close()
	stateHash := hashSlackSecret(state)
	for rows.Next() {
		var install salesforceOAuthInstall
		var metadataRaw []byte
		if err := rows.Scan(&install.ID, &install.WorkspaceID, &install.UserID, &metadataRaw); err != nil {
			return salesforceOAuthInstall{}, err
		}
		install.Metadata = readJSONRecord(metadataRaw)
		if stringValue(install.Metadata["oauthStateHash"]) != stateHash {
			continue
		}
		expiresAt, _ := time.Parse(time.RFC3339Nano, stringValue(install.Metadata["oauthStateExpiresAt"]))
		if expiresAt.IsZero() || expiresAt.Before(time.Now().UTC()) {
			return salesforceOAuthInstall{}, pgx.ErrNoRows
		}
		return install, nil
	}
	if err := rows.Err(); err != nil {
		return salesforceOAuthInstall{}, err
	}
	return salesforceOAuthInstall{}, pgx.ErrNoRows
}

func (h Handler) completeSalesforceInstall(ctx context.Context, install salesforceOAuthInstall, token salesforceOAuthResponse, info salesforceUserInfo) error {
	if token.AccessToken == "" || token.InstanceURL == "" || info.OrganizationID == "" {
		return fmt.Errorf("Salesforce OAuth response did not include access token, instance URL, and organization")
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	now := time.Now().UTC()
	metadata := map[string]any{"orgId": info.OrganizationID, "orgName": firstNonEmpty(info.OrganizationName, info.OrganizationID), "instanceUrl": token.InstanceURL, "userId": info.UserID, "username": firstNonEmpty(info.Username, info.Email), "scopes": strings.Fields(token.Scope), "installedBy": install.UserID, "syncStatusEnabled": true, "completionFollowUpEnabled": true}
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update workspace_integration
		set status='connected', external_id=$2, display_name=$3, metadata=$4::jsonb, connected_by_user_id=$5, connected_at=coalesce(connected_at,$6), last_event_at=$6, last_success_at=$6, last_failure_at=null, last_failure_message=null, token_expires_at=null, credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=$6
		where id=$1::uuid`, install.ID, info.OrganizationID, firstNonEmpty(info.OrganizationName, info.OrganizationID), metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at,$2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, install.ID, now); err != nil {
		return err
	}
	credential := map[string]any{"accessToken": token.AccessToken, "refreshToken": token.RefreshToken, "tokenType": token.TokenType, "instanceUrl": token.InstanceURL, "scope": token.Scope, "orgId": info.OrganizationID, "apiVersion": salesforceAPIVersion()}
	credentialRaw, err := encryptedProviderCredentialJSON(credential)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid,'salesforce',$2,$3::jsonb,$4,$5,$5)`, install.ID, credentialRaw, metadataRaw, install.UserID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'salesforce','oauth_connected','info','Salesforce org connected.',$3::jsonb,$4)`, install.WorkspaceID, install.ID, metadataRaw, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h Handler) recordSalesforceInstallFailure(ctx context.Context, integrationID string, workspaceID string, message string) error {
	_, err := h.DB.Exec(ctx, `update workspace_integration set status='error', last_failure_at=now(), last_failure_message=$2, updated_at=now() where id=$1::uuid`, integrationID, message)
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'salesforce','oauth_failed','error',$3,'{}'::jsonb)`, workspaceID, integrationID, message)
	return err
}

func (h Handler) recordSalesforceEvent(ctx context.Context, install salesforceInstallRecord, eventType, severity, message string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	_, err := h.DB.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload) values ($1::uuid,$2::uuid,'salesforce',$3,$4,$5,$6::jsonb)`, install.WorkspaceID, install.IntegrationID, eventType, severity, message, raw)
	return err
}

func salesforceOAuthConfig() (clientID string, clientSecret string, ok bool) {
	clientID = strings.TrimSpace(os.Getenv("AUTH_SALESFORCE_ID"))
	clientSecret = strings.TrimSpace(os.Getenv("AUTH_SALESFORCE_SECRET"))
	return clientID, clientSecret, clientID != "" && clientSecret != ""
}

func salesforceConfigured() bool {
	_, _, ok := salesforceOAuthConfig()
	return ok && salesforceComponentSecret() != ""
}

func salesforceComponentSecret() string {
	return strings.TrimSpace(os.Getenv("SALESFORCE_COMPONENT_SECRET"))
}

func salesforceRedirectURI(appURL string) string {
	return strings.TrimRight(appURL, "/") + "/api/integrations/salesforce/oauth/callback"
}

func salesforceAuthorizationURL(clientID, appURL, state string) string {
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("response_type", "code")
	values.Set("redirect_uri", salesforceRedirectURI(appURL))
	values.Set("scope", "api refresh_token id openid")
	values.Set("state", state)
	return salesforceOAuthBaseURL() + "/services/oauth2/authorize?" + values.Encode()
}

func salesforceRedirectURL(status string, message string) string {
	values := url.Values{}
	values.Set("salesforce", status)
	if strings.TrimSpace(message) != "" {
		values.Set("message", message)
	}
	return strings.TrimRight(configuredAppURL(), "/") + "/settings/integrations?" + values.Encode()
}

func salesforceOAuthBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("SALESFORCE_OAUTH_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "https://login.salesforce.com"
}

func salesforceAPIVersion() string {
	if v := strings.TrimSpace(os.Getenv("SALESFORCE_API_VERSION")); v != "" {
		return strings.TrimPrefix(v, "v")
	}
	return "60.0"
}

func exchangeSalesforceOAuth(ctx context.Context, client *http.Client, clientID, clientSecret, code string, redirectURI string) (salesforceOAuthResponse, error) {
	values := url.Values{}
	values.Set("grant_type", "authorization_code")
	values.Set("client_id", clientID)
	values.Set("client_secret", clientSecret)
	values.Set("code", code)
	values.Set("redirect_uri", redirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, salesforceOAuthBaseURL()+"/services/oauth2/token", strings.NewReader(values.Encode()))
	if err != nil {
		return salesforceOAuthResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := client.Do(req)
	if err != nil {
		return salesforceOAuthResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(resp.Body)
		return salesforceOAuthResponse{}, fmt.Errorf("Salesforce OAuth returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var token salesforceOAuthResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return salesforceOAuthResponse{}, err
	}
	return token, nil
}

func fetchSalesforceUserInfo(ctx context.Context, client *http.Client, token salesforceOAuthResponse) (salesforceUserInfo, error) {
	endpoint := strings.TrimSpace(token.ID)
	if endpoint == "" {
		endpoint = strings.TrimRight(firstNonEmpty(token.InstanceURL, salesforceOAuthBaseURL()), "/") + "/services/oauth2/userinfo"
	}
	if !strings.HasPrefix(endpoint, salesforceOAuthBaseURL()) {
		return salesforceUserInfo{}, fmt.Errorf("unexpected Salesforce userinfo endpoint")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return salesforceUserInfo{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	resp, err := client.Do(req)
	if err != nil {
		return salesforceUserInfo{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(resp.Body)
		return salesforceUserInfo{}, fmt.Errorf("Salesforce userinfo returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var info salesforceUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return salesforceUserInfo{}, err
	}
	if info.OrganizationID == "" {
		return salesforceUserInfo{}, fmt.Errorf("Salesforce userinfo did not include organization_id")
	}
	return info, nil
}

func verifySalesforceSignature(secret string, signature string, body []byte) bool {
	if secret == "" || signature == "" {
		return false
	}
	signature = strings.TrimPrefix(strings.TrimSpace(signature), "sha256=")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) == 1
}

func salesforceSignature(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func escapeSalesforceLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

func patchSalesforceCase(ctx context.Context, client *http.Client, credential salesforceCredential, caseID string, body map[string]any) error {
	if strings.TrimSpace(caseID) == "" {
		return fmt.Errorf("Salesforce case id is required")
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	endpoint := strings.TrimRight(credential.InstanceURL, "/") + "/services/data/v" + credential.APIVersion + "/sobjects/Case/" + url.PathEscape(caseID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+credential.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent || (resp.StatusCode >= 200 && resp.StatusCode < 300) {
		return nil
	}
	return fmt.Errorf("Salesforce case update returned HTTP %d", resp.StatusCode)
}
