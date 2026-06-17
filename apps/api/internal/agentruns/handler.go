package agentruns

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type GuidanceEntry struct {
	Source       string `json:"source"`
	Label        string `json:"label"`
	Instructions string `json:"instructions"`
}
type Guidance struct {
	Entries               []GuidanceEntry `json:"entries"`
	EffectiveInstructions string          `json:"effectiveInstructions"`
	AutoFixEnabled        bool            `json:"autoFixEnabled"`
	TeamKey               *string         `json:"teamKey"`
}
type Suggestion struct {
	ID                string  `json:"id"`
	Title             string  `json:"title"`
	Summary           string  `json:"summary"`
	Target            string  `json:"target"`
	ContextURL        string  `json:"contextUrl"`
	IsExternalContext bool    `json:"isExternalContext,omitempty"`
	Status            string  `json:"status"`
	ReviewedBy        *string `json:"reviewedBy,omitempty"`
	ReviewedAt        *string `json:"reviewedAt,omitempty"`
}
type Run struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Prompt       string `json:"prompt"`
	TeamKey      string `json:"teamKey"`
	PromptConfig struct {
		Guidance Guidance `json:"guidance"`
	} `json:"promptConfig"`
	Context       string       `json:"context"`
	Status        string       `json:"status"`
	Owner         string       `json:"owner"`
	Target        string       `json:"target"`
	CreatedAt     string       `json:"createdAt"`
	UpdatedAt     string       `json:"updatedAt"`
	Output        string       `json:"output"`
	FailureReason *string      `json:"failureReason,omitempty"`
	Logs          []string     `json:"logs"`
	Suggestions   []Suggestion `json:"suggestions"`
}

type listResponse struct {
	Runs               []Run   `json:"runs"`
	CanCreateRuns      bool    `json:"canCreateRuns"`
	ProviderConfigured bool    `json:"providerConfigured"`
	DisabledReason     *string `json:"disabledReason,omitempty"`
}
type runResponse struct {
	Run Run `json:"run"`
}

type capability struct {
	CanCreate       bool
	FeaturesEnabled bool
}
type providerStatus struct {
	Configured bool
	Provider   string
	Model      string
	Reason     string
}
type request struct{ Title, Prompt, TeamKey, Context string }

type promptConfig struct {
	Guidance Guidance `json:"guidance"`
}

type contextSnapshot struct {
	Type         string          `json:"type"`
	ID           string          `json:"id,omitempty"`
	Identifier   string          `json:"identifier,omitempty"`
	Title        string          `json:"title,omitempty"`
	Description  string          `json:"description,omitempty"`
	TeamKey      string          `json:"teamKey,omitempty"`
	State        string          `json:"state,omitempty"`
	Priority     string          `json:"priority,omitempty"`
	Assignee     string          `json:"assignee,omitempty"`
	ProjectName  string          `json:"projectName,omitempty"`
	ProjectSlug  string          `json:"projectSlug,omitempty"`
	IssueCount   int             `json:"issueCount,omitempty"`
	RecentIssues []snapshotIssue `json:"recentIssues,omitempty"`
	Query        string          `json:"query,omitempty"`
}

type snapshotIssue struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
	State      string `json:"state"`
	Priority   string `json:"priority"`
	TeamKey    string `json:"teamKey"`
}

type rowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type dbQuerier interface {
	rowQuerier
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

var (
	issueRe            = regexp.MustCompile(`(?i)\b([A-Z][A-Z0-9]+-\d+)\b`)
	errContextNotFound = errors.New("agent context not found")
)

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Patch("/{id}", h.UpdateSuggestion)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	cap, err := h.capability(r, p)
	if err != nil {
		problem.Write(w, 500, "Load agent runs failed", err.Error())
		return
	}
	runs, err := h.listRuns(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Load agent runs failed", err.Error())
		return
	}
	provider := currentProviderStatus()
	var disabledReason *string
	if !provider.Configured {
		reason := provider.Reason
		disabledReason = &reason
	}
	problem.JSON(w, 200, listResponse{Runs: runs, CanCreateRuns: cap.CanCreate && provider.Configured, ProviderConfigured: provider.Configured, DisabledReason: disabledReason})
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	cap, err := h.capability(r, p)
	if err != nil {
		problem.Write(w, 500, "Load agent capability failed", err.Error())
		return
	}
	if !cap.CanCreate {
		if cap.FeaturesEnabled {
			problem.Write(w, 403, "You do not have permission to create agent runs in this workspace", "")
		} else {
			problem.Write(w, 403, "Workspace AI and agent features are disabled", "")
		}
		return
	}
	var raw map[string]any
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		problem.JSON(w, 400, map[string]string{"error": "Invalid JSON"})
		return
	}
	input := request{Title: trim(raw["title"]), Prompt: trim(raw["prompt"]), TeamKey: strings.ToUpper(trim(raw["teamKey"])), Context: trim(raw["context"])}
	if input.Title == "" {
		problem.JSON(w, 400, map[string]string{"error": "Title is required"})
		return
	}
	if len(input.Prompt) < 12 {
		problem.JSON(w, 400, map[string]string{"error": "Describe the task in at least 12 characters"})
		return
	}
	teamKey := input.TeamKey
	if teamKey != "" {
		found, err := h.teamAccessible(r, p, teamKey)
		if err != nil {
			problem.Write(w, 500, "Load team failed", err.Error())
			return
		}
		if found == "" {
			problem.JSON(w, 404, map[string]string{"error": "Team not found"})
			return
		}
		teamKey = found
	} else {
		teamKey, err = h.defaultTeamKey(r, p)
		if err != nil {
			problem.Write(w, 500, "Load team failed", err.Error())
			return
		}
		if teamKey == "" {
			problem.JSON(w, 404, map[string]string{"error": "Team not found"})
			return
		}
	}
	input.TeamKey = teamKey
	guidance, err := h.guidance(r, p, teamKey)
	if err != nil {
		problem.Write(w, 500, "Load agent guidance failed", err.Error())
		return
	}
	snapshot, err := h.resolveContext(r.Context(), p, teamKey, input.Context)
	if errors.Is(err, errContextNotFound) {
		problem.JSON(w, 404, map[string]string{"error": "Agent context not found"})
		return
	}
	if err != nil {
		problem.Write(w, 500, "Resolve agent context failed", err.Error())
		return
	}
	owner := h.ownerName(r, p.UserID)
	run := buildRun(input, owner, guidance, snapshot, currentProviderStatus())
	if err := h.insertRun(r.Context(), p.WorkspaceID, p.UserID, run, snapshot); err != nil {
		problem.Write(w, 500, "Create agent run failed", err.Error())
		return
	}
	problem.JSON(w, 201, runResponse{Run: run})
}

func (h Handler) UpdateSuggestion(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var raw map[string]any
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		problem.JSON(w, 400, map[string]string{"error": "Invalid JSON"})
		return
	}
	suggestionID := trim(raw["suggestionId"])
	status := trim(raw["status"])
	if suggestionID == "" || (status != "accepted" && status != "declined") {
		problem.JSON(w, 400, map[string]string{"error": "Invalid suggestion action"})
		return
	}
	run, ok, err := h.updateSuggestion(r.Context(), p, chi.URLParam(r, "id"), suggestionID, status)
	if err != nil {
		problem.Write(w, 500, "Update agent suggestion failed", err.Error())
		return
	}
	if !ok {
		problem.JSON(w, 404, map[string]string{"error": "Agent run not found"})
		return
	}
	problem.JSON(w, 200, runResponse{Run: run})
}

func (h Handler) capability(r *http.Request, p auth.Principal) (capability, error) {
	var settings []byte
	var role string
	err := h.DB.QueryRow(r.Context(), `select coalesce(w.settings,'{}'::jsonb), m.role::text from workspace w join member m on m.workspace_id=w.id and m.user_id=$2 where w.id=$1::uuid limit 1`, p.WorkspaceID, p.UserID).Scan(&settings, &role)
	if err != nil {
		return capability{}, err
	}
	enabled := readBool(settings, []string{"ai", "aiFeaturesEnabled"}, readBool(settings, []string{"ai", "enabled"}, true))
	perm := readString(settings, []string{"ai", "agentUsagePermission"}, "members")
	return capability{CanCreate: enabled && canPerform(role, perm), FeaturesEnabled: enabled}, nil
}

func (h Handler) teamAccessible(r *http.Request, p auth.Principal, key string) (string, error) {
	var canonical string
	err := h.DB.QueryRow(r.Context(), `select t.key from team t join member m on m.workspace_id=t.workspace_id and m.user_id=$3 where t.workspace_id=$1::uuid and upper(t.key)=upper($2) limit 1`, p.WorkspaceID, key, p.UserID).Scan(&canonical)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return canonical, err
}

func (h Handler) defaultTeamKey(r *http.Request, p auth.Principal) (string, error) {
	var key string
	err := h.DB.QueryRow(r.Context(), `select t.key from team t join member m on m.workspace_id=t.workspace_id and m.user_id=$2 where t.workspace_id=$1::uuid order by t.created_at asc limit 1`, p.WorkspaceID, p.UserID).Scan(&key)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return key, err
}

func (h Handler) ownerName(r *http.Request, userID string) string {
	var name, email *string
	_ = h.DB.QueryRow(r.Context(), `select name,email from "user" where id=$1 limit 1`, userID).Scan(&name, &email)
	if name != nil && strings.TrimSpace(*name) != "" {
		return strings.TrimSpace(*name)
	}
	if email != nil && strings.TrimSpace(*email) != "" {
		return strings.TrimSpace(*email)
	}
	return "You"
}

func (h Handler) guidance(r *http.Request, p auth.Principal, teamKey string) (Guidance, error) {
	var workspaceSettings, userSettings []byte
	if err := h.DB.QueryRow(r.Context(), `select coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid`, p.WorkspaceID).Scan(&workspaceSettings); err != nil {
		return Guidance{}, err
	}
	if err := h.DB.QueryRow(r.Context(), `select coalesce(settings,'{}'::jsonb) from "user" where id=$1`, p.UserID).Scan(&userSettings); err != nil {
		return Guidance{}, err
	}
	var teamSettings []byte
	if teamKey != "" {
		_ = h.DB.QueryRow(r.Context(), `select coalesce(settings,'{}'::jsonb) from team where workspace_id=$1::uuid and upper(key)=upper($2) limit 1`, p.WorkspaceID, teamKey).Scan(&teamSettings)
	}
	return buildGuidance(readWorkspaceGuidance(workspaceSettings), readString(userSettings, []string{"accountPreferences", "agentPersonalization", "instructions"}, ""), readString(teamSettings, []string{"agentGuidance"}, ""), readBool(userSettings, []string{"accountPreferences", "agentPersonalization", "autoFix"}, false), teamKey), nil
}

func (h Handler) listRuns(ctx context.Context, workspaceID string) ([]Run, error) {
	rows, err := h.DB.Query(ctx, `select id::text,title,prompt,team_key,context,status,owner_name,target,created_at,updated_at,output,failure_reason,prompt_config,logs,suggestions from agent_run where workspace_id=$1::uuid order by updated_at desc, created_at desc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	runs := []Run{}
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (h Handler) insertRun(ctx context.Context, workspaceID, actorUserID string, run Run, snapshot contextSnapshot) error {
	promptConfigRaw, err := json.Marshal(promptConfig{Guidance: run.PromptConfig.Guidance})
	if err != nil {
		return err
	}
	snapshotRaw, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	logsRaw, err := json.Marshal(run.Logs)
	if err != nil {
		return err
	}
	suggestionsRaw, err := json.Marshal(run.Suggestions)
	if err != nil {
		return err
	}
	providerResultRaw, err := json.Marshal(map[string]any{"output": run.Output, "suggestionCount": len(run.Suggestions)})
	if err != nil {
		return err
	}
	_, err = h.DB.Exec(ctx, `insert into agent_run (id,workspace_id,actor_user_id,title,prompt,team_key,context,context_snapshot,prompt_config,status,owner_name,target,output,provider,model,provider_result,failure_reason,logs,suggestions,created_at,updated_at) values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19::jsonb,$20,$21)`, run.ID, workspaceID, actorUserID, run.Title, run.Prompt, run.TeamKey, run.Context, snapshotRaw, promptConfigRaw, run.Status, run.Owner, run.Target, run.Output, currentProviderStatus().Provider, currentProviderStatus().Model, providerResultRaw, run.FailureReason, logsRaw, suggestionsRaw, parseTime(run.CreatedAt), parseTime(run.UpdatedAt))
	return err
}

func (h Handler) updateSuggestion(ctx context.Context, p auth.Principal, runID, suggestionID, status string) (Run, bool, error) {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return Run{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	run, ok, err := loadRun(ctx, tx, p.WorkspaceID, runID, true)
	if err != nil || !ok {
		return Run{}, ok, err
	}
	index := -1
	for i := range run.Suggestions {
		if run.Suggestions[i].ID == suggestionID {
			index = i
			break
		}
	}
	if index == -1 {
		return Run{}, false, nil
	}
	now := time.Now().UTC()
	nowText := formatTime(now)
	reviewer := h.ownerNameFromQuerier(ctx, tx, p.UserID)
	run.Suggestions[index].Status = status
	run.Suggestions[index].ReviewedBy = &reviewer
	run.Suggestions[index].ReviewedAt = &nowText
	run.UpdatedAt = nowText
	run.Logs = append(run.Logs, fmt.Sprintf("%s reviewed suggestion %q as %s.", reviewer, run.Suggestions[index].Title, status))
	suggestionsRaw, err := json.Marshal(run.Suggestions)
	if err != nil {
		return Run{}, false, err
	}
	logsRaw, err := json.Marshal(run.Logs)
	if err != nil {
		return Run{}, false, err
	}
	_, err = tx.Exec(ctx, `update agent_run set suggestions=$1::jsonb, logs=$2::jsonb, updated_at=$3 where id=$4::uuid and workspace_id=$5::uuid`, suggestionsRaw, logsRaw, now, runID, p.WorkspaceID)
	if err != nil {
		return Run{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Run{}, false, err
	}
	return cloneRun(run), true, nil
}

func loadRun(ctx context.Context, q rowQuerier, workspaceID, runID string, forUpdate bool) (Run, bool, error) {
	query := `select id::text,title,prompt,team_key,context,status,owner_name,target,created_at,updated_at,output,failure_reason,prompt_config,logs,suggestions from agent_run where workspace_id=$1::uuid and id=$2::uuid`
	if forUpdate {
		query += ` for update`
	}
	run, err := scanRun(q.QueryRow(ctx, query, workspaceID, runID))
	if err == pgx.ErrNoRows {
		return Run{}, false, nil
	}
	if err != nil {
		return Run{}, false, err
	}
	return run, true, nil
}

func scanRun(scanner interface{ Scan(...any) error }) (Run, error) {
	var run Run
	var createdAt, updatedAt time.Time
	var failureReason sql.NullString
	var promptConfigRaw, logsRaw, suggestionsRaw []byte
	if err := scanner.Scan(&run.ID, &run.Title, &run.Prompt, &run.TeamKey, &run.Context, &run.Status, &run.Owner, &run.Target, &createdAt, &updatedAt, &run.Output, &failureReason, &promptConfigRaw, &logsRaw, &suggestionsRaw); err != nil {
		return Run{}, err
	}
	run.CreatedAt = formatTime(createdAt)
	run.UpdatedAt = formatTime(updatedAt)
	if failureReason.Valid {
		run.FailureReason = &failureReason.String
	}
	var cfg promptConfig
	if len(promptConfigRaw) > 0 {
		_ = json.Unmarshal(promptConfigRaw, &cfg)
	}
	run.PromptConfig.Guidance = cfg.Guidance
	if len(logsRaw) > 0 {
		_ = json.Unmarshal(logsRaw, &run.Logs)
	}
	if len(suggestionsRaw) > 0 {
		_ = json.Unmarshal(suggestionsRaw, &run.Suggestions)
	}
	if run.Logs == nil {
		run.Logs = []string{}
	}
	if run.Suggestions == nil {
		run.Suggestions = []Suggestion{}
	}
	return cloneRun(run), nil
}

func (h Handler) resolveContext(ctx context.Context, p auth.Principal, teamKey, rawContext string) (contextSnapshot, error) {
	contextText := strings.TrimSpace(rawContext)
	if match := issueRe.FindStringSubmatch(contextText); len(match) > 1 {
		return h.resolveIssueContext(ctx, p, strings.ToUpper(match[1]), teamKey)
	}
	if projectSlug := projectContextSlug(contextText); projectSlug != "" {
		return h.resolveProjectContext(ctx, p, projectSlug)
	}
	snapshot, err := h.resolveTeamContext(ctx, p, teamKey)
	if err != nil {
		return contextSnapshot{}, err
	}
	if contextText != "" {
		snapshot.Query = contextText
	}
	return snapshot, nil
}

func (h Handler) resolveIssueContext(ctx context.Context, p auth.Principal, identifier, teamKey string) (contextSnapshot, error) {
	var snapshot contextSnapshot
	var description, assignee, projectName, projectSlug sql.NullString
	err := h.DB.QueryRow(ctx, `select i.id::text,i.identifier,i.title,coalesce(i.description,''),t.key,ws.name,i.priority::text,coalesce(u.name,u.email,''),p.name,p.slug from issue i join team t on t.id=i.team_id join workflow_state ws on ws.id=i.state_id join member m on m.workspace_id=t.workspace_id and m.user_id=$2 left join "user" u on u.id=i.assignee_id left join project p on p.id=i.project_id where t.workspace_id=$1::uuid and upper(i.identifier)=upper($3) and ($4='' or upper(t.key)=upper($4)) limit 1`, p.WorkspaceID, p.UserID, identifier, teamKey).Scan(&snapshot.ID, &snapshot.Identifier, &snapshot.Title, &description, &snapshot.TeamKey, &snapshot.State, &snapshot.Priority, &assignee, &projectName, &projectSlug)
	if err == pgx.ErrNoRows {
		return contextSnapshot{}, errContextNotFound
	}
	if err != nil {
		return contextSnapshot{}, err
	}
	snapshot.Type = "issue"
	snapshot.Description = description.String
	snapshot.Assignee = assignee.String
	snapshot.ProjectName = projectName.String
	snapshot.ProjectSlug = projectSlug.String
	return snapshot, nil
}

func (h Handler) resolveProjectContext(ctx context.Context, p auth.Principal, slug string) (contextSnapshot, error) {
	var snapshot contextSnapshot
	var description sql.NullString
	err := h.DB.QueryRow(ctx, `select p.id::text,p.name,coalesce(p.description,''),p.slug,p.status::text,p.priority::text,count(i.id)::int from project p join member m on m.workspace_id=p.workspace_id and m.user_id=$2 left join issue i on i.project_id=p.id where p.workspace_id=$1::uuid and (lower(p.slug)=lower($3) or lower(p.name)=lower($4)) group by p.id,p.name,p.description,p.slug,p.status,p.priority limit 1`, p.WorkspaceID, p.UserID, slug, strings.ReplaceAll(slug, "-", " ")).Scan(&snapshot.ID, &snapshot.Title, &description, &snapshot.ProjectSlug, &snapshot.State, &snapshot.Priority, &snapshot.IssueCount)
	if err == pgx.ErrNoRows {
		return contextSnapshot{}, errContextNotFound
	}
	if err != nil {
		return contextSnapshot{}, err
	}
	snapshot.Type = "project"
	snapshot.Description = description.String
	snapshot.ProjectName = snapshot.Title
	issues, err := h.recentIssues(ctx, p.WorkspaceID, "", snapshot.ID)
	if err != nil {
		return contextSnapshot{}, err
	}
	snapshot.RecentIssues = issues
	return snapshot, nil
}

func (h Handler) resolveTeamContext(ctx context.Context, p auth.Principal, teamKey string) (contextSnapshot, error) {
	var snapshot contextSnapshot
	err := h.DB.QueryRow(ctx, `select t.id::text,t.name,t.key,count(i.id)::int from team t join member m on m.workspace_id=t.workspace_id and m.user_id=$2 left join issue i on i.team_id=t.id where t.workspace_id=$1::uuid and upper(t.key)=upper($3) group by t.id,t.name,t.key limit 1`, p.WorkspaceID, p.UserID, teamKey).Scan(&snapshot.ID, &snapshot.Title, &snapshot.TeamKey, &snapshot.IssueCount)
	if err == pgx.ErrNoRows {
		return contextSnapshot{}, errContextNotFound
	}
	if err != nil {
		return contextSnapshot{}, err
	}
	snapshot.Type = "team"
	issues, err := h.recentIssues(ctx, p.WorkspaceID, snapshot.ID, "")
	if err != nil {
		return contextSnapshot{}, err
	}
	snapshot.RecentIssues = issues
	return snapshot, nil
}

func (h Handler) recentIssues(ctx context.Context, workspaceID, teamID, projectID string) ([]snapshotIssue, error) {
	query := `select i.id::text,i.identifier,i.title,ws.name,i.priority::text,t.key from issue i join team t on t.id=i.team_id join workflow_state ws on ws.id=i.state_id where t.workspace_id=$1::uuid`
	args := []any{workspaceID}
	if teamID != "" {
		args = append(args, teamID)
		query += fmt.Sprintf(" and t.id=$%d::uuid", len(args))
	}
	if projectID != "" {
		args = append(args, projectID)
		query += fmt.Sprintf(" and i.project_id=$%d::uuid", len(args))
	}
	query += " order by i.updated_at desc limit 3"
	rows, err := h.DB.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	issues := []snapshotIssue{}
	for rows.Next() {
		var issue snapshotIssue
		if err := rows.Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.State, &issue.Priority, &issue.TeamKey); err != nil {
			return nil, err
		}
		issues = append(issues, issue)
	}
	return issues, rows.Err()
}

func buildRun(input request, owner string, guidance Guidance, snapshot contextSnapshot, provider providerStatus) Run {
	now := time.Now().UTC()
	contextLabel := strings.TrimSpace(input.Context)
	if contextLabel == "" {
		contextLabel = snapshotContextLabel(snapshot)
	}
	run := Run{ID: uuid.NewString(), Title: input.Title, Prompt: input.Prompt, TeamKey: strings.ToUpper(input.TeamKey), Context: contextLabel, Owner: owner, Target: strings.ToUpper(input.TeamKey) + " · " + contextLabel, CreatedAt: formatTime(now), UpdatedAt: formatTime(now)}
	run.PromptConfig.Guidance = guidance
	run.Logs = []string{"Created run from Agent dashboard composer.", "Queued workspace-aware agent execution.", "Resolved " + snapshot.Type + " context: " + snapshotContextLabel(snapshot) + "."}
	if guidance.EffectiveInstructions != "" {
		run.Logs = append(run.Logs, "Applied workspace/account/team agent guidance to the prompt configuration.")
	} else {
		run.Logs = append(run.Logs, "No saved agent guidance was available for this request context.")
	}
	if !provider.Configured {
		run.Status = "failed"
		run.Output = provider.Reason
		run.FailureReason = &provider.Reason
		run.Logs = append(run.Logs, "Execution stopped because no AI provider is configured.")
		return run
	}
	run.Logs = append(run.Logs, "Started provider execution with "+provider.Provider+" ("+provider.Model+").")
	run.Output = workspaceSummary(input, guidance, snapshot, provider)
	run.Suggestions = buildSuggestions(run.ID, snapshot, input.Prompt)
	if len(run.Suggestions) > 0 {
		run.Status = "needs_review"
		run.Logs = append(run.Logs, fmt.Sprintf("Prepared %d review-gated suggestion(s) from workspace data.", len(run.Suggestions)))
	} else {
		run.Status = "completed"
		run.Logs = append(run.Logs, "Completed workspace summarization with no issue update suggestions.")
	}
	return run
}

func buildSuggestions(runID string, snapshot contextSnapshot, prompt string) []Suggestion {
	switch snapshot.Type {
	case "issue":
		return []Suggestion{suggestion(runID+"-suggestion-"+strings.ToLower(snapshot.Identifier), "Propose update for "+snapshot.Identifier, issueSuggestionSummary(snapshot, prompt), snapshot.Identifier, snapshot.TeamKey)}
	case "project", "team":
		limit := len(snapshot.RecentIssues)
		if limit > 2 {
			limit = 2
		}
		suggestions := make([]Suggestion, 0, limit)
		for i := 0; i < limit; i++ {
			issue := snapshot.RecentIssues[i]
			suggestions = append(suggestions, suggestion(fmt.Sprintf("%s-suggestion-%s", runID, strings.ToLower(issue.Identifier)), "Review update for "+issue.Identifier, fmt.Sprintf("Use the %s context and instruction %q to update %s (%s): %s.", snapshot.Type, compact(prompt, 96), issue.Identifier, issue.State, issue.Title), issue.Identifier, issue.TeamKey))
		}
		return suggestions
	default:
		return []Suggestion{}
	}
}

func issueSuggestionSummary(snapshot contextSnapshot, prompt string) string {
	parts := []string{fmt.Sprintf("Use the request %q to update %s", compact(prompt, 120), snapshot.Identifier)}
	if snapshot.State != "" {
		parts = append(parts, "state "+snapshot.State)
	}
	if snapshot.Priority != "" && snapshot.Priority != "none" {
		parts = append(parts, "priority "+snapshot.Priority)
	}
	if snapshot.Assignee != "" {
		parts = append(parts, "assignee "+snapshot.Assignee)
	}
	return strings.Join(parts, "; ") + "."
}

func workspaceSummary(input request, guidance Guidance, snapshot contextSnapshot, provider providerStatus) string {
	lines := []string{fmt.Sprintf("Workspace summary generated by %s/%s for %s.", provider.Provider, provider.Model, snapshotContextLabel(snapshot))}
	switch snapshot.Type {
	case "issue":
		lines = append(lines, fmt.Sprintf("Issue %s is %q in %s with %s priority.", snapshot.Identifier, snapshot.Title, snapshot.State, snapshot.Priority))
		if snapshot.Description != "" {
			lines = append(lines, "Description signal: "+compact(snapshot.Description, 180))
		}
		if snapshot.ProjectName != "" {
			lines = append(lines, "Project context: "+snapshot.ProjectName+".")
		}
	case "project":
		lines = append(lines, fmt.Sprintf("Project %q is %s with %d linked issue(s).", snapshot.Title, snapshot.State, snapshot.IssueCount))
		for _, issue := range snapshot.RecentIssues {
			lines = append(lines, fmt.Sprintf("Recent issue %s: %s (%s).", issue.Identifier, issue.Title, issue.State))
		}
	case "team":
		lines = append(lines, fmt.Sprintf("Team %s has %d issue(s) in the selected workspace context.", snapshot.TeamKey, snapshot.IssueCount))
		for _, issue := range snapshot.RecentIssues {
			lines = append(lines, fmt.Sprintf("Recent issue %s: %s (%s).", issue.Identifier, issue.Title, issue.State))
		}
	}
	if guidance.EffectiveInstructions != "" {
		lines = append(lines, "Applied guidance: "+compact(guidance.EffectiveInstructions, 160))
	}
	lines = append(lines, "Requested action: "+compact(input.Prompt, 180))
	return strings.Join(lines, " ")
}

func currentProviderStatus() providerStatus {
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("EXPONENTIAL_AGENT_PROVIDER")))
	model := strings.TrimSpace(os.Getenv("EXPONENTIAL_AGENT_MODEL"))
	if provider == "disabled" {
		return providerStatus{Configured: false, Reason: providerDisabledReason()}
	}
	if provider == "workspace" {
		if model == "" {
			model = "workspace-summarizer"
		}
		return providerStatus{Configured: true, Provider: "workspace", Model: model}
	}
	if strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) != "" {
		if model == "" {
			model = envOr("OPENAI_AGENT_MODEL", "gpt-4.1-mini")
		}
		return providerStatus{Configured: true, Provider: "openai", Model: model}
	}
	if strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")) != "" {
		if model == "" {
			model = envOr("ANTHROPIC_AGENT_MODEL", "claude-3-5-sonnet-latest")
		}
		return providerStatus{Configured: true, Provider: "anthropic", Model: model}
	}
	return providerStatus{Configured: false, Reason: providerDisabledReason()}
}

func providerDisabledReason() string {
	return "AI provider is not configured. Configure OPENAI_API_KEY or ANTHROPIC_API_KEY, or set EXPONENTIAL_AGENT_PROVIDER=workspace for the built-in workspace summarizer."
}

func projectContextSlug(value string) string {
	v := strings.TrimSpace(value)
	lower := strings.ToLower(v)
	if strings.Contains(lower, "/project/") {
		parts := strings.Split(lower, "/project/")
		if len(parts) > 1 {
			return slugify(strings.Split(strings.Trim(parts[1], "/"), "/")[0])
		}
	}
	if strings.HasPrefix(lower, "project") {
		withoutPrefix := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(lower, "project:"), "project"))
		return slugify(withoutPrefix)
	}
	return ""
}

func snapshotContextLabel(snapshot contextSnapshot) string {
	switch snapshot.Type {
	case "issue":
		return snapshot.Identifier + " · " + snapshot.Title
	case "project":
		return "project:" + snapshot.ProjectSlug
	case "team":
		return snapshot.TeamKey + " team"
	default:
		return "workspace"
	}
}

func buildGuidance(workspace, account, team string, autoFix bool, teamKey string) Guidance {
	g := Guidance{Entries: []GuidanceEntry{}, AutoFixEnabled: autoFix}
	if teamKey != "" {
		key := strings.ToUpper(teamKey)
		g.TeamKey = &key
	}
	if strings.TrimSpace(workspace) != "" {
		g.Entries = append(g.Entries, GuidanceEntry{"workspace", "Workspace guidance", strings.TrimSpace(workspace)})
	}
	if strings.TrimSpace(account) != "" {
		g.Entries = append(g.Entries, GuidanceEntry{"account", "Account personalization", strings.TrimSpace(account)})
	}
	if strings.TrimSpace(team) != "" {
		label := "Team guidance"
		if teamKey != "" {
			label = "Team " + strings.ToUpper(teamKey) + " guidance"
		}
		g.Entries = append(g.Entries, GuidanceEntry{"team", label, strings.TrimSpace(team)})
	}
	parts := []string{}
	for _, e := range g.Entries {
		parts = append(parts, e.Label+":\n"+e.Instructions)
	}
	g.EffectiveInstructions = strings.Join(parts, "\n\n")
	return g
}

func suggestion(id, title, summary, target, teamKey string) Suggestion {
	href := contextHref(target, teamKey)
	return Suggestion{ID: id, Title: title, Summary: summary, Target: target, ContextURL: href, IsExternalContext: strings.HasPrefix(strings.ToLower(target), "http://") || strings.HasPrefix(strings.ToLower(target), "https://"), Status: "open"}
}
func contextHref(target, teamKey string) string {
	t := strings.TrimSpace(target)
	if t == "" {
		return "/search?q=context"
	}
	if strings.HasPrefix(strings.ToLower(t), "http://") || strings.HasPrefix(strings.ToLower(t), "https://") {
		return t
	}
	if m := issueRe.FindStringSubmatch(t); len(m) > 1 {
		key := strings.ToUpper(strings.TrimSpace(teamKey))
		if key == "" {
			key = "EXP"
		}
		return "/team/" + key + "/issue/" + strings.ToUpper(m[1])
	}
	if strings.HasPrefix(strings.ToLower(t), "project") {
		slug := projectContextSlug(t)
		if slug != "" {
			return "/project/" + slug + "/overview"
		}
	}
	return "/search?q=" + strings.ReplaceAll(t, " ", "+")
}

func readWorkspaceGuidance(raw []byte) string {
	for _, path := range [][]string{{"ai", "workspaceAgentGuidance"}, {"ai", "agentGuidance"}, {"ai", "guidance"}, {"agents", "agentGuidance"}, {"agents", "guidance"}, {"agentGuidance"}} {
		if v := readString(raw, path, ""); v != "" {
			return v
		}
	}
	return ""
}
func readString(raw []byte, path []string, fallback string) string {
	if len(raw) == 0 {
		return fallback
	}
	var current any
	if json.Unmarshal(raw, &current) != nil {
		return fallback
	}
	for _, key := range path {
		m, ok := current.(map[string]any)
		if !ok {
			return fallback
		}
		current = m[key]
	}
	if s, ok := current.(string); ok {
		return strings.TrimSpace(s)
	}
	return fallback
}
func readBool(raw []byte, path []string, fallback bool) bool {
	if len(raw) == 0 {
		return fallback
	}
	var current any
	if json.Unmarshal(raw, &current) != nil {
		return fallback
	}
	for _, key := range path {
		m, ok := current.(map[string]any)
		if !ok {
			return fallback
		}
		current = m[key]
	}
	if b, ok := current.(bool); ok {
		return b
	}
	return fallback
}
func canPerform(role, perm string) bool {
	switch perm {
	case "anyone":
		return role != ""
	case "members":
		return role == "owner" || role == "admin" || role == "member"
	case "admins":
		return role == "owner" || role == "admin"
	default:
		return role == "owner" || role == "admin" || role == "member"
	}
}
func cloneRuns(in []Run) []Run {
	out := make([]Run, len(in))
	for i := range in {
		out[i] = cloneRun(in[i])
	}
	return out
}
func cloneRun(r Run) Run {
	r.Logs = append([]string{}, r.Logs...)
	r.Suggestions = append([]Suggestion{}, r.Suggestions...)
	r.PromptConfig.Guidance.Entries = append([]GuidanceEntry{}, r.PromptConfig.Guidance.Entries...)
	return r
}
func trim(v any) string {
	if s, ok := v.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}
func slugify(v string) string {
	v = strings.ToLower(v)
	out := []rune{}
	dash := false
	for _, r := range v {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			out = append(out, r)
			dash = false
		} else if !dash && len(out) > 0 {
			out = append(out, '-')
			dash = true
		}
	}
	s := strings.Trim(string(out), "-")
	return s
}
func compact(value string, limit int) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) <= limit {
		return value
	}
	if limit <= 1 {
		return value[:limit]
	}
	return strings.TrimSpace(value[:limit-1]) + "…"
}
func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}
func parseTime(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Now().UTC()
	}
	return parsed.UTC()
}

func (h Handler) ownerNameFromQuerier(ctx context.Context, q rowQuerier, userID string) string {
	var name, email *string
	_ = q.QueryRow(ctx, `select name,email from "user" where id=$1 limit 1`, userID).Scan(&name, &email)
	if name != nil && strings.TrimSpace(*name) != "" {
		return strings.TrimSpace(*name)
	}
	if email != nil && strings.TrimSpace(*email) != "" {
		return strings.TrimSpace(*email)
	}
	return "You"
}
