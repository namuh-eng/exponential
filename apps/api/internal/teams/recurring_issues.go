package teams

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

const recurringTitleMaxLength = 500

type recurringIssueRecord struct {
	ID            string         `json:"id"`
	WorkspaceID   string         `json:"workspaceId"`
	TeamID        string         `json:"teamId"`
	CreatorID     *string        `json:"creatorId"`
	Title         string         `json:"title"`
	Description   *string        `json:"description"`
	StateID       *string        `json:"stateId"`
	AssigneeID    *string        `json:"assigneeId"`
	Priority      string         `json:"priority"`
	LabelIDs      []string       `json:"labelIds"`
	ProjectID     *string        `json:"projectId"`
	CadenceConfig map[string]any `json:"cadenceConfig"`
	Timezone      string         `json:"timezone"`
	StartAt       *string        `json:"startAt"`
	NextRunAt     string         `json:"nextRunAt"`
	Enabled       bool           `json:"enabled"`
	LastRunAt     *string        `json:"lastRunAt"`
	CreatedAt     string         `json:"createdAt"`
	UpdatedAt     string         `json:"updatedAt"`
	CadenceLabel  string         `json:"cadenceLabel"`
}

type recurringIssuesResponse struct {
	Team struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Key  string `json:"key"`
	} `json:"team"`
	RecurringIssues []recurringIssueRecord `json:"recurringIssues"`
}

type recurringValidation struct {
	Title         string
	Description   *string
	CadenceConfig map[string]any
	StartAt       time.Time
	Timezone      string
	Enabled       bool
	StateID       *string
	AssigneeID    *string
	Priority      string
	LabelIDs      []string
	ProjectID     *string
}

func (h Handler) ListRecurringIssues(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.recurringTeam(w, r, p.WorkspaceID, chi.URLParam(r, "key"), "Team not found")
	if !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), recurringSelectSQL+` where team_id=$1::uuid order by created_at desc`, team.ID)
	if err != nil {
		problem.Write(w, 500, "List recurring issues failed", err.Error())
		return
	}
	defer rows.Close()
	records, err := scanRecurringRows(rows)
	if err != nil {
		problem.Write(w, 500, "List recurring issues failed", err.Error())
		return
	}
	out := recurringIssuesResponse{RecurringIssues: records}
	out.Team.ID, out.Team.Name, out.Team.Key = team.ID, team.Name, team.Key
	problem.JSON(w, 200, out)
}

func (h Handler) CreateRecurringIssue(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.recurringTeam(w, r, p.WorkspaceID, chi.URLParam(r, "key"), "Team not found")
	if !ok {
		return
	}
	body, ok := decodeRecurringBody(w, r)
	if !ok {
		return
	}
	input, ok := validateRecurringInput(w, body)
	if !ok {
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create recurring issue failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if input.StateID == nil {
		stateID, err := defaultStateID(r, tx, team.ID)
		if err != nil {
			problem.Write(w, 500, "Create recurring issue failed", err.Error())
			return
		}
		input.StateID = stateID
	}
	input.LabelIDs = normalizeRecurringLabelIDs(input.LabelIDs)
	if err := validateRecurringRelationships(r, tx, team, input.StateID, input.AssigneeID, input.LabelIDs, input.ProjectID); err != nil {
		writeRecurringLookupErr(w, err)
		return
	}
	nextRunAt := computeRecurringNextRunAt(input.CadenceConfig, input.StartAt, time.Now())
	cadenceRaw, _ := json.Marshal(input.CadenceConfig)
	labelRaw, _ := json.Marshal(input.LabelIDs)
	var createdID string
	if err := tx.QueryRow(r.Context(), `insert into recurring_issue (workspace_id,team_id,creator_id,title,description,state_id,assignee_id,priority,label_ids,project_id,cadence_config,timezone,start_at,next_run_at,enabled) values ($1::uuid,$2::uuid,$3,$4,$5,$6::uuid,$7,$8,$9::jsonb,$10::uuid,$11::jsonb,$12,$13,$14,$15) returning id::text`, team.WorkspaceID, team.ID, p.UserID, input.Title, input.Description, input.StateID, input.AssigneeID, input.Priority, labelRaw, input.ProjectID, cadenceRaw, input.Timezone, input.StartAt, nextRunAt, input.Enabled).Scan(&createdID); err != nil {
		problem.Write(w, 500, "Create recurring issue failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create recurring issue failed", err.Error())
		return
	}
	record, err := h.findRecurring(r, team.ID, createdID)
	if err != nil {
		problem.Write(w, 500, "Create recurring issue failed", err.Error())
		return
	}
	problem.JSON(w, 201, record)
}

func (h Handler) UpdateRecurringIssue(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.recurringTeam(w, r, p.WorkspaceID, chi.URLParam(r, "key"), "Recurring issue not found")
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		problem.Write(w, 400, "Recurring issue not found", "")
		return
	}
	current, err := h.findRecurring(r, team.ID, id)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Recurring issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update recurring issue failed", err.Error())
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Update recurring issue failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	body, ok := decodeRecurringBody(w, r)
	if !ok {
		return
	}
	setParts := []string{"updated_at=now()"}
	args := []any{}
	add := func(expr string, value any) {
		args = append(args, value)
		setParts = append(setParts, fmt.Sprintf(expr, len(args)))
	}
	if raw, present := body["title"]; present {
		title := normalizeRecurringTitle(raw)
		if title == "" {
			problem.Write(w, 400, "Title is required", "")
			return
		}
		add("title=$%d", title)
	}
	if raw, present := body["description"]; present {
		add("description=$%d", nullableTrimmedString(raw))
	}
	if raw, present := body["enabled"]; present {
		add("enabled=$%d", raw == true)
	}
	if raw, present := body["timezone"]; present {
		add("timezone=$%d", normalizeRecurringTimezone(raw))
	}
	if raw, present := body["priority"]; present {
		priority := recurringPriority(raw)
		if priority == "" {
			problem.Write(w, 400, "Choose a valid priority", "")
			return
		}
		add("priority=$%d", priority)
	}
	if raw, present := body["stateId"]; present {
		stateID := nullableTrimmedString(raw)
		if err := validateRecurringState(r, tx, team.ID, stateID); err != nil {
			writeRecurringLookupErr(w, err)
			return
		}
		add("state_id=$%d", stateID)
	}
	if raw, present := body["assigneeId"]; present {
		assigneeID := nullableTrimmedString(raw)
		if err := validateRecurringAssignee(r, tx, team.WorkspaceID, assigneeID); err != nil {
			writeRecurringLookupErr(w, err)
			return
		}
		add("assignee_id=$%d", assigneeID)
	}
	if raw, present := body["labelIds"]; present {
		labelIDs := normalizeRecurringLabelIDs(stringSlice(raw))
		if err := validateRecurringLabels(r, tx, team.WorkspaceID, team.ID, labelIDs); err != nil {
			writeRecurringLookupErr(w, err)
			return
		}
		rawJSON, _ := json.Marshal(labelIDs)
		add("label_ids=$%d::jsonb", rawJSON)
	}
	if raw, present := body["projectId"]; present {
		projectID := nullableTrimmedString(raw)
		if err := validateRecurringProject(r, tx, team.WorkspaceID, projectID); err != nil {
			writeRecurringLookupErr(w, err)
			return
		}
		add("project_id=$%d", projectID)
	}
	cadenceConfig := current.CadenceConfig
	cadenceChanged := false
	if raw, present := body["cadenceConfig"]; present {
		cfg, message, ok := normalizeRecurringCadence(raw)
		if !ok {
			problem.Write(w, 400, message, "")
			return
		}
		cadenceConfig = cfg
		cadenceRaw, _ := json.Marshal(cfg)
		add("cadence_config=$%d::jsonb", cadenceRaw)
		cadenceChanged = true
	}
	startAt := parseNullableTimeString(current.StartAt)
	startChanged := false
	if raw, present := body["startAt"]; present {
		parsed, ok := parseRecurringDate(raw)
		if !ok {
			problem.Write(w, 400, "Start date/time is required", "")
			return
		}
		startAt = parsed
		add("start_at=$%d", parsed)
		startChanged = true
	}
	if cadenceChanged || startChanged {
		add("next_run_at=$%d", computeRecurringNextRunAt(cadenceConfig, startAt, time.Now()))
	}
	args = append(args, id, team.ID)
	query := fmt.Sprintf("update recurring_issue set %s where id=$%d::uuid and team_id=$%d::uuid", strings.Join(setParts, ", "), len(args)-1, len(args))
	if _, err := tx.Exec(r.Context(), query, args...); err != nil {
		problem.Write(w, 500, "Update recurring issue failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Update recurring issue failed", err.Error())
		return
	}
	updated, err := h.findRecurring(r, team.ID, id)
	if err != nil {
		problem.Write(w, 500, "Update recurring issue failed", err.Error())
		return
	}
	problem.JSON(w, 200, updated)
}

func (h Handler) DeleteRecurringIssue(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.recurringTeam(w, r, p.WorkspaceID, chi.URLParam(r, "key"), "Recurring issue not found")
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	result, err := h.DB.Exec(r.Context(), `delete from recurring_issue where id=$1::uuid and team_id=$2::uuid`, id, team.ID)
	if err != nil {
		problem.Write(w, 500, "Delete recurring issue failed", err.Error())
		return
	}
	if result.RowsAffected() == 0 {
		problem.Write(w, 404, "Recurring issue not found", "")
		return
	}
	w.WriteHeader(204)
}

const recurringSelectSQL = `select id::text, workspace_id::text, team_id::text, creator_id, title, description, state_id::text, assignee_id, priority::text, coalesce(label_ids,'[]'::jsonb), project_id::text, coalesce(cadence_config,'{}'::jsonb), timezone, start_at, next_run_at, enabled, last_run_at, created_at, updated_at from recurring_issue`

func (h Handler) recurringTeam(w http.ResponseWriter, r *http.Request, workspaceID, key, notFound string) (teamRecordForSettings, bool) {
	team, err := h.findTeamRecord(r, workspaceID, key)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, notFound, "")
		return team, false
	}
	if err != nil {
		problem.Write(w, 500, "Load recurring issues failed", err.Error())
		return team, false
	}
	return team, true
}

func (h Handler) findRecurring(r *http.Request, teamID, id string) (recurringIssueRecord, error) {
	return h.scanRecurringRow(h.DB.QueryRow(r.Context(), recurringSelectSQL+` where id=$1::uuid and team_id=$2::uuid limit 1`, id, teamID))
}
func (h Handler) scanRecurringRow(row scanner) (recurringIssueRecord, error) {
	var rec recurringIssueRecord
	var labelRaw, cadenceRaw []byte
	var startAt, lastRunAt *time.Time
	var nextRunAt, createdAt, updatedAt time.Time
	if err := row.Scan(&rec.ID, &rec.WorkspaceID, &rec.TeamID, &rec.CreatorID, &rec.Title, &rec.Description, &rec.StateID, &rec.AssigneeID, &rec.Priority, &labelRaw, &rec.ProjectID, &cadenceRaw, &rec.Timezone, &startAt, &nextRunAt, &rec.Enabled, &lastRunAt, &createdAt, &updatedAt); err != nil {
		return rec, err
	}
	_ = json.Unmarshal(labelRaw, &rec.LabelIDs)
	if rec.LabelIDs == nil {
		rec.LabelIDs = []string{}
	}
	_ = json.Unmarshal(cadenceRaw, &rec.CadenceConfig)
	if rec.CadenceConfig == nil {
		rec.CadenceConfig = map[string]any{}
	}
	rec.StartAt = formatOptionalTime(startAt)
	rec.NextRunAt = nextRunAt.UTC().Format(time.RFC3339)
	rec.LastRunAt = formatOptionalTime(lastRunAt)
	rec.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	rec.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	rec.CadenceLabel = formatRecurringCadence(rec.CadenceConfig)
	return rec, nil
}
func scanRecurringRows(rows pgx.Rows) ([]recurringIssueRecord, error) {
	out := []recurringIssueRecord{}
	for rows.Next() {
		var rec recurringIssueRecord
		var labelRaw, cadenceRaw []byte
		var startAt, lastRunAt *time.Time
		var nextRunAt, createdAt, updatedAt time.Time
		if err := rows.Scan(&rec.ID, &rec.WorkspaceID, &rec.TeamID, &rec.CreatorID, &rec.Title, &rec.Description, &rec.StateID, &rec.AssigneeID, &rec.Priority, &labelRaw, &rec.ProjectID, &cadenceRaw, &rec.Timezone, &startAt, &nextRunAt, &rec.Enabled, &lastRunAt, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(labelRaw, &rec.LabelIDs)
		if rec.LabelIDs == nil {
			rec.LabelIDs = []string{}
		}
		_ = json.Unmarshal(cadenceRaw, &rec.CadenceConfig)
		if rec.CadenceConfig == nil {
			rec.CadenceConfig = map[string]any{}
		}
		rec.StartAt = formatOptionalTime(startAt)
		rec.NextRunAt = nextRunAt.UTC().Format(time.RFC3339)
		rec.LastRunAt = formatOptionalTime(lastRunAt)
		rec.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		rec.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		rec.CadenceLabel = formatRecurringCadence(rec.CadenceConfig)
		out = append(out, rec)
	}
	return out, rows.Err()
}

func decodeRecurringBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body == nil {
		problem.Write(w, 400, "Invalid JSON body", "")
		return nil, false
	}
	return body, true
}
func validateRecurringInput(w http.ResponseWriter, body map[string]any) (recurringValidation, bool) {
	var out recurringValidation
	title := normalizeRecurringTitle(body["title"])
	if title == "" {
		problem.Write(w, 400, "Title is required", "")
		return out, false
	}
	if len(title) > recurringTitleMaxLength {
		problem.Write(w, 400, "Title must be 500 characters or fewer", "")
		return out, false
	}
	cfg, msg, ok := normalizeRecurringCadence(body["cadenceConfig"])
	if !ok {
		problem.Write(w, 400, msg, "")
		return out, false
	}
	startAt, ok := parseRecurringDate(body["startAt"])
	if !ok {
		problem.Write(w, 400, "Start date/time is required", "")
		return out, false
	}
	priority := recurringPriority(body["priority"])
	if priority == "" {
		problem.Write(w, 400, "Choose a valid priority", "")
		return out, false
	}
	out = recurringValidation{Title: title, Description: nullableTrimmedString(body["description"]), CadenceConfig: cfg, StartAt: startAt, Timezone: normalizeRecurringTimezone(body["timezone"]), Enabled: body["enabled"] != false, StateID: nullableTrimmedString(body["stateId"]), AssigneeID: nullableTrimmedString(body["assigneeId"]), Priority: priority, LabelIDs: stringSlice(body["labelIds"]), ProjectID: nullableTrimmedString(body["projectId"])}
	return out, true
}
func normalizeRecurringTitle(value any) string {
	if s, ok := value.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}
func nullableTrimmedString(value any) *string {
	s, ok := value.(string)
	if !ok {
		return nil
	}
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
func normalizeRecurringTimezone(value any) string {
	if s, ok := value.(string); ok && strings.TrimSpace(s) != "" {
		trimmed := strings.TrimSpace(s)
		if len(trimmed) > 100 {
			return trimmed[:100]
		}
		return trimmed
	}
	return "UTC"
}
func recurringPriority(value any) string {
	priority, _ := value.(string)
	if priority == "" {
		priority = "none"
	}
	if contains([]string{"none", "urgent", "high", "medium", "low"}, priority) {
		return priority
	}
	return ""
}
func stringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return []string{}
	}
	out := []string{}
	for _, item := range raw {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}
func normalizeRecurringLabelIDs(values []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}
func parseRecurringDate(value any) (time.Time, bool) {
	s, ok := value.(string)
	if !ok || strings.TrimSpace(s) == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, s)
	if err == nil {
		return t, true
	}
	t, err = time.Parse("2006-01-02T15:04", s)
	return t, err == nil
}
func parseNullableTimeString(value *string) time.Time {
	if value == nil {
		return time.Now()
	}
	if t, err := time.Parse(time.RFC3339, *value); err == nil {
		return t
	}
	return time.Now()
}
func normalizeRecurringCadence(value any) (map[string]any, string, bool) {
	raw, ok := value.(map[string]any)
	if !ok {
		return nil, "Choose a valid cadence", false
	}
	cadence, _ := raw["cadence"].(string)
	if !contains([]string{"daily", "weekly", "monthly"}, cadence) {
		return nil, "Choose a valid cadence", false
	}
	interval := 1
	if v, ok := raw["interval"].(float64); ok {
		interval = int(v)
		if float64(interval) != v {
			return nil, "Cadence interval must be between 1 and 52", false
		}
	}
	if interval < 1 || interval > 52 {
		return nil, "Cadence interval must be between 1 and 52", false
	}
	return map[string]any{"cadence": cadence, "interval": interval}, "", true
}
func computeRecurringNextRunAt(config map[string]any, startAt, now time.Time) time.Time {
	next := startAt
	cadence, _ := config["cadence"].(string)
	interval := 1
	switch v := config["interval"].(type) {
	case int:
		interval = v
	case float64:
		interval = int(v)
	}
	for next.Before(now) {
		switch cadence {
		case "daily":
			next = next.AddDate(0, 0, interval)
		case "weekly":
			next = next.AddDate(0, 0, interval*7)
		default:
			next = next.AddDate(0, interval, 0)
		}
	}
	return next
}
func formatRecurringCadence(config map[string]any) string {
	cadence, _ := config["cadence"].(string)
	interval := 1
	switch v := config["interval"].(type) {
	case int:
		interval = v
	case float64:
		interval = int(v)
	}
	unit := strings.TrimSuffix(cadence, "ly")
	if interval == 1 {
		if cadence == "daily" {
			return "Daily"
		}
		return "Every " + unit
	}
	if cadence == "daily" {
		return fmt.Sprintf("Every %d days", interval)
	}
	return fmt.Sprintf("Every %d %ss", interval, unit)
}
func formatOptionalTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}
func (h Handler) defaultStateID(r *http.Request, teamID string) (*string, error) {
	return defaultStateID(r, h.DB, teamID)
}

func defaultStateID(r *http.Request, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, teamID string) (*string, error) {
	var id string
	err := q.QueryRow(r.Context(), `select id::text from workflow_state where team_id=$1::uuid and category='backlog' order by is_default desc, position asc limit 1 for share`, teamID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

type recurringLookupErr struct {
	title  string
	err    error
	status int
}

func (e *recurringLookupErr) Error() string {
	return e.err.Error()
}

func (e *recurringLookupErr) Unwrap() error {
	return e.err
}

func newRecurringLookupErr(title string, err error) *recurringLookupErr {
	if err == nil {
		return nil
	}
	return &recurringLookupErr{title: title, err: err}
}

func writeRecurringLookupErr(w http.ResponseWriter, err *recurringLookupErr) {
	if err.status != 0 {
		problem.Write(w, err.status, err.title, err.Error())
	} else if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, err.title, "")
	} else {
		problem.Write(w, 500, err.title, err.Error())
	}
}

func (h Handler) validateRecurringRelationships(r *http.Request, team teamRecordForSettings, stateID, assigneeID *string, labelIDs []string, projectID *string) *recurringLookupErr {
	return validateRecurringRelationships(r, h.DB, team, stateID, assigneeID, labelIDs, projectID)
}

func validateRecurringRelationships(r *http.Request, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}, team teamRecordForSettings, stateID, assigneeID *string, labelIDs []string, projectID *string) *recurringLookupErr {
	if err := validateRecurringState(r, q, team.ID, stateID); err != nil {
		return err
	}
	if err := validateRecurringAssignee(r, q, team.WorkspaceID, assigneeID); err != nil {
		return err
	}
	if err := validateRecurringLabels(r, q, team.WorkspaceID, team.ID, labelIDs); err != nil {
		return err
	}
	if err := validateRecurringProject(r, q, team.WorkspaceID, projectID); err != nil {
		return err
	}
	return nil
}

func (h Handler) validateRecurringState(r *http.Request, teamID string, stateID *string) *recurringLookupErr {
	return validateRecurringState(r, h.DB, teamID, stateID)
}

func validateRecurringState(r *http.Request, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, teamID string, stateID *string) *recurringLookupErr {
	if stateID == nil {
		return nil
	}
	if _, err := uuid.Parse(*stateID); err != nil {
		return &recurringLookupErr{title: "Workflow state not found", err: err, status: http.StatusBadRequest}
	}
	var found string
	err := q.QueryRow(r.Context(), `select id::text from workflow_state where id=$1::uuid and team_id=$2::uuid limit 1 for share`, *stateID, teamID).Scan(&found)
	return newRecurringLookupErr("Workflow state not found", err)
}

func (h Handler) validateRecurringAssignee(r *http.Request, workspaceID string, assigneeID *string) *recurringLookupErr {
	return validateRecurringAssignee(r, h.DB, workspaceID, assigneeID)
}

func validateRecurringAssignee(r *http.Request, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, workspaceID string, assigneeID *string) *recurringLookupErr {
	if assigneeID == nil {
		return nil
	}
	var found int
	err := q.QueryRow(r.Context(), `select 1 from member where workspace_id=$1::uuid and user_id=$2 limit 1 for share`, workspaceID, *assigneeID).Scan(&found)
	return newRecurringLookupErr("Assignee is not a workspace member", err)
}

func (h Handler) validateRecurringLabels(r *http.Request, workspaceID, teamID string, labelIDs []string) *recurringLookupErr {
	return validateRecurringLabels(r, h.DB, workspaceID, teamID, labelIDs)
}

func validateRecurringLabels(r *http.Request, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, workspaceID, teamID string, labelIDs []string) *recurringLookupErr {
	if len(labelIDs) == 0 {
		return nil
	}
	for _, labelID := range labelIDs {
		if _, err := uuid.Parse(labelID); err != nil {
			return &recurringLookupErr{title: "Invalid label id", err: err, status: http.StatusBadRequest}
		}
	}
	rows, err := q.Query(r.Context(), `select id::text from label where id = any($1::uuid[]) and workspace_id=$2::uuid and (team_id is null or team_id=$3::uuid) and archived_at is null for share`, labelIDs, workspaceID, teamID)
	if err != nil {
		return newRecurringLookupErr("Label not found", err)
	}
	count := 0
	for rows.Next() {
		count++
	}
	rowErr := rows.Err()
	rows.Close()
	if rowErr != nil {
		return newRecurringLookupErr("Label not found", rowErr)
	}
	if count != len(labelIDs) {
		return newRecurringLookupErr("Label not found", pgx.ErrNoRows)
	}
	return nil
}

func (h Handler) validateRecurringProject(r *http.Request, workspaceID string, projectID *string) *recurringLookupErr {
	return validateRecurringProject(r, h.DB, workspaceID, projectID)
}

func validateRecurringProject(r *http.Request, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, workspaceID string, projectID *string) *recurringLookupErr {
	if projectID == nil {
		return nil
	}
	if _, err := uuid.Parse(*projectID); err != nil {
		return &recurringLookupErr{title: "Project not found", err: err, status: http.StatusBadRequest}
	}
	var found string
	err := q.QueryRow(r.Context(), `select id::text from project where id=$1::uuid and workspace_id=$2::uuid limit 1 for share`, *projectID, workspaceID).Scan(&found)
	return newRecurringLookupErr("Project not found", err)
}
