package views

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type TeamSummary struct {
	ID   string `json:"id"`
	Key  string `json:"key"`
	Name string `json:"name"`
}

type OwnerSummary struct {
	Name  string  `json:"name"`
	Image *string `json:"image"`
}

type View struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Layout      string          `json:"layout"`
	IsPersonal  bool            `json:"isPersonal"`
	FilterState ViewFilterState `json:"filterState"`
	EntityType  string          `json:"entityType"`
	Scope       string          `json:"scope"`
	TeamID      *string         `json:"teamId"`
	TeamKey     *string         `json:"teamKey"`
	TeamName    *string         `json:"teamName"`
	Owner       *OwnerSummary   `json:"owner"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
}

type ViewFilterState struct {
	EntityType            string                    `json:"entityType"`
	Scope                 string                    `json:"scope"`
	IssueFilters          []FilterCondition         `json:"issueFilters"`
	IssueDisplayOptions   IssueDisplayOptions       `json:"issueDisplayOptions"`
	ProjectStatusFilter   string                    `json:"projectStatusFilter"`
	ProjectSortBy         string                    `json:"projectSortBy"`
	ProjectDisplayOptions ProjectViewDisplayOptions `json:"projectDisplayOptions"`
}

type FilterCondition struct {
	Type     string   `json:"type"`
	Operator string   `json:"operator"`
	Values   []string `json:"values"`
}

type IssueDisplayOptions struct {
	GroupBy           string          `json:"groupBy"`
	SubGroupBy        string          `json:"subGroupBy"`
	OrderBy           string          `json:"orderBy"`
	DisplayProperties map[string]bool `json:"displayProperties"`
	ShowSubIssues     bool            `json:"showSubIssues"`
	ShowTriageIssues  bool            `json:"showTriageIssues"`
	ShowEmptyColumns  bool            `json:"showEmptyColumns"`
}

type ProjectViewDisplayOptions struct {
	GroupBy           string          `json:"groupBy"`
	VisibleProperties map[string]bool `json:"visibleProperties"`
}

type listResponse struct {
	Views []View        `json:"views"`
	Teams []TeamSummary `json:"teams"`
}

type viewResponse struct {
	View View `json:"view"`
}

type viewRequest struct {
	Name        any `json:"name"`
	Layout      any `json:"layout"`
	IsPersonal  any `json:"isPersonal"`
	FilterState any `json:"filterState"`
	TeamID      any `json:"teamId"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{id}", h.Get)
	r.Patch("/{id}", h.Update)
	r.Delete("/{id}", h.Delete)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	views, err := h.listViews(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List views failed", err.Error())
		return
	}
	teams, err := h.listTeams(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List teams failed", err.Error())
		return
	}
	problem.JSON(w, 200, listResponse{Views: views, Teams: teams})
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	input, ok := readRequest(w, r)
	if !ok {
		return
	}
	name := normalizeName(input.Name)
	if name == "" {
		problem.Write(w, 400, "Name is required", "")
		return
	}
	selectedTeam, err := h.workspaceTeam(r.Context(), p.WorkspaceID, teamIDFromValue(input.TeamID))
	if err != nil {
		problem.Write(w, 500, "Load team failed", err.Error())
		return
	}
	teamID := ""
	if selectedTeam != nil {
		teamID = selectedTeam.ID
	}
	filterState := NormalizeViewFilterState(input.FilterState, teamID)
	if filterState.EntityType == "issues" && selectedTeam == nil {
		problem.Write(w, 400, "Issue views must be scoped to a team", "")
		return
	}
	layout := normalizeLayout(input.Layout, filterState.EntityType, "list")
	filterState.Scope = scopeForTeam(selectedTeam != nil)
	body, _ := json.Marshal(filterState)

	var insertedID string
	var insertErr error
	if selectedTeam == nil {
		insertErr = h.DB.QueryRow(r.Context(), `
			insert into custom_view (name, owner_id, workspace_id, layout, is_personal, filter_state, team_id)
			values ($1,$2,$3::uuid,$4,$5,$6::jsonb,null)
			returning id::text`, name, p.UserID, p.WorkspaceID, layout, boolOrDefault(input.IsPersonal, true), body).Scan(&insertedID)
	} else {
		insertErr = h.DB.QueryRow(r.Context(), `
			insert into custom_view (name, owner_id, workspace_id, layout, is_personal, filter_state, team_id)
			values ($1,$2,$3::uuid,$4,$5,$6::jsonb,$7::uuid)
			returning id::text`, name, p.UserID, p.WorkspaceID, layout, boolOrDefault(input.IsPersonal, true), body, selectedTeam.ID).Scan(&insertedID)
	}
	if insertErr != nil {
		problem.Write(w, 500, "Create view failed", insertErr.Error())
		return
	}
	view, err := h.scopedView(r.Context(), insertedID, p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Load view failed", err.Error())
		return
	}
	problem.JSON(w, 201, viewResponse{View: view})
}

func (h Handler) Get(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	view, err := h.scopedView(r.Context(), chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "View not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load view failed", err.Error())
		return
	}
	problem.JSON(w, 200, viewResponse{View: view})
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	existing, err := h.scopedView(r.Context(), chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "View not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load view failed", err.Error())
		return
	}
	input, raw, ok := readRequestWithRaw(w, r)
	if !ok {
		return
	}
	selectedTeamID := ""
	if existing.TeamID != nil {
		selectedTeamID = *existing.TeamID
	}
	if _, hasTeamID := raw["teamId"]; hasTeamID {
		selectedTeamID = teamIDFromValue(input.TeamID)
	}
	selectedTeam, err := h.workspaceTeam(r.Context(), p.WorkspaceID, selectedTeamID)
	if err != nil {
		problem.Write(w, 500, "Load team failed", err.Error())
		return
	}
	teamID := ""
	if selectedTeam != nil {
		teamID = selectedTeam.ID
	}
	filterInput := any(existing.FilterState)
	if _, hasFilter := raw["filterState"]; hasFilter {
		filterInput = input.FilterState
	}
	filterState := NormalizeViewFilterState(filterInput, teamID)
	if filterState.EntityType == "issues" && selectedTeam == nil {
		problem.Write(w, 400, "Issue views must be scoped to a team", "")
		return
	}
	filterState.Scope = scopeForTeam(selectedTeam != nil)
	body, _ := json.Marshal(filterState)
	name := existing.Name
	if candidate := normalizeName(input.Name); candidate != "" {
		name = candidate
	}
	isPersonal := existing.IsPersonal
	if value, ok := input.IsPersonal.(bool); ok {
		isPersonal = value
	}
	layout := normalizeLayout(input.Layout, filterState.EntityType, existing.Layout)

	var tag pgconn.CommandTag
	if selectedTeam == nil {
		tag, err = h.DB.Exec(r.Context(), `
			update custom_view
			set name=$1, layout=$2, is_personal=$3, filter_state=$4::jsonb, team_id=null, updated_at=now()
			where id=$5::uuid and workspace_id=$6::uuid`, name, layout, isPersonal, body, chi.URLParam(r, "id"), p.WorkspaceID)
	} else {
		tag, err = h.DB.Exec(r.Context(), `
			update custom_view
			set name=$1, layout=$2, is_personal=$3, filter_state=$4::jsonb, team_id=$5::uuid, updated_at=now()
			where id=$6::uuid and workspace_id=$7::uuid`, name, layout, isPersonal, body, selectedTeam.ID, chi.URLParam(r, "id"), p.WorkspaceID)
	}
	if err != nil {
		problem.Write(w, 500, "Update view failed", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		problem.Write(w, 404, "View not found", "")
		return
	}
	updated, err := h.scopedView(r.Context(), chi.URLParam(r, "id"), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Load view failed", err.Error())
		return
	}
	problem.JSON(w, 200, viewResponse{View: updated})
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	tag, err := h.DB.Exec(r.Context(), `delete from custom_view where id=$1::uuid and workspace_id=$2::uuid`, chi.URLParam(r, "id"), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Delete view failed", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		problem.Write(w, 404, "View not found", "")
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) listViews(ctx context.Context, workspaceID string) ([]View, error) {
	rows, err := h.DB.Query(ctx, `
		select cv.id::text, cv.name, cv.layout::text, coalesce(cv.is_personal,true), coalesce(cv.filter_state,'{}'::jsonb), cv.team_id::text,
		       t.key, t.name, u.name, u.image, cv.created_at, cv.updated_at
		from custom_view cv
		left join "user" u on u.id=cv.owner_id
		left join team t on t.id=cv.team_id
		where cv.workspace_id=$1::uuid
		order by cv.name asc, cv.created_at asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	views := []View{}
	for rows.Next() {
		view, err := scanView(rows)
		if err != nil {
			return nil, err
		}
		views = append(views, view)
	}
	return views, rows.Err()
}

func (h Handler) listTeams(ctx context.Context, workspaceID string) ([]TeamSummary, error) {
	rows, err := h.DB.Query(ctx, `select id::text, key, name from team where workspace_id=$1::uuid order by name asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	teams := []TeamSummary{}
	for rows.Next() {
		var team TeamSummary
		if err := rows.Scan(&team.ID, &team.Key, &team.Name); err != nil {
			return nil, err
		}
		teams = append(teams, team)
	}
	return teams, rows.Err()
}

func (h Handler) workspaceTeam(ctx context.Context, workspaceID, teamID string) (*TeamSummary, error) {
	if strings.TrimSpace(teamID) == "" {
		return nil, nil
	}
	var team TeamSummary
	err := h.DB.QueryRow(ctx, `select id::text, key, name from team where id=$1::uuid and workspace_id=$2::uuid limit 1`, teamID, workspaceID).Scan(&team.ID, &team.Key, &team.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &team, nil
}

func (h Handler) scopedView(ctx context.Context, id, workspaceID string) (View, error) {
	return scanView(h.DB.QueryRow(ctx, `
		select cv.id::text, cv.name, cv.layout::text, coalesce(cv.is_personal,true), coalesce(cv.filter_state,'{}'::jsonb), cv.team_id::text,
		       t.key, t.name, u.name, u.image, cv.created_at, cv.updated_at
		from custom_view cv
		left join "user" u on u.id=cv.owner_id
		left join team t on t.id=cv.team_id
		where cv.id=$1::uuid and cv.workspace_id=$2::uuid
		limit 1`, id, workspaceID))
}

type scanner interface{ Scan(dest ...any) error }

func scanView(row scanner) (View, error) {
	var view View
	var filter []byte
	var teamID, teamKey, teamName, ownerName, ownerImage *string
	var createdAt, updatedAt time.Time
	if err := row.Scan(&view.ID, &view.Name, &view.Layout, &view.IsPersonal, &filter, &teamID, &teamKey, &teamName, &ownerName, &ownerImage, &createdAt, &updatedAt); err != nil {
		return View{}, err
	}
	view.TeamID = teamID
	view.TeamKey = teamKey
	view.TeamName = teamName
	if ownerName != nil {
		view.Owner = &OwnerSummary{Name: *ownerName, Image: ownerImage}
	}
	team := ""
	if teamID != nil {
		team = *teamID
	}
	view.FilterState = NormalizeViewFilterState(rawJSONMap(filter), team)
	view.EntityType = view.FilterState.EntityType
	view.Scope = view.FilterState.Scope
	view.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	view.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return view, nil
}

func readRequest(w http.ResponseWriter, r *http.Request) (viewRequest, bool) {
	input, _, ok := readRequestWithRaw(w, r)
	return input, ok
}

func readRequestWithRaw(w http.ResponseWriter, r *http.Request) (viewRequest, map[string]json.RawMessage, bool) {
	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return viewRequest{}, nil, false
	}
	body, _ := json.Marshal(raw)
	var input viewRequest
	if err := json.Unmarshal(body, &input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return viewRequest{}, nil, false
	}
	return input, raw, true
}

func normalizeName(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(strings.ReplaceAll(text, "\x00", ""))
}

func boolOrDefault(value any, fallback bool) bool {
	if boolValue, ok := value.(bool); ok {
		return boolValue
	}
	return fallback
}

func teamIDFromValue(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func normalizeLayout(value any, entityType, fallback string) string {
	if entityType == "projects" {
		return "list"
	}
	layout, _ := value.(string)
	if layout == "board" || layout == "timeline" || layout == "list" {
		return layout
	}
	if fallback == "board" || fallback == "timeline" || fallback == "list" {
		return fallback
	}
	return "list"
}

func rawJSONMap(raw []byte) map[string]any {
	var record map[string]any
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &record)
	}
	if record == nil {
		record = map[string]any{}
	}
	return record
}

func NormalizeViewFilterState(value any, teamID string) ViewFilterState {
	record := objectMap(value)
	entityType := "issues"
	if stringValue(record["entityType"]) == "projects" {
		entityType = "projects"
	}
	scope := "team"
	if stringValue(record["scope"]) == "workspace" || (teamID == "" && stringValue(record["scope"]) != "team") {
		scope = "workspace"
	}
	return ViewFilterState{
		EntityType:            entityType,
		Scope:                 scope,
		IssueFilters:          normalizeIssueFilters(record["issueFilters"]),
		IssueDisplayOptions:   normalizeIssueDisplayOptions(record["issueDisplayOptions"]),
		ProjectStatusFilter:   normalizeStringOption(record["projectStatusFilter"], []string{"all", "planned", "started", "paused", "completed", "canceled"}, "all"),
		ProjectSortBy:         normalizeStringOption(record["projectSortBy"], []string{"created-desc", "created-asc", "name-asc", "progress-desc", "target-date-asc"}, "created-desc"),
		ProjectDisplayOptions: normalizeProjectDisplayOptions(record["projectDisplayOptions"]),
	}
}

func objectMap(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	case ViewFilterState:
		body, _ := json.Marshal(typed)
		return rawJSONMap(body)
	default:
		body, err := json.Marshal(value)
		if err != nil {
			return map[string]any{}
		}
		return rawJSONMap(body)
	}
}

func normalizeIssueFilters(value any) []FilterCondition {
	items, ok := value.([]any)
	if !ok {
		return []FilterCondition{}
	}
	filters := []FilterCondition{}
	for _, item := range items {
		record := objectMap(item)
		operator := stringValue(record["operator"])
		if operator != "is" && operator != "isNot" {
			continue
		}
		valuesRaw, ok := record["values"].([]any)
		if !ok || stringValue(record["type"]) == "" {
			continue
		}
		values := []string{}
		valid := true
		for _, value := range valuesRaw {
			text, ok := value.(string)
			if !ok {
				valid = false
				break
			}
			values = append(values, text)
		}
		if valid {
			filters = append(filters, FilterCondition{Type: stringValue(record["type"]), Operator: operator, Values: values})
		}
	}
	return filters
}

func normalizeIssueDisplayOptions(value any) IssueDisplayOptions {
	record := objectMap(value)
	return IssueDisplayOptions{
		GroupBy:           normalizeStringOption(record["groupBy"], []string{"status", "priority", "assignee", "label", "project", "none"}, "status"),
		SubGroupBy:        normalizeStringOption(record["subGroupBy"], []string{"status", "priority", "assignee", "label", "project", "none"}, "none"),
		OrderBy:           normalizeStringOption(record["orderBy"], []string{"priority", "created", "updated", "manual"}, "priority"),
		DisplayProperties: normalizeDisplayProperties(record["displayProperties"]),
		ShowSubIssues:     boolFromMap(record, "showSubIssues", true),
		ShowTriageIssues:  boolFromMap(record, "showTriageIssues", false),
		ShowEmptyColumns:  boolFromMap(record, "showEmptyColumns", false),
	}
}

func normalizeProjectDisplayOptions(value any) ProjectViewDisplayOptions {
	record := objectMap(value)
	properties := objectMap(record["visibleProperties"])
	defaults := map[string]bool{"lead": true, "team": true, "targetDate": true, "progress": true, "status": true}
	visible := map[string]bool{}
	for key, fallback := range defaults {
		if value, ok := properties[key].(bool); ok {
			visible[key] = value
		} else {
			visible[key] = fallback
		}
	}
	return ProjectViewDisplayOptions{GroupBy: normalizeStringOption(record["groupBy"], []string{"status", "lead", "team", "none"}, "status"), VisibleProperties: visible}
}

func normalizeDisplayProperties(value any) map[string]bool {
	defaults := map[string]bool{"id": true, "status": true, "assignee": true, "priority": true, "project": true, "dueDate": true, "milestone": false, "labels": true, "links": false, "timeInStatus": false, "created": true, "updated": false, "pullRequests": false}
	record := objectMap(value)
	properties := map[string]bool{}
	for key, fallback := range defaults {
		if value, ok := record[key].(bool); ok {
			properties[key] = value
		} else {
			properties[key] = fallback
		}
	}
	return properties
}

func normalizeStringOption(value any, allowed []string, fallback string) string {
	text := stringValue(value)
	for _, option := range allowed {
		if text == option {
			return text
		}
	}
	return fallback
}

func boolFromMap(record map[string]any, key string, fallback bool) bool {
	if value, ok := record[key].(bool); ok {
		return value
	}
	return fallback
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func scopeForTeam(hasTeam bool) string {
	if hasTeam {
		return "team"
	}
	return "workspace"
}
