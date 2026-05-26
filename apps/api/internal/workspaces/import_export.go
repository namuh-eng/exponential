package workspaces

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"html"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type importExportWorkspace struct {
	ID       string
	Name     string
	URLSlug  string
	Settings map[string]any
	Role     string
}

type importExportStateGo struct {
	Exports   []map[string]any
	Imports   []map[string]any
	Artifacts map[string]any
}

func (h Handler) GetCurrentImportExport(w http.ResponseWriter, r *http.Request) {
	current, ok := h.requireImportExportWorkspace(w, r, "Only workspace admins can import or export workspace data")
	if !ok {
		return
	}
	teams, err := h.importExportTeams(r.Context(), current.ID)
	if err != nil {
		problem.Write(w, 500, "Load import/export settings failed", err.Error())
		return
	}
	state := readImportExportStateGo(current.Settings)
	problem.JSON(w, 200, map[string]any{
		"workspace":    map[string]any{"id": current.ID, "name": current.Name, "urlSlug": current.URLSlug},
		"capabilities": map[string]bool{"canExport": true, "canImportCsv": true, "canConfigureProviders": true},
		"teams":        teams,
		"imports":      state.Imports,
		"exports":      state.Exports,
	})
}

func (h Handler) MutateCurrentImportExport(w http.ResponseWriter, r *http.Request) {
	current, ok := h.requireImportExportWorkspace(w, r, "Only workspace admins can import or export workspace data")
	if !ok {
		return
	}
	p, _ := auth.FromContext(r.Context())
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid import/export request", err.Error())
		return
	}
	action := stringFromMap(body, "action")
	switch action {
	case "request_export":
		h.handleCurrentExportRequest(w, r, current)
	case "preview_csv":
		h.handleCurrentCSVPreview(w, body)
	case "prepare_provider":
		h.handleProviderPrepare(w, r, current, body)
	case "start_csv_import":
		h.handleCurrentCSVImport(w, r, current, p, body)
	default:
		problem.Write(w, 400, "Unsupported import/export action", "")
	}
}

func (h Handler) DownloadCurrentExport(w http.ResponseWriter, r *http.Request) {
	current, ok := h.requireImportExportWorkspace(w, r, "Only workspace admins can download workspace exports")
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	state := readImportExportStateGo(current.Settings)
	artifact, found := state.Artifacts[id]
	if !found || !jobWithID(state.Exports, id) {
		problem.Write(w, 404, "Export not found", "")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+current.URLSlug+`-workspace-export-`+id+`.json"`)
	w.WriteHeader(200)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(artifact)
}

func (h Handler) ListLegacyExports(w http.ResponseWriter, r *http.Request) {
	current, ok := h.requireImportExportWorkspace(w, r, "Workspace admin access required")
	if !ok {
		return
	}
	query := r.URL.Query()
	state := readImportExportStateGo(current.Settings)
	if id := query.Get("id"); id != "" && query.Get("download") != "" {
		if artifact, ok := legacyExportArtifact(state, id); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Disposition", `attachment; filename="`+current.URLSlug+`-export-`+id+`.json"`)
			_ = json.NewEncoder(w).Encode(artifact)
			return
		}
		problem.Write(w, 404, "Export not found", "")
		return
	}
	problem.JSON(w, 200, map[string]any{"exports": publicLegacyExports(state.Exports)})
}

func (h Handler) CreateLegacyExport(w http.ResponseWriter, r *http.Request) {
	current, ok := h.requireImportExportWorkspace(w, r, "Workspace admin access required")
	if !ok {
		return
	}
	artifact, counts, err := h.buildWorkspaceExportArtifact(r.Context(), current)
	if err != nil {
		problem.Write(w, 500, "Export failed", err.Error())
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := importExportJobID("export")
	job := map[string]any{"id": id, "status": "complete", "createdAt": now, "completedAt": now, "artifact": artifact, "counts": counts}
	state := readImportExportStateGo(current.Settings)
	state.Exports = prependJob(job, state.Exports, 10)
	state.Artifacts[id] = artifact
	if err := h.saveImportExportState(r.Context(), current, state); err != nil {
		problem.Write(w, 500, "Export failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"export": publicLegacyExport(job), "exports": publicLegacyExports(state.Exports)})
}

func (h Handler) ListLegacyImports(w http.ResponseWriter, r *http.Request) {
	current, ok := h.requireImportExportWorkspace(w, r, "Workspace admin access required")
	if !ok {
		return
	}
	teams, err := h.legacyImportTeams(r.Context(), current.ID)
	if err != nil {
		problem.Write(w, 500, "Load imports failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"imports": readImportExportStateGo(current.Settings).Imports, "teams": teams})
}

func (h Handler) CreateLegacyImport(w http.ResponseWriter, r *http.Request) {
	current, ok := h.requireImportExportWorkspace(w, r, "Workspace admin access required")
	if !ok {
		return
	}
	p, _ := auth.FromContext(r.Context())
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid import request", err.Error())
		return
	}
	mapping := recordFromAny(body["mapping"])
	rows := parseImportCSV(asStringValue(body["csv"]))
	teamID := strings.TrimSpace(asStringValue(body["teamId"]))
	team, err := h.importTeam(r.Context(), current.ID, teamID)
	if err == pgx.ErrNoRows {
		problem.Write(w, 400, "Choose a valid target team.", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Import failed", err.Error())
		return
	}
	states, err := h.importStates(r.Context(), teamID)
	if err != nil {
		problem.Write(w, 500, "Import failed", err.Error())
		return
	}
	defaultState := defaultImportState(states, teamID)
	if defaultState.ID == "" {
		problem.Write(w, 400, "Target team has no workflow states.", "")
		return
	}
	errors := validateLegacyImportRows(rows, mapping, states)
	if len(errors) > 0 {
		problem.JSON(w, 400, map[string]any{"error": "Fix CSV validation errors before importing.", "preview": errors})
		return
	}
	created, err := h.insertImportedIssues(r.Context(), p, []importTeamRow{team}, states, rowsToCurrentPreview(rows, mapping), currentImportMapping{Title: stringFromMap(mapping, "title"), Description: stringFromMap(mapping, "description"), Priority: stringFromMap(mapping, "priority"), Status: stringFromMap(mapping, "status")}, team.ID)
	if err != nil {
		problem.Write(w, 500, "Import failed", err.Error())
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	job := map[string]any{"id": importExportJobID("import"), "provider": "csv", "status": "complete", "createdAt": now, "completedAt": now, "fileName": stringOr(body["fileName"], "import.csv"), "message": "CSV import completed with " + strconv.Itoa(len(created)) + " issues created.", "importedCount": len(created), "errorCount": 0, "errors": []any{}}
	state := readImportExportStateGo(current.Settings)
	state.Imports = prependJob(job, state.Imports, 10)
	if err := h.saveImportExportState(r.Context(), current, state); err != nil {
		problem.Write(w, 500, "Import failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"import": job})
}

func (h Handler) handleCurrentExportRequest(w http.ResponseWriter, r *http.Request, current importExportWorkspace) {
	artifact, _, err := h.buildWorkspaceExportArtifact(r.Context(), current)
	if err != nil {
		problem.Write(w, 500, "Export failed", err.Error())
		return
	}
	id := importExportJobID("export")
	now := time.Now().UTC().Format(time.RFC3339Nano)
	issueCount := len(mapSlice(artifact["issues"]))
	job := map[string]any{"id": id, "type": "export", "status": "completed", "createdAt": now, "completedAt": now, "message": "Workspace export completed with " + strconv.Itoa(issueCount) + " issues.", "rowCount": issueCount, "downloadUrl": "/api/workspaces/current/import-export/exports/" + id + "/download"}
	state := readImportExportStateGo(current.Settings)
	state.Artifacts[id] = artifact
	state.Exports = prependJob(job, state.Exports, 25)
	if err := h.saveImportExportState(r.Context(), current, state); err != nil {
		problem.Write(w, 500, "Export failed", err.Error())
		return
	}
	problem.JSON(w, 201, map[string]any{"export": state.Exports[0]})
}

func (h Handler) handleCurrentCSVPreview(w http.ResponseWriter, body map[string]any) {
	csv := asStringValue(body["csv"])
	if strings.TrimSpace(csv) == "" {
		problem.Write(w, 400, "CSV content is required", "")
		return
	}
	preliminary := buildCurrentCSVPreview(csv, currentImportMapping{})
	mapping := readCurrentImportMapping(body["mapping"], preliminary.Headers)
	problem.JSON(w, 200, map[string]any{"mapping": mapping.toMap(), "preview": buildCurrentCSVPreview(csv, mapping)})
}

func (h Handler) handleProviderPrepare(w http.ResponseWriter, r *http.Request, current importExportWorkspace, body map[string]any) {
	providerName := asStringValue(body["provider"])
	if providerName != "github" && providerName != "jira" {
		problem.Write(w, 400, "Unsupported provider", "")
		return
	}
	id := importExportJobID("import")
	now := time.Now().UTC().Format(time.RFC3339Nano)
	label := "Jira"
	if providerName == "github" {
		label = "GitHub"
	}
	job := map[string]any{"id": id, "type": "import", "provider": providerName, "status": "queued", "createdAt": now, "message": label + " import setup is ready. Connect the integration to choose projects and start a guided import."}
	state := readImportExportStateGo(current.Settings)
	state.Imports = prependJob(job, state.Imports, 25)
	if err := h.saveImportExportState(r.Context(), current, state); err != nil {
		problem.Write(w, 500, "Prepare provider import failed", err.Error())
		return
	}
	problem.JSON(w, 201, map[string]any{"import": state.Imports[0], "setupUrl": "/settings/integrations"})
}

func (h Handler) handleCurrentCSVImport(w http.ResponseWriter, r *http.Request, current importExportWorkspace, p auth.Principal, body map[string]any) {
	csv := asStringValue(body["csv"])
	if strings.TrimSpace(csv) == "" {
		problem.Write(w, 400, "CSV content is required", "")
		return
	}
	preliminary := buildCurrentCSVPreview(csv, currentImportMapping{})
	mapping := readCurrentImportMapping(body["mapping"], preliminary.Headers)
	preview := buildCurrentCSVPreview(csv, mapping)
	if preview.ErrorCount > 0 {
		problem.JSON(w, 422, map[string]any{"mapping": mapping.toMap(), "preview": preview, "error": "Fix CSV validation errors before importing"})
		return
	}
	teams, err := h.importTeams(r.Context(), current.ID)
	if err != nil {
		problem.Write(w, 500, "Import failed", err.Error())
		return
	}
	if len(teams) == 0 {
		problem.Write(w, 400, "Create a team before importing issues", "")
		return
	}
	states, err := h.importStatesForTeams(r.Context(), teamIDs(teams))
	if err != nil {
		problem.Write(w, 500, "Import failed", err.Error())
		return
	}
	fallbackTeamID := stringOr(body["defaultTeamId"], teams[0].ID)
	created, err := h.insertImportedIssues(r.Context(), p, teams, states, preview.Rows, mapping, fallbackTeamID)
	if err != nil {
		problem.Write(w, 500, "Import failed", err.Error())
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	job := map[string]any{"id": importExportJobID("import"), "type": "import", "provider": "csv", "status": "completed", "createdAt": now, "completedAt": now, "fileName": stringOr(body["fileName"], "workspace-import.csv"), "message": "CSV import completed with " + strconv.Itoa(len(created)) + " issues created.", "rowCount": preview.RowCount, "importedCount": len(created), "errorCount": 0}
	state := readImportExportStateGo(current.Settings)
	state.Imports = prependJob(job, state.Imports, 25)
	if err := h.saveImportExportState(r.Context(), current, state); err != nil {
		problem.Write(w, 500, "Import failed", err.Error())
		return
	}
	problem.JSON(w, 201, map[string]any{"import": state.Imports[0], "issues": created})
}

func (h Handler) requireImportExportWorkspace(w http.ResponseWriter, r *http.Request, forbidden string) (importExportWorkspace, bool) {
	p, _ := auth.FromContext(r.Context())
	var current importExportWorkspace
	var raw []byte
	err := h.DB.QueryRow(r.Context(), `select w.id::text,w.name,w.url_slug,coalesce(w.settings,'{}'::jsonb),m.role::text from workspace w join member m on m.workspace_id=w.id and m.user_id=$1 where w.id=$2::uuid limit 1`, p.UserID, p.WorkspaceID).Scan(&current.ID, &current.Name, &current.URLSlug, &raw, &current.Role)
	if err == pgx.ErrNoRows {
		problem.Write(w, 404, "No active workspace found", "")
		return current, false
	}
	if err != nil {
		problem.Write(w, 500, "Load workspace failed", err.Error())
		return current, false
	}
	if !isManager(current.Role) {
		problem.Write(w, 403, forbidden, "")
		return current, false
	}
	current.Settings = mapFromJSON(raw)
	return current, true
}

func (h Handler) saveImportExportState(ctx context.Context, current importExportWorkspace, state importExportStateGo) error {
	settings := current.Settings
	settings["importExport"] = map[string]any{"exports": state.Exports, "imports": state.Imports, "artifacts": state.Artifacts}
	return h.saveWorkspaceSettings(ctx, current.ID, settings)
}

func readImportExportStateGo(settings map[string]any) importExportStateGo {
	raw := recordFromAny(settings["importExport"])
	return importExportStateGo{Exports: mapSlice(raw["exports"]), Imports: mapSlice(raw["imports"]), Artifacts: recordFromAny(raw["artifacts"])}
}

func mapSlice(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]map[string]any); ok {
			return typed
		}
		return []map[string]any{}
	}
	out := []map[string]any{}
	for _, item := range items {
		out = append(out, recordFromAny(item))
	}
	return out
}

func prependJob(job map[string]any, existing []map[string]any, limit int) []map[string]any {
	out := append([]map[string]any{job}, existing...)
	if len(out) > limit {
		return out[:limit]
	}
	return out
}

func jobWithID(jobs []map[string]any, id string) bool {
	for _, job := range jobs {
		if asStringValue(job["id"]) == id {
			return true
		}
	}
	return false
}

type importTeamRow struct {
	ID       string         `json:"id"`
	Key      string         `json:"key"`
	Name     string         `json:"name"`
	Settings map[string]any `json:"settings,omitempty"`
}

type importStateRow struct {
	ID       string `json:"id"`
	TeamID   string `json:"teamId"`
	Name     string `json:"name"`
	Category string `json:"category"`
}

type currentImportMapping struct {
	Title       string
	Description string
	Priority    string
	TeamKey     string
	Status      string
}

func (m currentImportMapping) toMap() map[string]any {
	out := map[string]any{"title": m.Title}
	if m.Description != "" {
		out["description"] = m.Description
	}
	if m.Priority != "" {
		out["priority"] = m.Priority
	}
	if m.TeamKey != "" {
		out["teamKey"] = m.TeamKey
	}
	return out
}

type currentCSVPreview struct {
	Headers    []string               `json:"headers"`
	Rows       []currentCSVPreviewRow `json:"rows"`
	ValidCount int                    `json:"validCount"`
	ErrorCount int                    `json:"errorCount"`
	RowCount   int                    `json:"rowCount"`
}

type currentCSVPreviewRow struct {
	RowNumber int               `json:"rowNumber"`
	Values    map[string]string `json:"values"`
	Errors    []string          `json:"errors"`
}

func (h Handler) importExportTeams(ctx context.Context, workspaceID string) ([]map[string]any, error) {
	return h.jsonRows(ctx, `select to_jsonb(t) from (select id::text,key,name,coalesce(settings,'{}'::jsonb) as settings from team where workspace_id=$1::uuid order by created_at asc) t`, workspaceID)
}

func (h Handler) legacyImportTeams(ctx context.Context, workspaceID string) ([]map[string]any, error) {
	teams, err := h.jsonRows(ctx, `select to_jsonb(t) from (select id::text,name,key from team where workspace_id=$1::uuid order by created_at asc) t`, workspaceID)
	if err != nil || len(teams) == 0 {
		return teams, err
	}
	states, err := h.jsonRows(ctx, `select to_jsonb(s) from (select ws.id::text,ws.name,ws.category::text,ws.team_id::text as "teamId" from workflow_state ws join team t on t.id=ws.team_id where t.workspace_id=$1::uuid order by ws.position asc, ws.created_at asc) s`, workspaceID)
	if err != nil {
		return nil, err
	}
	for _, team := range teams {
		teamID := asStringValue(team["id"])
		teamStates := []map[string]any{}
		for _, state := range states {
			if asStringValue(state["teamId"]) == teamID {
				teamStates = append(teamStates, state)
			}
		}
		team["states"] = teamStates
	}
	return teams, nil
}

func (h Handler) jsonRows(ctx context.Context, query string, args ...any) ([]map[string]any, error) {
	rows, err := h.DB.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		out = append(out, mapFromJSON(raw))
	}
	return out, rows.Err()
}

func (h Handler) buildWorkspaceExportArtifact(ctx context.Context, current importExportWorkspace) (map[string]any, map[string]int, error) {
	workspaceID := current.ID
	teams, err := h.jsonRows(ctx, `select to_jsonb(t) from (select * from team where workspace_id=$1::uuid order by created_at asc) t`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	states, err := h.jsonRows(ctx, `select to_jsonb(s) from (select ws.id::text,ws.name,ws.team_id::text,ws.category::text,ws.color from workflow_state ws join team t on t.id=ws.team_id where t.workspace_id=$1::uuid order by ws.position asc, ws.created_at asc) s`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	labels, err := h.jsonRows(ctx, `select to_jsonb(l) from (select * from label where workspace_id=$1::uuid order by created_at asc) l`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	projects, err := h.jsonRows(ctx, `select to_jsonb(p) from (select * from project where workspace_id=$1::uuid order by created_at asc) p`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	members, err := h.jsonRows(ctx, `select to_jsonb(m) from (select m.id::text,m.role::text,u.id as "userId",u.name,u.email from member m join "user" u on u.id=m.user_id where m.workspace_id=$1::uuid order by m.created_at asc) m`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	users, err := h.jsonRows(ctx, `select to_jsonb(u) from (select u.id,u.name,u.email from "user" u join member m on m.user_id=u.id where m.workspace_id=$1::uuid order by u.name asc) u`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	projectTeams, err := h.jsonRows(ctx, `select to_jsonb(pt) from (select pt.* from project_team pt join project p on p.id=pt.project_id where p.workspace_id=$1::uuid) pt`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	issues, err := h.jsonRows(ctx, `select to_jsonb(i) from (select i.* from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid order by i.created_at asc) i`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	comments, err := h.jsonRows(ctx, `select to_jsonb(c) from (select c.* from comment c join issue i on i.id=c.issue_id join team t on t.id=i.team_id where t.workspace_id=$1::uuid order by c.created_at asc) c`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	artifact := map[string]any{"exportedAt": time.Now().UTC().Format(time.RFC3339Nano), "workspace": map[string]any{"id": current.ID, "name": current.Name, "urlSlug": current.URLSlug}, "teams": teams, "workflowStates": states, "labels": labels, "projects": projects, "projectTeams": projectTeams, "members": members, "users": users, "issues": issues, "comments": comments}
	counts := map[string]int{"teams": len(teams), "issues": len(issues), "projects": len(projects), "labels": len(labels), "members": len(members)}
	return artifact, counts, nil
}

func readCurrentImportMapping(value any, headers []string) currentImportMapping {
	inferred := inferCurrentImportMapping(headers)
	record := recordFromAny(value)
	if s := stringFromMap(record, "title"); s != "" {
		inferred.Title = s
	}
	if s, ok := record["description"].(string); ok {
		inferred.Description = strings.TrimSpace(s)
	}
	if s, ok := record["priority"].(string); ok {
		inferred.Priority = strings.TrimSpace(s)
	}
	if s, ok := record["teamKey"].(string); ok {
		inferred.TeamKey = strings.TrimSpace(s)
	}
	return inferred
}

func inferCurrentImportMapping(headers []string) currentImportMapping {
	find := func(names ...string) string {
		for _, name := range names {
			for _, header := range headers {
				if strings.EqualFold(header, name) {
					return header
				}
			}
		}
		return ""
	}
	title := find("title", "name", "summary")
	if title == "" && len(headers) > 0 {
		title = headers[0]
	}
	if title == "" {
		title = "title"
	}
	return currentImportMapping{Title: title, Description: find("description", "body", "details"), Priority: find("priority"), TeamKey: find("team", "teamkey", "team key")}
}

func buildCurrentCSVPreview(text string, mapping currentImportMapping) currentCSVPreview {
	parsed := parseCurrentCSV(text)
	if mapping.Title == "" {
		mapping = currentImportMapping{Title: "title", Description: "description", Priority: "priority", TeamKey: "team"}
	}
	out := currentCSVPreview{Headers: parsed.Headers, Rows: []currentCSVPreviewRow{}}
	for idx, values := range parsed.Rows {
		errs := validateCurrentCSVRow(values, mapping)
		if len(errs) > 0 {
			out.ErrorCount++
		} else {
			out.ValidCount++
		}
		out.Rows = append(out.Rows, currentCSVPreviewRow{RowNumber: idx + 2, Values: values, Errors: errs})
	}
	out.RowCount = len(out.Rows)
	return out
}

type parsedCurrentCSV struct {
	Headers []string
	Rows    []map[string]string
}

func parseCurrentCSV(text string) parsedCurrentCSV {
	rows := parseImportCSV(text)
	if len(rows) == 0 {
		return parsedCurrentCSV{}
	}
	headers := rows[0].headers
	records := []map[string]string{}
	for _, row := range rows {
		record := map[string]string{}
		for idx, header := range headers {
			if idx < len(row.cols) {
				record[header] = strings.TrimSpace(row.cols[idx])
			} else {
				record[header] = ""
			}
		}
		records = append(records, record)
	}
	return parsedCurrentCSV{Headers: headers, Rows: records}
}

func validateCurrentCSVRow(values map[string]string, mapping currentImportMapping) []string {
	errs := []string{}
	title := strings.TrimSpace(values[mapping.Title])
	if title == "" {
		errs = append(errs, "Title is required")
	}
	if len(title) > 500 {
		errs = append(errs, "Title must be 500 characters or less")
	}
	if mapping.Priority != "" {
		priority := strings.ToLower(strings.TrimSpace(values[mapping.Priority]))
		if priority != "" && !validImportPriority(priority) {
			errs = append(errs, "Priority must be none, urgent, high, medium, or low")
		}
	}
	return errs
}

func (h Handler) importTeams(ctx context.Context, workspaceID string) ([]importTeamRow, error) {
	rows, err := h.DB.Query(ctx, `select id::text,key,name,coalesce(settings,'{}'::jsonb) from team where workspace_id=$1::uuid order by created_at asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []importTeamRow{}
	for rows.Next() {
		var team importTeamRow
		var raw []byte
		if err := rows.Scan(&team.ID, &team.Key, &team.Name, &raw); err != nil {
			return nil, err
		}
		team.Settings = mapFromJSON(raw)
		out = append(out, team)
	}
	return out, rows.Err()
}

func (h Handler) importTeam(ctx context.Context, workspaceID string, teamID string) (importTeamRow, error) {
	var team importTeamRow
	var raw []byte
	err := h.DB.QueryRow(ctx, `select id::text,key,name,coalesce(settings,'{}'::jsonb) from team where id=$1::uuid and workspace_id=$2::uuid limit 1`, teamID, workspaceID).Scan(&team.ID, &team.Key, &team.Name, &raw)
	team.Settings = mapFromJSON(raw)
	return team, err
}

func (h Handler) importStates(ctx context.Context, teamID string) ([]importStateRow, error) {
	rows, err := h.DB.Query(ctx, `select id::text,team_id::text,name,category::text from workflow_state where team_id=$1::uuid order by position asc, created_at asc`, teamID)
	return scanImportStates(rows, err)
}

func (h Handler) importStatesForTeams(ctx context.Context, ids []string) ([]importStateRow, error) {
	if len(ids) == 0 {
		return []importStateRow{}, nil
	}
	rows, err := h.DB.Query(ctx, `select id::text,team_id::text,name,category::text from workflow_state where team_id = any($1::uuid[]) order by position asc, created_at asc`, ids)
	return scanImportStates(rows, err)
}

func scanImportStates(rows pgx.Rows, err error) ([]importStateRow, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []importStateRow{}
	for rows.Next() {
		var state importStateRow
		if err := rows.Scan(&state.ID, &state.TeamID, &state.Name, &state.Category); err != nil {
			return nil, err
		}
		out = append(out, state)
	}
	return out, rows.Err()
}

func defaultImportState(states []importStateRow, teamID string) importStateRow {
	for _, state := range states {
		if state.TeamID == teamID && state.Category == "backlog" {
			return state
		}
	}
	for _, state := range states {
		if state.TeamID == teamID {
			return state
		}
	}
	return importStateRow{}
}

func teamIDs(teams []importTeamRow) []string {
	ids := make([]string, 0, len(teams))
	for _, team := range teams {
		ids = append(ids, team.ID)
	}
	return ids
}

func (h Handler) insertImportedIssues(ctx context.Context, p auth.Principal, teams []importTeamRow, states []importStateRow, rows []currentCSVPreviewRow, mapping currentImportMapping, fallbackTeamID string) ([]map[string]any, error) {
	teamByKey := map[string]importTeamRow{}
	teamByID := map[string]importTeamRow{}
	for _, team := range teams {
		teamByKey[strings.ToLower(team.Key)] = team
		teamByID[team.ID] = team
	}
	fallback := teams[0]
	if team, ok := teamByID[fallbackTeamID]; ok {
		fallback = team
	}
	maxNumbers := map[string]int{}
	for _, team := range teams {
		var max int
		if err := h.DB.QueryRow(ctx, `select coalesce(max(number),0)::int from issue where team_id=$1::uuid`, team.ID).Scan(&max); err != nil {
			return nil, err
		}
		maxNumbers[team.ID] = max
	}
	actorName, actorEmail := h.userNameEmail(ctx, p.UserID)
	created := []map[string]any{}
	err := pgx.BeginFunc(ctx, h.DB, func(tx pgx.Tx) error {
		for _, row := range rows {
			requestedTeam := strings.ToLower(strings.TrimSpace(row.Values[mapping.TeamKey]))
			target := fallback
			if requestedTeam != "" {
				if matched, ok := teamByKey[requestedTeam]; ok {
					target = matched
				}
			}
			state := defaultImportState(states, target.ID)
			if mapping.Status != "" {
				statusName := strings.TrimSpace(row.Values[mapping.Status])
				if statusName != "" {
					for _, candidate := range states {
						if candidate.TeamID == target.ID && strings.EqualFold(candidate.Name, statusName) {
							state = candidate
							break
						}
					}
				}
			}
			if state.ID == "" {
				return errString("No workflow state found for " + target.Key)
			}
			number := maxNumbers[target.ID] + 1
			maxNumbers[target.ID] = number
			identifier := target.Key + "-" + strconv.Itoa(number)
			title := strings.TrimSpace(row.Values[mapping.Title])
			description := normalizeIssueDescriptionHTML(row.Values[mapping.Description])
			var raw []byte
			err := tx.QueryRow(ctx, `insert into issue (number,identifier,title,description,team_id,state_id,creator_id,priority) values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8) returning to_jsonb(issue)`, number, identifier, title, description, target.ID, state.ID, p.UserID, normalizeImportPriority(row.Values[mapping.Priority])).Scan(&raw)
			if err != nil {
				return err
			}
			issue := mapFromJSON(raw)
			metadata, _ := json.Marshal(map[string]any{"identifier": identifier, "title": title, "importSource": "csv", "source": "csv-import"})
			if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,actor_name,actor_email,event_type,metadata) values ($1::uuid,$2,$3,$4,'created',$5::jsonb)`, asStringValue(issue["id"]), p.UserID, actorName, actorEmail, metadata); err != nil {
				return err
			}
			created = append(created, issue)
		}
		return nil
	})
	return created, err
}

func rowsToCurrentPreview(rows []importCSVRow, mapping map[string]any) []currentCSVPreviewRow {
	out := []currentCSVPreviewRow{}
	for _, row := range rows {
		values := map[string]string{}
		for idx, header := range row.headers {
			if idx < len(row.cols) {
				values[header] = row.cols[idx]
			} else {
				values[header] = ""
			}
		}
		out = append(out, currentCSVPreviewRow{RowNumber: row.row, Values: values, Errors: validateCurrentCSVRow(values, currentImportMapping{Title: stringFromMap(mapping, "title"), Description: stringFromMap(mapping, "description"), Priority: stringFromMap(mapping, "priority"), Status: stringFromMap(mapping, "status")})})
	}
	return out
}

func validateLegacyImportRows(rows []importCSVRow, mapping map[string]any, states []importStateRow) []map[string]any {
	errors := []map[string]any{}
	for _, row := range rows {
		rowErrors := []string{}
		if strings.TrimSpace(row.get(stringFromMap(mapping, "title"))) == "" {
			rowErrors = append(rowErrors, "Title is required")
		}
		statusColumn := stringFromMap(mapping, "status")
		status := row.get(statusColumn)
		if statusColumn != "" && status != "" && !stateNameExists(states, status) {
			rowErrors = append(rowErrors, "Unknown status: "+status)
		}
		for _, message := range rowErrors {
			errors = append(errors, map[string]any{"row": row.row, "message": message})
		}
	}
	return errors
}

func stateNameExists(states []importStateRow, name string) bool {
	for _, state := range states {
		if strings.EqualFold(state.Name, name) {
			return true
		}
	}
	return false
}

func normalizeIssueDescriptionHTML(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	if !strings.ContainsAny(trimmed, "<>") {
		paragraphs := []string{}
		for _, paragraph := range strings.Split(trimmed, "\n\n") {
			lines := strings.Split(strings.TrimSpace(paragraph), "\n")
			for idx, line := range lines {
				lines[idx] = html.EscapeString(line)
			}
			if strings.TrimSpace(paragraph) != "" {
				paragraphs = append(paragraphs, "<p>"+strings.Join(lines, "<br />")+"</p>")
			}
		}
		trimmed = strings.Join(paragraphs, "")
	}
	return &trimmed
}

func validImportPriority(value string) bool {
	switch value {
	case "none", "urgent", "high", "medium", "low":
		return true
	default:
		return false
	}
}

func normalizeImportPriority(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if validImportPriority(value) {
		return value
	}
	return "none"
}

func (h Handler) userNameEmail(ctx context.Context, userID string) (*string, *string) {
	var name, email *string
	_ = h.DB.QueryRow(ctx, `select name,email from "user" where id=$1`, userID).Scan(&name, &email)
	return name, email
}

func legacyExportArtifact(state importExportStateGo, id string) (any, bool) {
	for _, job := range state.Exports {
		if asStringValue(job["id"]) == id {
			if artifact, ok := job["artifact"]; ok {
				return artifact, true
			}
			artifact, ok := state.Artifacts[id]
			return artifact, ok
		}
	}
	return nil, false
}

func publicLegacyExports(jobs []map[string]any) []map[string]any {
	out := []map[string]any{}
	for _, job := range jobs {
		out = append(out, publicLegacyExport(job))
	}
	return out
}

func publicLegacyExport(job map[string]any) map[string]any {
	id := asStringValue(job["id"])
	counts := recordFromAny(job["counts"])
	issueCount := intFromAny(counts["issues"])
	message := stringOr(job["message"], "Workspace export completed with "+strconv.Itoa(issueCount)+" issues.")
	return map[string]any{"id": id, "status": stringOr(job["status"], "complete"), "createdAt": asStringValue(job["createdAt"]), "completedAt": asStringValue(job["completedAt"]), "message": message, "counts": counts, "downloadUrl": "/api/workspaces/exports?id=" + id + "&download=1"}
}

func importExportJobID(prefix string) string {
	var bytes [4]byte
	_, _ = rand.Read(bytes[:])
	return prefix + "_" + strconv36(time.Now().UnixMilli()) + "_" + hex.EncodeToString(bytes[:])
}

func strconv36(n int64) string {
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	if n == 0 {
		return "0"
	}
	out := ""
	for n > 0 {
		out = string(alphabet[n%36]) + out
		n /= 36
	}
	return out
}

func stringOr(value any, fallback string) string {
	if s := strings.TrimSpace(asStringValue(value)); s != "" {
		return s
	}
	return fallback
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		n, _ := typed.Int64()
		return int(n)
	default:
		return 0
	}
}
