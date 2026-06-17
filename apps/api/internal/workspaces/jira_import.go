package workspaces

import (
	"context"
	"encoding/base64"
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

	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

// jiraTruncatedError is returned by issues() when the Jira total exceeds the
// number of issues fetched (i.e. caller passed a hard cap).
type jiraTruncatedError struct {
	fetched int
	total   int
}

func (e *jiraTruncatedError) Error() string {
	return fmt.Sprintf("jira returned %d of %d total issues; import may be incomplete", e.fetched, e.total)
}

type jiraCredential struct {
	Deployment string `json:"deployment"`
	BaseURL    string `json:"baseUrl"`
	Email      string `json:"email,omitempty"`
	Token      string `json:"token"`
}

type jiraConfiguredResponse struct {
	IntegrationID string        `json:"integrationId"`
	DisplayName   string        `json:"displayName"`
	Projects      []jiraProject `json:"projects"`
}

type jiraProject struct {
	ID   string `json:"id"`
	Key  string `json:"key"`
	Name string `json:"name"`
	Self string `json:"self,omitempty"`
}

type jiraStatus struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type jiraPriority struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type jiraUser struct {
	AccountID    string `json:"accountId"`
	Name         string `json:"name"`
	DisplayName  string `json:"displayName"`
	EmailAddress string `json:"emailAddress"`
}

type jiraComment struct {
	ID      string   `json:"id"`
	Body    any      `json:"body"`
	Author  jiraUser `json:"author"`
	Created string   `json:"created"`
	Updated string   `json:"updated"`
}

type jiraCommentPage struct {
	Comments []jiraComment `json:"comments"`
}

type jiraIssue struct {
	ID     string `json:"id"`
	Key    string `json:"key"`
	Fields struct {
		Summary     string          `json:"summary"`
		Description any             `json:"description"`
		Status      jiraStatus      `json:"status"`
		Priority    *jiraPriority   `json:"priority"`
		Assignee    *jiraUser       `json:"assignee"`
		Reporter    *jiraUser       `json:"reporter"`
		Labels      []string        `json:"labels"`
		Created     string          `json:"created"`
		Updated     string          `json:"updated"`
		Comment     jiraCommentPage `json:"comment"`
		Project     jiraProject     `json:"project"`
	} `json:"fields"`
}

type jiraSearchResponse struct {
	StartAt int         `json:"startAt"`
	Total   int         `json:"total"`
	Issues  []jiraIssue `json:"issues"`
}

type jiraPreviewIssue struct {
	ID          string   `json:"id"`
	Key         string   `json:"key"`
	Title       string   `json:"title"`
	Status      string   `json:"status"`
	Priority    string   `json:"priority"`
	Assignee    string   `json:"assignee"`
	Labels      []string `json:"labels"`
	CommentCount int     `json:"commentCount"`
	SourceURL   string   `json:"sourceUrl"`
	Errors      []string `json:"errors"`
}

type jiraImportSummary struct {
	ImportedCount int `json:"importedCount"`
	UpdatedCount  int `json:"updatedCount"`
	CommentCount  int `json:"commentCount"`
	SkippedCount  int `json:"skippedCount"`
}

type jiraInstall struct {
	ID          string
	WorkspaceID string
	DisplayName string
	Credential  jiraCredential
	Metadata    map[string]any
}

type jiraClient struct {
	credential jiraCredential
	client     *http.Client
}

func (h Handler) handleJiraConfigure(w http.ResponseWriter, r *http.Request, current importExportWorkspace, p auth.Principal, body map[string]any) {
	credential, err := readJiraCredentialInput(body)
	if err != nil {
		problem.Write(w, 400, "Invalid Jira configuration", err.Error())
		return
	}
	client := jiraClient{credential: credential, client: http.DefaultClient}
	var account jiraUser
	if err := client.getJSON(r.Context(), "/rest/api/"+jiraAPIVersion(credential.Deployment)+"/myself", &account); err != nil {
		problem.Write(w, 502, "Jira credentials could not be validated", err.Error())
		return
	}
	projects, err := client.projects(r.Context())
	if err != nil {
		problem.Write(w, 502, "Jira projects could not be loaded", err.Error())
		return
	}
	integrationID, err := h.saveJiraIntegration(r.Context(), current.ID, p.UserID, credential, account, projects)
	if err != nil {
		problem.Write(w, 500, "Save Jira configuration failed", err.Error())
		return
	}
	problem.JSON(w, 201, jiraConfiguredResponse{IntegrationID: integrationID, DisplayName: jiraDisplayName(credential), Projects: projects})
}

func (h Handler) handleJiraPreview(w http.ResponseWriter, r *http.Request, current importExportWorkspace, body map[string]any) {
	install, ok := h.requireJiraInstall(w, r.Context(), current.ID)
	if !ok {
		return
	}
	projects, err := (jiraClient{credential: install.Credential, client: http.DefaultClient}).projects(r.Context())
	if err != nil {
		problem.Write(w, 502, "Jira projects could not be loaded", err.Error())
		return
	}
	projectKey := strings.TrimSpace(asStringValue(body["projectKey"]))
	if projectKey == "" {
		problem.JSON(w, 200, map[string]any{"integrationId": install.ID, "projects": projects})
		return
	}
	teamID := strings.TrimSpace(asStringValue(body["teamId"]))
	teams, err := h.legacyImportTeams(r.Context(), current.ID)
	if err != nil {
		problem.Write(w, 500, "Load Jira import teams failed", err.Error())
		return
	}
	if teamID == "" && len(teams) > 0 {
		teamID = asStringValue(teams[0]["id"])
	}
	if teamID == "" || !h.teamInWorkspace(r.Context(), teamID, current.ID) {
		problem.Write(w, 400, "Choose a valid target team.", "")
		return
	}
	states, err := h.importStates(r.Context(), teamID)
	if err != nil {
		problem.Write(w, 500, "Load workflow states failed", err.Error())
		return
	}
	issues, err := (jiraClient{credential: install.Credential, client: http.DefaultClient}).issues(r.Context(), projectKey, 0)
	var truncated *jiraTruncatedError
	if err != nil && !errors.As(err, &truncated) {
		problem.Write(w, 502, "Jira issues could not be loaded", err.Error())
		return
	}
	preview, statuses := buildJiraPreview(install.Credential, issues)
	resp := map[string]any{
		"integrationId": install.ID,
		"projects":      projects,
		"projectKey":    projectKey,
		"issues":        preview,
		"statusOptions": statuses,
		"teamStates":    states,
		"mapping":       map[string]any{"teamId": teamID, "statuses": suggestJiraStatusMapping(statuses, states)},
	}
	if truncated != nil {
		resp["warning"] = truncated.Error()
	}
	problem.JSON(w, 200, resp)
}

func (h Handler) handleJiraImport(w http.ResponseWriter, r *http.Request, current importExportWorkspace, p auth.Principal, body map[string]any) {
	install, ok := h.requireJiraInstall(w, r.Context(), current.ID)
	if !ok {
		return
	}
	projectKey := strings.TrimSpace(asStringValue(body["projectKey"]))
	teamID := strings.TrimSpace(asStringValue(body["teamId"]))
	if projectKey == "" {
		problem.Write(w, 400, "Choose a Jira project.", "")
		return
	}
	if teamID == "" || !h.teamInWorkspace(r.Context(), teamID, current.ID) {
		problem.Write(w, 400, "Choose a valid target team.", "")
		return
	}
	mapping, err := h.validateJiraStatusMapping(r.Context(), teamID, recordFromAny(body["statusMapping"]))
	if err != nil {
		problem.Write(w, 400, "Invalid Jira status mapping", err.Error())
		return
	}
	issues, err := (jiraClient{credential: install.Credential, client: http.DefaultClient}).issues(r.Context(), projectKey, 0)
	var truncatedImport *jiraTruncatedError
	if err != nil && !errors.As(err, &truncatedImport) {
		problem.Write(w, 502, "Jira issues could not be loaded", err.Error())
		return
	}
	if len(issues) == 0 {
		problem.Write(w, 400, "No Jira issues matched this project.", "")
		return
	}
	summary, err := h.importJiraIssues(r.Context(), p, install, teamID, mapping, issues, boolFromAnyDefault(body["importComments"], true), boolFromAnyDefault(body["importLabels"], true), boolFromAnyDefault(body["forwardSyncEnabled"], false))
	if err != nil {
		problem.Write(w, 500, "Jira import failed", err.Error())
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	job := map[string]any{"id": importExportJobID("import"), "type": "import", "provider": "jira", "status": "completed", "createdAt": now, "completedAt": now, "message": fmt.Sprintf("Jira import completed with %d created and %d updated issues.", summary.ImportedCount, summary.UpdatedCount), "rowCount": len(issues), "importedCount": summary.ImportedCount, "updatedCount": summary.UpdatedCount, "commentCount": summary.CommentCount, "errorCount": 0}
	state := readImportExportStateGo(current.Settings)
	state.Imports = prependJob(job, state.Imports, 25)
	if err := h.saveImportExportState(r.Context(), current, state); err != nil {
		problem.Write(w, 500, "Save Jira import history failed", err.Error())
		return
	}
	importResp := map[string]any{"import": job, "summary": summary}
	if truncatedImport != nil {
		importResp["warning"] = truncatedImport.Error()
	}
	problem.JSON(w, 201, importResp)
}

func (h Handler) handleJiraSyncPause(w http.ResponseWriter, r *http.Request, current importExportWorkspace, p auth.Principal, body map[string]any, paused bool) {
	install, ok := h.requireJiraInstall(w, r.Context(), current.ID)
	if !ok {
		return
	}
	projectKey := strings.TrimSpace(asStringValue(body["projectKey"]))
	teamID := strings.TrimSpace(asStringValue(body["teamId"]))
	if projectKey == "" || teamID == "" {
		problem.Write(w, 400, "Jira project and team are required.", "")
		return
	}
	var err error
	if paused {
		_, err = h.DB.Exec(r.Context(), `update jira_project_mapping set paused_at=now(), paused_by_user_id=$4, updated_by_user_id=$4, updated_at=now() where workspace_id=$1::uuid and workspace_integration_id=$2::uuid and jira_project_key=$3 and team_id=$5::uuid`, current.ID, install.ID, projectKey, p.UserID, teamID)
	} else {
		_, err = h.DB.Exec(r.Context(), `update jira_project_mapping set paused_at=null, paused_by_user_id=null, updated_by_user_id=$4, updated_at=now() where workspace_id=$1::uuid and workspace_integration_id=$2::uuid and jira_project_key=$3 and team_id=$5::uuid`, current.ID, install.ID, projectKey, p.UserID, teamID)
	}
	if err != nil {
		problem.Write(w, 500, "Update Jira sync pause failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true, "paused": paused})
}

func readJiraCredentialInput(body map[string]any) (jiraCredential, error) {
	deployment := strings.ToLower(strings.TrimSpace(stringOr(body["deployment"], "cloud")))
	if deployment != "cloud" && deployment != "server" {
		return jiraCredential{}, errors.New("deployment must be cloud or server")
	}
	baseURL, err := normalizeJiraBaseURL(asStringValue(body["baseUrl"]))
	if err != nil {
		return jiraCredential{}, err
	}
	email := strings.TrimSpace(asStringValue(body["email"]))
	token := strings.TrimSpace(asStringValue(body["token"]))
	if token == "" {
		return jiraCredential{}, errors.New("token is required")
	}
	if deployment == "cloud" && email == "" {
		return jiraCredential{}, errors.New("email is required for Jira Cloud API tokens")
	}
	return jiraCredential{Deployment: deployment, BaseURL: baseURL, Email: email, Token: token}, nil
}

func normalizeJiraBaseURL(value string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(value), "/")
	if trimmed == "" {
		return "", errors.New("baseUrl is required")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || parsed.Scheme == "" {
		return "", errors.New("baseUrl must be an absolute HTTPS URL")
	}
	if parsed.Scheme != "https" {
		return "", errors.New("baseUrl must use HTTPS")
	}
	return parsed.String(), nil
}

func jiraAPIVersion(deployment string) string {
	if deployment == "server" {
		return "2"
	}
	return "3"
}

func (c jiraClient) projects(ctx context.Context) ([]jiraProject, error) {
	var projects []jiraProject
	if err := c.getJSON(ctx, "/rest/api/"+jiraAPIVersion(c.credential.Deployment)+"/project", &projects); err != nil {
		return nil, err
	}
	sort.Slice(projects, func(i, j int) bool { return projects[i].Key < projects[j].Key })
	return projects, nil
}

// jiraProjectKeyRE validates Jira project keys to prevent JQL injection.
// Jira project keys are 1–10 uppercase letters/digits, starting with a letter.
var jiraProjectKeyRE = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,9}$`)

func (c jiraClient) issues(ctx context.Context, projectKey string, maxResults int) ([]jiraIssue, error) {
	if !jiraProjectKeyRE.MatchString(projectKey) {
		return nil, fmt.Errorf("invalid Jira project key: %q", projectKey)
	}
	// maxResults <= 0 means "fetch all pages" (unlimited). A positive value is a
	// hard cap; once reached the caller receives a jiraTruncatedError.
	unlimited := maxResults <= 0
	const batchSize = 100
	// Escape any embedded double-quotes in the key to be safe, then wrap in quotes.
	escapedKey := strings.ReplaceAll(projectKey, `"`, `\"`)
	jql := `project = "` + escapedKey + `" ORDER BY created ASC`
	fields := "summary,description,status,priority,assignee,reporter,labels,created,updated,comment,project"
	var all []jiraIssue
	startAt := 0
	for {
		values := url.Values{}
		values.Set("jql", jql)
		values.Set("maxResults", strconv.Itoa(batchSize))
		values.Set("startAt", strconv.Itoa(startAt))
		values.Set("fields", fields)
		var response jiraSearchResponse
		path := "/rest/api/" + jiraAPIVersion(c.credential.Deployment) + "/search?" + values.Encode()
		if err := c.getJSON(ctx, path, &response); err != nil {
			return nil, err
		}
		all = append(all, response.Issues...)
		startAt += len(response.Issues)
		// Empty-page guard: a misbehaving server that never advances its Total
		// cannot cause an infinite loop — stop immediately if no issues arrived.
		if len(response.Issues) == 0 {
			return all, nil
		}
		// All server-reported pages consumed.
		if startAt >= response.Total {
			return all, nil
		}
		// Caller imposed a hard cap and we have reached it.
		if !unlimited && len(all) >= maxResults {
			// Surface a truncation warning so handlers can annotate the response.
			return all, &jiraTruncatedError{fetched: len(all), total: response.Total}
		}
	}
}

func (c jiraClient) getJSON(ctx context.Context, path string, target any) error {
	client := c.client
	if client == nil {
		client = http.DefaultClient
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.credential.BaseURL+path, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	if c.credential.Email != "" {
		token := base64.StdEncoding.EncodeToString([]byte(c.credential.Email + ":" + c.credential.Token))
		request.Header.Set("Authorization", "Basic "+token)
	} else {
		request.Header.Set("Authorization", "Bearer "+c.credential.Token)
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("jira returned %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	err = json.NewDecoder(response.Body).Decode(target)
	if errors.Is(err, io.EOF) {
		return nil
	}
	return err
}

func (h Handler) saveJiraIntegration(ctx context.Context, workspaceID string, userID string, credential jiraCredential, account jiraUser, projects []jiraProject) (string, error) {
	metadataRaw, _ := json.Marshal(map[string]any{"deployment": credential.Deployment, "baseUrl": credential.BaseURL, "accountId": firstNonEmptyString(account.AccountID, account.Name), "accountName": firstNonEmptyString(account.DisplayName, account.EmailAddress, account.Name), "projectCount": len(projects)})
	credentialRaw, _ := json.Marshal(credential)
	var integrationID string
	err := pgx.BeginFunc(ctx, h.DB, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		if err := tx.QueryRow(ctx, `insert into workspace_integration (workspace_id, provider, status, external_id, display_name, metadata, connected_by_user_id, connected_at, last_event_at, last_success_at, credentials_revoked_at, revoked_at, revoked_by_user_id, updated_at) values ($1::uuid,'jira','connected',$2,$3,$4::jsonb,$5,$6,$6,$6,null,null,null,$6) on conflict (workspace_id, provider) do update set status='connected', external_id=excluded.external_id, display_name=excluded.display_name, metadata=excluded.metadata, connected_by_user_id=excluded.connected_by_user_id, connected_at=coalesce(workspace_integration.connected_at, excluded.connected_at), last_event_at=excluded.last_event_at, last_success_at=excluded.last_success_at, last_failure_at=null, last_failure_message=null, credentials_revoked_at=null, revoked_at=null, revoked_by_user_id=null, updated_at=excluded.updated_at returning id::text`, workspaceID, credential.BaseURL, jiraDisplayName(credential), metadataRaw, userID, now).Scan(&integrationID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update provider_credential set active=false, revoked_at=coalesce(revoked_at,$2), updated_at=$2 where workspace_integration_id=$1::uuid and active`, integrationID, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into provider_credential (workspace_integration_id, provider, encrypted_payload, metadata, created_by_user_id, created_at, updated_at) values ($1::uuid,'jira',$2,$3::jsonb,$4,$5,$5)`, integrationID, credentialRaw, metadataRaw, userID, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'jira','configured','info','Jira integration configured.',$3::jsonb,$4)`, workspaceID, integrationID, metadataRaw, now)
		return err
	})
	return integrationID, err
}

func (h Handler) requireJiraInstall(w http.ResponseWriter, ctx context.Context, workspaceID string) (jiraInstall, bool) {
	install, err := h.jiraInstall(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 409, "Jira is not configured", "Connect Jira before starting an import.")
		return jiraInstall{}, false
	}
	if err != nil {
		problem.Write(w, 500, "Load Jira configuration failed", err.Error())
		return jiraInstall{}, false
	}
	return install, true
}

func (h Handler) jiraInstall(ctx context.Context, workspaceID string) (jiraInstall, error) {
	var install jiraInstall
	var credentialRaw []byte
	var metadataRaw []byte
	err := h.DB.QueryRow(ctx, `select wi.id::text, wi.workspace_id::text, coalesce(wi.display_name,''), coalesce(wi.metadata,'{}'::jsonb), pc.encrypted_payload from workspace_integration wi join provider_credential pc on pc.workspace_integration_id=wi.id and pc.provider='jira' and pc.active where wi.workspace_id=$1::uuid and wi.provider='jira' and wi.status in ('connected','degraded') limit 1`, workspaceID).Scan(&install.ID, &install.WorkspaceID, &install.DisplayName, &metadataRaw, &credentialRaw)
	if err != nil {
		return install, err
	}
	install.Metadata = mapFromJSON(metadataRaw)
	if err := json.Unmarshal(credentialRaw, &install.Credential); err != nil {
		return install, err
	}
	return install, nil
}

func buildJiraPreview(credential jiraCredential, issues []jiraIssue) ([]jiraPreviewIssue, []string) {
	statuses := map[string]bool{}
	preview := make([]jiraPreviewIssue, 0, len(issues))
	for _, issue := range issues {
		status := strings.TrimSpace(issue.Fields.Status.Name)
		if status != "" {
			statuses[status] = true
		}
		priority := "none"
		if issue.Fields.Priority != nil && strings.TrimSpace(issue.Fields.Priority.Name) != "" {
			priority = issue.Fields.Priority.Name
		}
		assignee := ""
		if issue.Fields.Assignee != nil {
			assignee = firstNonEmptyString(issue.Fields.Assignee.DisplayName, issue.Fields.Assignee.EmailAddress, issue.Fields.Assignee.Name, issue.Fields.Assignee.AccountID)
		}
		errors := []string{}
		if strings.TrimSpace(issue.Fields.Summary) == "" {
			errors = append(errors, "Summary is required")
		}
		preview = append(preview, jiraPreviewIssue{ID: issue.ID, Key: issue.Key, Title: issue.Fields.Summary, Status: status, Priority: priority, Assignee: assignee, Labels: issue.Fields.Labels, CommentCount: len(issue.Fields.Comment.Comments), SourceURL: jiraIssueURL(credential, issue.Key), Errors: errors})
	}
	statusList := make([]string, 0, len(statuses))
	for status := range statuses {
		statusList = append(statusList, status)
	}
	sort.Strings(statusList)
	return preview, statusList
}

func suggestJiraStatusMapping(statuses []string, states []importStateRow) map[string]string {
	out := map[string]string{}
	fallback := defaultImportState(states, "")
	if fallback.ID == "" && len(states) > 0 {
		fallback = states[0]
	}
	for _, status := range statuses {
		chosen := fallback.ID
		for _, state := range states {
			if strings.EqualFold(state.Name, status) || strings.EqualFold(state.Category, status) {
				chosen = state.ID
				break
			}
		}
		out[status] = chosen
	}
	return out
}

func (h Handler) validateJiraStatusMapping(ctx context.Context, teamID string, input map[string]any) (map[string]string, error) {
	states, err := h.importStates(ctx, teamID)
	if err != nil {
		return nil, err
	}
	valid := map[string]bool{}
	for _, state := range states {
		valid[state.ID] = true
	}
	fallback := defaultImportState(states, teamID)
	if fallback.ID == "" {
		return nil, errors.New("target team has no workflow states")
	}
	mapping := map[string]string{}
	for key, value := range input {
		stateID := strings.TrimSpace(asStringValue(value))
		if stateID == "" {
			stateID = fallback.ID
		}
		if !valid[stateID] {
			return nil, fmt.Errorf("state %s is not in the selected team", stateID)
		}
		mapping[strings.TrimSpace(key)] = stateID
	}
	if len(mapping) == 0 {
		mapping[""] = fallback.ID
	}
	return mapping, nil
}

func (h Handler) importJiraIssues(ctx context.Context, p auth.Principal, install jiraInstall, teamID string, statusMapping map[string]string, issues []jiraIssue, importComments bool, importLabels bool, forwardSyncEnabled bool) (jiraImportSummary, error) {
	states, err := h.importStates(ctx, teamID)
	if err != nil {
		return jiraImportSummary{}, err
	}
	stateIDs := map[string]bool{}
	for _, state := range states {
		stateIDs[state.ID] = true
	}
	fallbackState := defaultImportState(states, teamID)
	if fallbackState.ID == "" {
		return jiraImportSummary{}, errors.New("target team has no workflow states")
	}
	members, err := h.jiraWorkspaceUsers(ctx, p.WorkspaceID)
	if err != nil {
		return jiraImportSummary{}, err
	}
	actorName, actorEmail := h.userNameEmail(ctx, p.UserID)
	summary := jiraImportSummary{}
	err = pgx.BeginFunc(ctx, h.DB, func(tx pgx.Tx) error {
		maxNumber, err := h.maxIssueNumber(ctx, tx, teamID)
		if err != nil {
			return err
		}
		// Fetch team key once to avoid an N+1 query inside the issue loop.
		var teamKey string
		if err := tx.QueryRow(ctx, `select key from team where id=$1::uuid`, teamID).Scan(&teamKey); err != nil || teamKey == "" {
			teamKey = "JIRA"
		}
		project := issues[0].Fields.Project
		if project.ID == "" {
			project.ID = project.Key
		}
		if project.Key == "" {
			project.Key = strings.Split(issues[0].Key, "-")[0]
		}
		if project.Name == "" {
			project.Name = project.Key
		}
		statusRaw, _ := json.Marshal(statusMapping)
		if _, err := tx.Exec(ctx, `insert into jira_project_mapping (workspace_id, workspace_integration_id, deployment_type, jira_project_id, jira_project_key, jira_project_name, team_id, status_mapping, forward_sync_enabled, paused_at, paused_by_user_id, updated_by_user_id, updated_at) values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8::jsonb,$9,null,null,$10,now()) on conflict (workspace_integration_id, jira_project_id, team_id) do update set jira_project_key=excluded.jira_project_key, jira_project_name=excluded.jira_project_name, status_mapping=excluded.status_mapping, forward_sync_enabled=excluded.forward_sync_enabled, paused_at=null, paused_by_user_id=null, updated_by_user_id=excluded.updated_by_user_id, updated_at=now()`, p.WorkspaceID, install.ID, install.Credential.Deployment, project.ID, project.Key, project.Name, teamID, statusRaw, forwardSyncEnabled, p.UserID); err != nil {
			return err
		}
		for _, source := range issues {
			stateID := statusMapping[strings.TrimSpace(source.Fields.Status.Name)]
			if stateID == "" || !stateIDs[stateID] {
				stateID = fallbackState.ID
			}
			assigneeID := ""
			if source.Fields.Assignee != nil {
				assigneeID = members[strings.ToLower(strings.TrimSpace(source.Fields.Assignee.EmailAddress))]
			}
			description := normalizeIssueDescriptionHTML(jiraTextValue(source.Fields.Description))
			priority := normalizeJiraPriority(source.Fields.Priority)
			updatedAt := parseJiraTime(source.Fields.Updated)
			var issueID string
			err := tx.QueryRow(ctx, `select issue_id::text from jira_issue_link where workspace_integration_id=$1::uuid and jira_issue_id=$2 limit 1 for update`, install.ID, source.ID).Scan(&issueID)
			if errors.Is(err, pgx.ErrNoRows) {
				maxNumber++
				identifier := teamKey + "-" + strconv.Itoa(maxNumber)
				if err := tx.QueryRow(ctx, `insert into issue (number, identifier, title, description, team_id, state_id, assignee_id, creator_id, priority, updated_at) values ($1,$2,$3,$4,$5::uuid,$6::uuid,nullif($7,''),$8,$9,now()) returning id::text`, maxNumber, identifier, strings.TrimSpace(source.Fields.Summary), description, teamID, stateID, assigneeID, p.UserID, priority).Scan(&issueID); err != nil {
					return err
				}
				metadata, _ := json.Marshal(map[string]any{"identifier": identifier, "title": source.Fields.Summary, "importSource": "jira", "source": source.Key, "sourceUrl": jiraIssueURL(install.Credential, source.Key)})
				if _, err := tx.Exec(ctx, `insert into issue_history (issue_id, actor_id, actor_name, actor_email, event_type, metadata) values ($1::uuid,$2,$3,$4,'created',$5::jsonb)`, issueID, p.UserID, actorName, actorEmail, metadata); err != nil {
					return err
				}
				summary.ImportedCount++
			} else if err != nil {
				return err
			} else {
				if _, err := tx.Exec(ctx, `update issue set title=$2, description=$3, state_id=$4::uuid, assignee_id=nullif($5,''), priority=$6, updated_at=now() where id=$1::uuid`, issueID, strings.TrimSpace(source.Fields.Summary), description, stateID, assigneeID, priority); err != nil {
					return err
				}
				summary.UpdatedCount++
			}
			if err := h.upsertJiraIssueLink(ctx, tx, p.WorkspaceID, install.ID, install.Credential, project, source, issueID, updatedAt); err != nil {
				return err
			}
			if importLabels {
				if err := h.importJiraLabels(ctx, tx, p.WorkspaceID, teamID, issueID, source.Fields.Labels); err != nil {
					return err
				}
			}
			if importComments {
				count, err := h.importJiraComments(ctx, tx, p, install, members, source, issueID)
				if err != nil {
					return err
				}
				summary.CommentCount += count
			}
		}
		var jobID string
		now := time.Now().UTC()
		if err := tx.QueryRow(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, completed_at, updated_at) values ($1::uuid,$2::uuid,'jira','backfill','succeeded',$3::jsonb,$4,$4,$4) returning id::text`, p.WorkspaceID, install.ID, mustJSON(map[string]any{"projectKey": project.Key, "teamId": teamID, "importedCount": summary.ImportedCount, "updatedCount": summary.UpdatedCount, "commentCount": summary.CommentCount})).Scan(&jobID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'jira',$3::uuid,'import_completed','info',$4,$5::jsonb,$6)`, p.WorkspaceID, install.ID, jobID, "Jira project imported.", mustJSON(map[string]any{"projectKey": project.Key, "teamId": teamID, "forwardSyncEnabled": forwardSyncEnabled}), now); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `update workspace_integration set last_event_at=$2, last_success_at=$2, updated_at=$2 where id=$1::uuid`, install.ID, now)
		return err
	})
	return summary, err
}

func (h Handler) maxIssueNumber(ctx context.Context, tx pgx.Tx, teamID string) (int, error) {
	var max int
	err := tx.QueryRow(ctx, `select coalesce(max(number),0)::int from issue where team_id=$1::uuid`, teamID).Scan(&max)
	return max, err
}

func (h Handler) upsertJiraIssueLink(ctx context.Context, tx pgx.Tx, workspaceID string, integrationID string, credential jiraCredential, project jiraProject, source jiraIssue, issueID string, updatedAt *time.Time) error {
	sourceURL := jiraIssueURL(credential, source.Key)
	if _, err := tx.Exec(ctx, `insert into jira_issue_link (workspace_id, workspace_integration_id, jira_project_id, jira_project_key, jira_issue_id, jira_issue_key, issue_id, source_url, last_jira_updated_at, last_imported_at, updated_at) values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid,$8,$9,now(),now()) on conflict (workspace_integration_id, jira_issue_id) do update set issue_id=excluded.issue_id, jira_issue_key=excluded.jira_issue_key, source_url=excluded.source_url, last_jira_updated_at=excluded.last_jira_updated_at, last_imported_at=now(), updated_at=now()`, workspaceID, integrationID, project.ID, project.Key, source.ID, source.Key, issueID, sourceURL, updatedAt); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id) values ($1::uuid,$2::uuid,'jira',$3::uuid,$4,$5,$6,$7,$8,'inbound',$9) on conflict (workspace_integration_id, source_event_id) where workspace_integration_id is not null and source_event_id is not null do update set issue_id=excluded.issue_id, external_permalink=excluded.external_permalink, updated_at=now()`, workspaceID, integrationID, issueID, project.ID, project.Key, source.ID, source.ID, sourceURL, source.ID)
	return err
}

func (h Handler) importJiraLabels(ctx context.Context, tx pgx.Tx, workspaceID string, teamID string, issueID string, labels []string) error {
	for _, raw := range labels {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		var labelID string
		err := tx.QueryRow(ctx, `select id::text from label where workspace_id=$1::uuid and team_id=$2::uuid and lower(name)=lower($3) and archived_at is null order by created_at asc limit 1`, workspaceID, teamID, name).Scan(&labelID)
		if errors.Is(err, pgx.ErrNoRows) {
			if err := tx.QueryRow(ctx, `insert into label (name, color, workspace_id, team_id) values ($1,'#6b6f76',$2::uuid,$3::uuid) returning id::text`, name, workspaceID, teamID).Scan(&labelID); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into issue_label (issue_id, label_id) values ($1::uuid,$2::uuid) on conflict do nothing`, issueID, labelID); err != nil {
			return err
		}
	}
	return nil
}

func (h Handler) importJiraComments(ctx context.Context, tx pgx.Tx, p auth.Principal, install jiraInstall, members map[string]string, source jiraIssue, issueID string) (int, error) {
	count := 0
	for _, comment := range source.Fields.Comment.Comments {
		if strings.TrimSpace(comment.ID) == "" {
			continue
		}
		var existing string
		err := tx.QueryRow(ctx, `select comment_id::text from jira_comment_link where workspace_integration_id=$1::uuid and jira_comment_id=$2 limit 1`, install.ID, comment.ID).Scan(&existing)
		if err == nil {
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return count, err
		}
		userID := members[strings.ToLower(strings.TrimSpace(comment.Author.EmailAddress))]
		if userID == "" {
			userID = p.UserID
		}
		body := jiraAttributedCommentBody(comment, source, install.Credential)
		var commentID string
		if err := tx.QueryRow(ctx, `insert into comment (body, issue_id, user_id) values ($1,$2::uuid,$3) returning id::text`, body, issueID, userID).Scan(&commentID); err != nil {
			return count, err
		}
		sourceURL := jiraIssueURL(install.Credential, source.Key) + "?focusedCommentId=" + url.QueryEscape(comment.ID)
		if _, err := tx.Exec(ctx, `insert into jira_comment_link (workspace_id, workspace_integration_id, jira_issue_id, jira_comment_id, comment_id, source_url) values ($1::uuid,$2::uuid,$3,$4,$5::uuid,$6) on conflict do nothing`, p.WorkspaceID, install.ID, source.ID, comment.ID, commentID, sourceURL); err != nil {
			return count, err
		}
		if _, err := tx.Exec(ctx, `insert into integration_thread_link (workspace_id, workspace_integration_id, provider, issue_id, comment_id, external_team_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id) values ($1::uuid,$2::uuid,'jira',$3::uuid,$4::uuid,$5,$6,$7,$8,$9,'inbound',$10) on conflict (workspace_integration_id, source_event_id) where workspace_integration_id is not null and source_event_id is not null do nothing`, p.WorkspaceID, install.ID, issueID, commentID, source.Fields.Project.ID, source.Fields.Project.Key, source.ID, comment.ID, sourceURL, "comment:"+comment.ID); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func (h Handler) jiraWorkspaceUsers(ctx context.Context, workspaceID string) (map[string]string, error) {
	rows, err := h.DB.Query(ctx, `select lower(u.email), u.id from "user" u join member m on m.user_id=u.id where m.workspace_id=$1::uuid and u.email is not null`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var email string
		var userID string
		if err := rows.Scan(&email, &userID); err != nil {
			return nil, err
		}
		out[email] = userID
	}
	return out, rows.Err()
}

func jiraAttributedCommentBody(comment jiraComment, issue jiraIssue, credential jiraCredential) string {
	author := firstNonEmptyString(comment.Author.DisplayName, comment.Author.EmailAddress, comment.Author.Name, "Unmapped Jira author")
	body := strings.TrimSpace(jiraTextValue(comment.Body))
	if body == "" {
		body = "(empty Jira comment)"
	}
	return "Imported from Jira " + issue.Key + " by " + author + "\n\n" + body + "\n\nSource: " + jiraIssueURL(credential, issue.Key)
}

func normalizeJiraPriority(priority *jiraPriority) string {
	if priority == nil {
		return "none"
	}
	switch strings.ToLower(strings.TrimSpace(priority.Name)) {
	case "highest", "urgent", "blocker", "critical":
		return "urgent"
	case "high", "major":
		return "high"
	case "medium", "normal":
		return "medium"
	case "low", "lowest", "minor", "trivial":
		return "low"
	default:
		return "none"
	}
}

func jiraTextValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case []any:
		parts := []string{}
		for _, item := range typed {
			if text := jiraTextValue(item); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		if text, ok := typed["text"].(string); ok {
			return text
		}
		if content, ok := typed["content"]; ok {
			return jiraTextValue(content)
		}
		return ""
	default:
		return fmt.Sprint(typed)
	}
}

func parseJiraTime(value string) *time.Time {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.000-0700", "2006-01-02T15:04:05.999-0700"} {
		parsed, err := time.Parse(layout, trimmed)
		if err == nil {
			utc := parsed.UTC()
			return &utc
		}
	}
	return nil
}

func jiraDisplayName(credential jiraCredential) string {
	parsed, err := url.Parse(credential.BaseURL)
	if err == nil && parsed.Host != "" {
		return "Jira " + parsed.Host
	}
	return "Jira"
}

func jiraIssueURL(credential jiraCredential, key string) string {
	return strings.TrimRight(credential.BaseURL, "/") + "/browse/" + strings.TrimSpace(key)
}

func boolFromAnyDefault(value any, fallback bool) bool {
	if typed, ok := value.(bool); ok {
		return typed
	}
	return fallback
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func mustJSON(value any) []byte {
	raw, _ := json.Marshal(value)
	return raw
}
