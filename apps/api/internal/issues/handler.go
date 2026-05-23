package issues

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type Issue struct {
	ID                 string   `json:"id"`
	Number             int32    `json:"number"`
	Identifier         string   `json:"identifier"`
	Title              string   `json:"title"`
	Description        *string  `json:"description"`
	TeamID             string   `json:"team_id"`
	StateID            string   `json:"state_id"`
	AssigneeID         *string  `json:"assignee_id"`
	CreatorID          string   `json:"creator_id"`
	Priority           string   `json:"priority"`
	Estimate           *float32 `json:"estimate"`
	ParentIssueID      *string  `json:"parent_issue_id"`
	ProjectID          *string  `json:"project_id"`
	ProjectMilestoneID *string  `json:"project_milestone_id"`
	CycleID            *string  `json:"cycle_id"`
	DueDate            *string  `json:"due_date"`
	SortOrder          float32  `json:"sort_order"`
	CreatedAt          string   `json:"created_at"`
	UpdatedAt          string   `json:"updated_at"`
	ArchivedAt         *string  `json:"archived_at"`
	CanceledAt         *string  `json:"canceled_at"`
	CompletedAt        *string  `json:"completed_at"`
}

type listResponse struct {
	Data       []Issue `json:"data"`
	NextCursor *string `json:"next_cursor"`
}

type createRequest struct {
	Title              string   `json:"title"`
	Description        *string  `json:"description"`
	TeamID             string   `json:"team_id"`
	StateID            *string  `json:"state_id"`
	Priority           *string  `json:"priority"`
	AssigneeID         *string  `json:"assignee_id"`
	ProjectID          *string  `json:"project_id"`
	ProjectMilestoneID *string  `json:"project_milestone_id"`
	CycleID            *string  `json:"cycle_id"`
	ParentIssueID      *string  `json:"parent_issue_id"`
	Estimate           *float32 `json:"estimate"`
	DueDate            *string  `json:"due_date"`
}

type updateRequest struct {
	Title              *string  `json:"title"`
	Description        *string  `json:"description"`
	StateID            *string  `json:"state_id"`
	Priority           *string  `json:"priority"`
	AssigneeID         *string  `json:"assignee_id"`
	ProjectID          *string  `json:"project_id"`
	ProjectMilestoneID *string  `json:"project_milestone_id"`
	CycleID            *string  `json:"cycle_id"`
	ParentIssueID      *string  `json:"parent_issue_id"`
	Estimate           *float32 `json:"estimate"`
	DueDate            *string  `json:"due_date"`
	SortOrder          *float32 `json:"sort_order"`
	Archive            *bool    `json:"archive"`
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
	limit := clampLimit(r.URL.Query().Get("limit"))
	cursorCreated, cursorID, hasCursor := decodeCursor(r.URL.Query().Get("cursor"))
	teamID := strings.TrimSpace(r.URL.Query().Get("team_id"))

	args := []any{p.WorkspaceID, limit + 1}
	where := "t.workspace_id = $1 and i.archived_at is null"
	if teamID != "" {
		args = append(args, teamID)
		where += fmt.Sprintf(" and i.team_id = $%d::uuid", len(args))
	}
	if hasCursor {
		args = append(args, cursorCreated, cursorID)
		where += fmt.Sprintf(" and (i.created_at, i.id) < ($%d, $%d::uuid)", len(args)-1, len(args))
	}

	rows, err := h.DB.Query(r.Context(), `
		select `+issueColumns()+`
		from issue i join team t on t.id = i.team_id
		where `+where+`
		order by i.created_at desc, i.id desc
		limit $2`, args...)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "List issues failed", err.Error())
		return
	}
	defer rows.Close()
	issues, err := scanIssues(rows)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "List issues failed", err.Error())
		return
	}
	var next *string
	if len(issues) > limit {
		last := issues[limit-1]
		cursor := encodeCursor(last.CreatedAt, last.ID)
		next = &cursor
		issues = issues[:limit]
	}
	problem.JSON(w, http.StatusOK, listResponse{Data: issues, NextCursor: next})
}

func (h Handler) Get(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	issue, err := h.findIssue(r.Context(), chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Get issue failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, issue)
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if replayed := h.replayIdempotency(w, r, p); replayed {
		return
	}
	var input createRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" || input.TeamID == "" {
		problem.Write(w, http.StatusBadRequest, "Invalid issue", "title and team_id are required")
		return
	}
	priority := "none"
	if input.Priority != nil && *input.Priority != "" {
		priority = *input.Priority
	}
	if !validPriority(priority) {
		problem.Write(w, http.StatusBadRequest, "Invalid priority", "")
		return
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create issue failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	teamKey, err := assertTeamInWorkspace(r.Context(), tx, input.TeamID, p.WorkspaceID)
	if err != nil {
		writeLookupErr(w, err, "Team not found")
		return
	}
	stateID := valueOrEmpty(input.StateID)
	if stateID == "" {
		err = tx.QueryRow(r.Context(), `select id::text from workflow_state where team_id=$1::uuid and category='backlog' order by is_default desc, position asc limit 1`, input.TeamID).Scan(&stateID)
		if err != nil {
			writeLookupErr(w, err, "No default workflow state found")
			return
		}
	} else if err := assertStateForTeam(r.Context(), tx, stateID, input.TeamID); err != nil {
		writeLookupErr(w, err, "Workflow state not found")
		return
	}

	var nextNumber int32
	if err := tx.QueryRow(r.Context(), `select coalesce(max(number), 0) + 1 from issue where team_id=$1::uuid`, input.TeamID).Scan(&nextNumber); err != nil {
		problem.Write(w, 500, "Create issue failed", err.Error())
		return
	}
	identifier := fmt.Sprintf("%s-%d", teamKey, nextNumber)
	dueDate, err := parseDate(input.DueDate)
	if err != nil {
		problem.Write(w, 400, "Invalid due date", err.Error())
		return
	}

	issue, err := scanIssue(tx.QueryRow(r.Context(), `
		insert into issue (number, identifier, title, description, team_id, state_id, assignee_id, creator_id, priority, estimate, parent_issue_id, project_id, project_milestone_id, cycle_id, due_date)
		values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8,$9,$10,$11::uuid,$12::uuid,$13::uuid,$14::uuid,$15)
		returning `+issueColumns(), nextNumber, identifier, input.Title, input.Description, input.TeamID, stateID, input.AssigneeID, p.UserID, priority, input.Estimate, input.ParentIssueID, input.ProjectID, input.ProjectMilestoneID, input.CycleID, dueDate))
	if err != nil {
		problem.Write(w, 500, "Create issue failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create issue failed", err.Error())
		return
	}
	h.storeIdempotency(r, p, http.StatusCreated, issue)
	problem.JSON(w, http.StatusCreated, issue)
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if replayed := h.replayIdempotency(w, r, p); replayed {
		return
	}
	var input updateRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	existing, err := h.findIssue(r.Context(), chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update issue failed", err.Error())
		return
	}
	sets := []string{"updated_at = now()"}
	args := []any{}
	add := func(sql string, value any) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf(sql, len(args)))
	}
	if input.Title != nil {
		title := strings.TrimSpace(*input.Title)
		if title == "" {
			problem.Write(w, 400, "Invalid title", "")
			return
		}
		add("title = $%d", title)
	}
	if input.Description != nil {
		add("description = $%d", input.Description)
	}
	if input.StateID != nil {
		if err := assertStateForTeam(r.Context(), h.DB, *input.StateID, existing.TeamID); err != nil {
			writeLookupErr(w, err, "Workflow state not found")
			return
		}
		add("state_id = $%d::uuid", *input.StateID)
	}
	if input.Priority != nil {
		if !validPriority(*input.Priority) {
			problem.Write(w, 400, "Invalid priority", "")
			return
		}
		add("priority = $%d", *input.Priority)
	}
	if input.AssigneeID != nil {
		add("assignee_id = $%d", input.AssigneeID)
	}
	if input.ProjectID != nil {
		add("project_id = $%d::uuid", input.ProjectID)
	}
	if input.ProjectMilestoneID != nil {
		add("project_milestone_id = $%d::uuid", input.ProjectMilestoneID)
	}
	if input.CycleID != nil {
		add("cycle_id = $%d::uuid", input.CycleID)
	}
	if input.ParentIssueID != nil {
		add("parent_issue_id = $%d::uuid", input.ParentIssueID)
	}
	if input.Estimate != nil {
		add("estimate = $%d", input.Estimate)
	}
	if input.SortOrder != nil {
		add("sort_order = $%d", input.SortOrder)
	}
	if input.DueDate != nil {
		due, err := parseDate(input.DueDate)
		if err != nil {
			problem.Write(w, 400, "Invalid due date", err.Error())
			return
		}
		add("due_date = $%d", due)
	}
	if input.Archive != nil {
		if *input.Archive {
			sets = append(sets, "archived_at = now()")
		} else {
			sets = append(sets, "archived_at = null")
		}
	}
	args = append(args, existing.ID)
	updated, err := scanIssue(h.DB.QueryRow(r.Context(), `update issue set `+strings.Join(sets, ", ")+fmt.Sprintf(" where id = $%d::uuid returning ", len(args))+issueColumns(), args...))
	if err != nil {
		problem.Write(w, 500, "Update issue failed", err.Error())
		return
	}
	h.storeIdempotency(r, p, http.StatusOK, updated)
	problem.JSON(w, http.StatusOK, updated)
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if replayed := h.replayIdempotency(w, r, p); replayed {
		return
	}
	existing, err := h.findIssue(r.Context(), chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete issue failed", err.Error())
		return
	}
	_, err = h.DB.Exec(r.Context(), `delete from issue where id=$1::uuid`, existing.ID)
	if err != nil {
		problem.Write(w, 500, "Delete issue failed", err.Error())
		return
	}
	body := map[string]bool{"success": true}
	h.storeIdempotency(r, p, http.StatusOK, body)
	problem.JSON(w, http.StatusOK, body)
}

func (h Handler) findIssue(ctx context.Context, id string, workspaceID string) (Issue, error) {
	where := "i.identifier = $2"
	if strings.Count(id, "-") == 4 && len(id) >= 32 {
		where = "i.id = $2::uuid"
	}
	return scanIssue(h.DB.QueryRow(ctx, `select `+issueColumns()+` from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid and `+where+` limit 1`, workspaceID, id))
}

func issueColumns() string {
	return `i.id::text, i.number, i.identifier, i.title, i.description, i.team_id::text, i.state_id::text, i.assignee_id, i.creator_id, i.priority::text, i.estimate, i.parent_issue_id::text, i.project_id::text, i.project_milestone_id::text, i.cycle_id::text, i.due_date, i.sort_order, i.created_at, i.updated_at, i.archived_at, i.canceled_at, i.completed_at`
}

type rowScanner interface{ Scan(dest ...any) error }

func scanIssue(row rowScanner) (Issue, error) {
	var i Issue
	var due, created, updated, archived, canceled, completed pgtype.Timestamp
	err := row.Scan(&i.ID, &i.Number, &i.Identifier, &i.Title, &i.Description, &i.TeamID, &i.StateID, &i.AssigneeID, &i.CreatorID, &i.Priority, &i.Estimate, &i.ParentIssueID, &i.ProjectID, &i.ProjectMilestoneID, &i.CycleID, &due, &i.SortOrder, &created, &updated, &archived, &canceled, &completed)
	if err != nil {
		return Issue{}, err
	}
	i.DueDate = formatTS(due)
	i.CreatedAt = *formatTS(created)
	i.UpdatedAt = *formatTS(updated)
	i.ArchivedAt = formatTS(archived)
	i.CanceledAt = formatTS(canceled)
	i.CompletedAt = formatTS(completed)
	return i, nil
}

func scanIssues(rows pgx.Rows) ([]Issue, error) {
	var out []Issue
	for rows.Next() {
		i, err := scanIssue(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}
func formatTS(ts pgtype.Timestamp) *string {
	if !ts.Valid {
		return nil
	}
	value := ts.Time.UTC().Format(time.RFC3339Nano)
	return &value
}
func clampLimit(value string) int {
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 {
		return 50
	}
	if n > 100 {
		return 100
	}
	return n
}
func encodeCursor(createdAt, id string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(createdAt + "|" + id))
}
func decodeCursor(value string) (time.Time, string, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return time.Time{}, "", false
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, "", false
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	return t, parts[1], err == nil
}
func validPriority(value string) bool {
	switch value {
	case "none", "urgent", "high", "medium", "low":
		return true
	default:
		return false
	}
}
func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
func parseDate(value *string) (*time.Time, error) {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", strings.TrimSpace(*value))
	if err != nil {
		return nil, err
	}
	return &t, nil
}

type queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func assertTeamInWorkspace(ctx context.Context, q queryer, teamID, workspaceID string) (string, error) {
	var key string
	err := q.QueryRow(ctx, `select key from team where id=$1::uuid and workspace_id=$2::uuid and retired_at is null and deleted_at is null`, teamID, workspaceID).Scan(&key)
	return key, err
}
func assertStateForTeam(ctx context.Context, q queryer, stateID, teamID string) error {
	var found string
	return q.QueryRow(ctx, `select id::text from workflow_state where id=$1::uuid and team_id=$2::uuid`, stateID, teamID).Scan(&found)
}
func writeLookupErr(w http.ResponseWriter, err error, title string) {
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, title, "")
	} else {
		problem.Write(w, 500, title, err.Error())
	}
}

func (h Handler) replayIdempotency(w http.ResponseWriter, r *http.Request, p auth.Principal) bool {
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		return false
	}
	var status int
	var body []byte
	err := h.DB.QueryRow(r.Context(), `select status_code, response_body from idempotency_key where key=$1 and method=$2 and path=$3 and user_id=$4 and expires_at > now()`, key, r.Method, r.URL.Path, p.UserID).Scan(&status, &body)
	if err != nil {
		return false
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
	return true
}
func (h Handler) storeIdempotency(r *http.Request, p auth.Principal, status int, value any) {
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		return
	}
	body, err := json.Marshal(value)
	if err != nil {
		return
	}
	_, _ = h.DB.Exec(context.Background(), `insert into idempotency_key (key, method, path, user_id, status_code, response_body, expires_at) values ($1,$2,$3,$4,$5,$6,now()+interval '24 hours') on conflict (key, method, path, user_id) do nothing`, key, r.Method, r.URL.Path, p.UserID, status, body)
}
