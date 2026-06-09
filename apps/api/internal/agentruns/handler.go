package agentruns

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
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
	ID                string `json:"id"`
	Title             string `json:"title"`
	Summary           string `json:"summary"`
	Target            string `json:"target"`
	ContextURL        string `json:"contextUrl"`
	IsExternalContext bool   `json:"isExternalContext,omitempty"`
	Status            string `json:"status"`
}
type Run struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Prompt       string `json:"prompt"`
	TeamKey      string `json:"teamKey"`
	PromptConfig struct {
		Guidance Guidance `json:"guidance"`
	} `json:"promptConfig"`
	Context     string       `json:"context"`
	Status      string       `json:"status"`
	Owner       string       `json:"owner"`
	Target      string       `json:"target"`
	CreatedAt   string       `json:"createdAt"`
	UpdatedAt   string       `json:"updatedAt"`
	Output      string       `json:"output"`
	Logs        []string     `json:"logs"`
	Suggestions []Suggestion `json:"suggestions"`
}

type listResponse struct {
	Runs          []Run `json:"runs"`
	CanCreateRuns bool  `json:"canCreateRuns"`
}
type runResponse struct {
	Run Run `json:"run"`
}

type capability struct {
	CanCreate       bool
	FeaturesEnabled bool
}
type request struct{ Title, Prompt, TeamKey, Context string }

var (
	mu              sync.Mutex
	runsByWorkspace = map[string][]Run{}
	issueRe         = regexp.MustCompile(`(?i)\b([A-Z][A-Z0-9]+-\d+)\b`)
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
	problem.JSON(w, 200, listResponse{Runs: listRuns(p.WorkspaceID), CanCreateRuns: cap.CanCreate})
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
	input := request{Title: trim(raw["title"]), Prompt: trim(raw["prompt"]), TeamKey: trim(raw["teamKey"]), Context: trim(raw["context"])}
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
	}
	guidance, err := h.guidance(r, p, teamKey)
	if err != nil {
		problem.Write(w, 500, "Load agent guidance failed", err.Error())
		return
	}
	owner := h.ownerName(r, p.UserID)
	run := createRun(p.WorkspaceID, input, owner, guidance)
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
	run, ok := updateSuggestion(p.WorkspaceID, chi.URLParam(r, "id"), suggestionID, status)
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

func listRuns(workspaceID string) []Run {
	mu.Lock()
	defer mu.Unlock()
	ensureSeed(workspaceID)
	return cloneRuns(runsByWorkspace[workspaceID])
}
func createRun(workspaceID string, input request, owner string, guidance Guidance) Run {
	mu.Lock()
	defer mu.Unlock()
	ensureSeed(workspaceID)
	runs := runsByWorkspace[workspaceID]
	now := time.Now().UTC().Format(time.RFC3339Nano)
	teamKey := strings.ToUpper(input.TeamKey)
	if teamKey == "" {
		teamKey = "EXP"
	}
	context := input.Context
	if context == "" {
		context = "Workspace"
	}
	id := "agent-run-" + short(workspaceID) + "-" + itoa(len(runs)+1)
	run := Run{ID: id, Title: input.Title, Prompt: input.Prompt, TeamKey: teamKey, Context: context, Status: "queued", Owner: owner, Target: teamKey + " · " + context, CreatedAt: now, UpdatedAt: now, Output: "Mock agent run queued. The next step is ready for review and can be promoted when a real executor is connected.", Logs: []string{"Created run from Agent dashboard composer.", "Captured context: " + teamKey + " · " + context + "."}, Suggestions: []Suggestion{suggestion(id+"-suggestion-open-issue", "Open linked workspace context", "Review the selected team and target context before handing this task to the real executor.", context, teamKey)}}
	run.PromptConfig.Guidance = guidance
	if guidance.EffectiveInstructions != "" {
		run.Logs = append(run.Logs, "Applied workspace/account/team agent guidance to the prompt configuration.")
	} else {
		run.Logs = append(run.Logs, "No saved agent guidance was available for this request context.")
	}
	if guidance.AutoFixEnabled {
		run.Logs = append(run.Logs, "Account personalization requested proactive lint/type fix suggestions for this run.")
	} else {
		run.Logs = append(run.Logs, "Account personalization left proactive lint/type fixes off for this run.")
	}
	run.Logs = append(run.Logs, "Queued deterministic mock execution for product validation.")
	runsByWorkspace[workspaceID] = append([]Run{run}, runs...)
	return cloneRun(run)
}

func updateSuggestion(workspaceID, runID, suggestionID, status string) (Run, bool) {
	mu.Lock()
	defer mu.Unlock()
	ensureSeed(workspaceID)
	runs := runsByWorkspace[workspaceID]
	for runIndex := range runs {
		if runs[runIndex].ID != runID {
			continue
		}
		found := false
		for suggestionIndex := range runs[runIndex].Suggestions {
			if runs[runIndex].Suggestions[suggestionIndex].ID == suggestionID {
				runs[runIndex].Suggestions[suggestionIndex].Status = status
				found = true
				break
			}
		}
		if !found {
			return Run{}, false
		}
		runs[runIndex].UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		runs[runIndex].Logs = append(runs[runIndex].Logs, "Suggestion "+suggestionID+" marked "+status+".")
		return cloneRun(runs[runIndex]), true
	}
	return Run{}, false
}

func ensureSeed(workspaceID string) {
	if _, ok := runsByWorkspace[workspaceID]; ok {
		return
	}
	seed := Run{ID: "agent-run-seed-triage", Title: "Review stale triage issues", Prompt: "Find triage issues without an assignee and suggest the next owner or status.", TeamKey: "EXP", Context: "Team backlog", Status: "needs_review", Owner: "Linear Agent", Target: "EXP triage queue", CreatedAt: "2026-05-15T12:00:00.000Z", UpdatedAt: "2026-05-15T12:06:00.000Z", Output: "Found two triage candidates with clear ownership signals. Review suggestions before applying changes.", Logs: []string{"Queued workspace scan for EXP triage.", "Inspected issue metadata, assignees, labels, and recent comments.", "Prepared two suggestions for human review."}, Suggestions: []Suggestion{suggestion("suggestion-assign-agent-sidebar", "Assign Agent sidebar follow-up", "Route placeholder work to the product engineering queue and link it to issue #300.", "EXP-300", "EXP"), suggestion("suggestion-prioritize-inbox", "Prioritize inbox notification regression", "Move the unread count regression into the current cycle because it affects daily triage.", "EXP-297", "EXP")}}
	seed.PromptConfig.Guidance = buildGuidance("", "", "", false, "EXP")
	runsByWorkspace[workspaceID] = []Run{seed}
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
		slug := slugify(strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(strings.ToLower(t), "project:"), "project")))
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
func short(v string) string {
	if len(v) >= 8 {
		return v[:8]
	}
	return v
}
func itoa(v int) string {
	return strings.TrimSpace(strings.ReplaceAll(time.Unix(int64(v), 0).UTC().Format("05"), "0", ""))
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
