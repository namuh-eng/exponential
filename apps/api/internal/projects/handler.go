package projects

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type Project struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description *string       `json:"description"`
	Icon        *string       `json:"icon"`
	Slug        string        `json:"slug"`
	Status      string        `json:"status"`
	Priority    string        `json:"priority"`
	LeadID      *string       `json:"lead_id"`
	WorkspaceID string        `json:"workspace_id"`
	StartDate   *string       `json:"start_date"`
	TargetDate  *string       `json:"target_date"`
	CompletedAt *string       `json:"completed_at"`
	CanceledAt  *string       `json:"canceled_at"`
	Teams       []ProjectTeam `json:"teams"`
	Progress    Progress      `json:"progress"`
	CreatedAt   string        `json:"created_at"`
	UpdatedAt   string        `json:"updated_at"`
}

type ProjectTeam struct {
	ID   string `json:"id"`
	Key  string `json:"key"`
	Name string `json:"name"`
}

type Progress struct {
	Total      int32 `json:"total"`
	Completed  int32 `json:"completed"`
	Percentage int32 `json:"percentage"`
}

type listResponse struct {
	Projects []Project `json:"projects"`
}

type createRequest struct {
	Name        string   `json:"name"`
	Description *string  `json:"description"`
	Icon        *string  `json:"icon"`
	Slug        *string  `json:"slug"`
	Status      *string  `json:"status"`
	Priority    *string  `json:"priority"`
	LeadID      *string  `json:"lead_id"`
	StartDate   *string  `json:"start_date"`
	TargetDate  *string  `json:"target_date"`
	TeamIDs     []string `json:"team_ids"`
	TeamKeys    []string `json:"team_keys"`
}

type updateRequest struct {
	Name        *string  `json:"name"`
	Description *string  `json:"description"`
	Icon        *string  `json:"icon"`
	Slug        *string  `json:"slug"`
	Status      *string  `json:"status"`
	Priority    *string  `json:"priority"`
	LeadID      *string  `json:"lead_id"`
	StartDate   *string  `json:"start_date"`
	TargetDate  *string  `json:"target_date"`
	TeamIDs     []string `json:"team_ids"`
	TeamKeys    []string `json:"team_keys"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{slug}", h.Get)
	r.Patch("/{slug}", h.Update)
	r.Delete("/{slug}", h.Delete)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	projects, err := h.loadProjects(r.Context(), `p.workspace_id=$1::uuid`, p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List projects failed", err.Error())
		return
	}
	problem.JSON(w, 200, listResponse{Projects: projects})
}

func (h Handler) Get(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	project, err := h.findProject(r.Context(), p.WorkspaceID, chi.URLParam(r, "slug"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Project not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get project failed", err.Error())
		return
	}
	problem.JSON(w, 200, project)
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input createRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		problem.Write(w, 400, "Project name is required", "")
		return
	}
	if len(name) > 255 {
		problem.Write(w, 400, "Project name must be 255 characters or fewer", "")
		return
	}
	slugInput := name
	if input.Slug != nil {
		slugInput = *input.Slug
	}
	slug := sanitizeProjectSlug(slugInput)
	if slug == "" {
		problem.Write(w, 400, "Project name must include letters or numbers", "")
		return
	}
	status := valueOr(input.Status, "planned")
	priority := valueOr(input.Priority, "none")
	if !validStatus(status) || !validPriority(priority) {
		problem.Write(w, 400, "Invalid project", "status or priority is invalid")
		return
	}
	startDate, err := parseDate(input.StartDate)
	if err != nil {
		problem.Write(w, 400, "Invalid start date", err.Error())
		return
	}
	targetDate, err := parseDate(input.TargetDate)
	if err != nil {
		problem.Write(w, 400, "Invalid target date", err.Error())
		return
	}
	teams, err := h.resolveTeams(r.Context(), p.WorkspaceID, input.TeamIDs, input.TeamKeys)
	if err != nil {
		problem.Write(w, 400, "Team not found in active workspace", err.Error())
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create project failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	slug, err = uniqueSlug(r.Context(), tx, p.WorkspaceID, slug, "")
	if err != nil {
		problem.Write(w, 500, "Create project failed", err.Error())
		return
	}
	project, err := scanProject(tx.QueryRow(r.Context(), `
		insert into project (name, description, icon, slug, status, priority, lead_id, workspace_id, start_date, target_date)
		values ($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9,$10)
		returning `+projectColumns(), name, input.Description, truncatePtr(input.Icon, 10), slug, status, priority, input.LeadID, p.WorkspaceID, startDate, targetDate))
	if isUniqueViolation(err) {
		problem.Write(w, 409, "Project slug already exists", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create project failed", err.Error())
		return
	}
	if err := replaceProjectTeams(r.Context(), tx, project.ID, teams); err != nil {
		problem.Write(w, 500, "Create project failed", err.Error())
		return
	}
	project.Teams = teams
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "project", project.ID, "created", project, p.UserID); err != nil {
		problem.Write(w, 500, "Create project failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create project failed", err.Error())
		return
	}
	problem.JSON(w, 201, project)
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	existing, err := h.findProject(r.Context(), p.WorkspaceID, chi.URLParam(r, "slug"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Project not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update project failed", err.Error())
		return
	}
	var input updateRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	sets := []string{"updated_at=now()"}
	args := []any{}
	add := func(sql string, value any) {
		args = append(args, value)
		sets = append(sets, fmt.Sprintf(sql, len(args)))
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" || len(name) > 255 {
			problem.Write(w, 400, "Invalid project name", "")
			return
		}
		add("name=$%d", name)
	}
	if input.Description != nil {
		add("description=$%d", input.Description)
	}
	if input.Icon != nil {
		add("icon=$%d", truncatePtr(input.Icon, 10))
	}
	if input.Status != nil {
		if !validStatus(*input.Status) {
			problem.Write(w, 400, "Invalid project status", "")
			return
		}
		add("status=$%d", *input.Status)
	}
	if input.Priority != nil {
		if !validPriority(*input.Priority) {
			problem.Write(w, 400, "Invalid project priority", "")
			return
		}
		add("priority=$%d", *input.Priority)
	}
	if input.LeadID != nil {
		add("lead_id=$%d", nullableString(*input.LeadID))
	}
	if input.StartDate != nil {
		v, err := parseDate(input.StartDate)
		if err != nil {
			problem.Write(w, 400, "Invalid start date", err.Error())
			return
		}
		add("start_date=$%d", v)
	}
	if input.TargetDate != nil {
		v, err := parseDate(input.TargetDate)
		if err != nil {
			problem.Write(w, 400, "Invalid target date", err.Error())
			return
		}
		add("target_date=$%d", v)
	}
	if input.Slug != nil {
		slug := sanitizeProjectSlug(*input.Slug)
		if slug == "" {
			problem.Write(w, 400, "Invalid project slug", "")
			return
		}
		add("slug=$%d", slug)
	}
	teamsChanged := input.TeamIDs != nil || input.TeamKeys != nil
	teams := existing.Teams
	if teamsChanged {
		teams, err = h.resolveTeams(r.Context(), p.WorkspaceID, input.TeamIDs, input.TeamKeys)
		if err != nil {
			problem.Write(w, 400, "Team not found in active workspace", err.Error())
			return
		}
	}
	args = append(args, existing.ID)
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Update project failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	updated, err := scanProject(tx.QueryRow(r.Context(), `update project set `+strings.Join(sets, ", ")+fmt.Sprintf(" where id=$%d::uuid returning ", len(args))+projectColumns(), args...))
	if isUniqueViolation(err) {
		problem.Write(w, 409, "Project slug already exists", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update project failed", err.Error())
		return
	}
	if teamsChanged {
		if err := replaceProjectTeams(r.Context(), tx, updated.ID, teams); err != nil {
			problem.Write(w, 500, "Update project failed", err.Error())
			return
		}
	}
	updated.Teams = teams
	updated.Progress = existing.Progress
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "project", updated.ID, "updated", updated, p.UserID); err != nil {
		problem.Write(w, 500, "Update project failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Update project failed", err.Error())
		return
	}
	problem.JSON(w, 200, updated)
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	existing, err := h.findProject(r.Context(), p.WorkspaceID, chi.URLParam(r, "slug"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Project not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete project failed", err.Error())
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Delete project failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err := tx.Exec(r.Context(), `delete from project where id=$1::uuid`, existing.ID); err != nil {
		problem.Write(w, 500, "Delete project failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "project", existing.ID, "deleted", existing, p.UserID); err != nil {
		problem.Write(w, 500, "Delete project failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Delete project failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) findProject(ctx context.Context, workspaceID, slug string) (Project, error) {
	projects, err := h.loadProjects(ctx, `p.workspace_id=$1::uuid and p.slug=$2`, workspaceID, slug)
	if err != nil {
		return Project{}, err
	}
	if len(projects) == 0 {
		return Project{}, pgx.ErrNoRows
	}
	return projects[0], nil
}

func (h Handler) loadProjects(ctx context.Context, where string, args ...any) ([]Project, error) {
	rows, err := h.DB.Query(ctx, `select `+projectColumns()+`,
		coalesce(count(i.id),0)::int as total_issues,
		coalesce(count(i.completed_at),0)::int as completed_issues
		from project p left join issue i on i.project_id=p.id
		where `+where+`
		group by p.id
		order by p.created_at desc`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := []Project{}
	for rows.Next() {
		project, err := scanProjectWithProgress(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(projects) == 0 {
		return projects, nil
	}
	teams, err := h.projectTeams(ctx, projectIDs(projects))
	if err != nil {
		return nil, err
	}
	for i := range projects {
		projects[i].Teams = teams[projects[i].ID]
	}
	return projects, nil
}

func projectColumns() string {
	return `p.id::text, p.name, p.description, p.icon, p.slug, p.status::text, p.priority::text, p.lead_id, p.workspace_id::text, p.start_date, p.target_date, p.completed_at, p.canceled_at, p.created_at, p.updated_at`
}

func scanProject(row scanner) (Project, error) {
	project, err := scanProjectBase(row, false)
	return project, err
}

func scanProjectWithProgress(row scanner) (Project, error) { return scanProjectBase(row, true) }

type scanner interface{ Scan(dest ...any) error }

func scanProjectBase(row scanner, withProgress bool) (Project, error) {
	var p Project
	var start, target, completed, canceled pgtype.Timestamp
	var created, updated time.Time
	dest := []any{&p.ID, &p.Name, &p.Description, &p.Icon, &p.Slug, &p.Status, &p.Priority, &p.LeadID, &p.WorkspaceID, &start, &target, &completed, &canceled, &created, &updated}
	var total, done int32
	if withProgress {
		dest = append(dest, &total, &done)
	}
	if err := row.Scan(dest...); err != nil {
		return Project{}, err
	}
	p.StartDate = formatTS(start)
	p.TargetDate = formatTS(target)
	p.CompletedAt = formatTS(completed)
	p.CanceledAt = formatTS(canceled)
	p.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	p.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
	p.Teams = []ProjectTeam{}
	if withProgress {
		pct := int32(0)
		if total > 0 {
			pct = int32(float64(done) / float64(total) * 100)
		}
		p.Progress = Progress{Total: total, Completed: done, Percentage: pct}
	}
	return p, nil
}

func (h Handler) projectTeams(ctx context.Context, ids []string) (map[string][]ProjectTeam, error) {
	out := map[string][]ProjectTeam{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := h.DB.Query(ctx, `select pt.project_id::text, t.id::text, t.key, t.name from project_team pt join team t on t.id=pt.team_id where pt.project_id = any($1::uuid[]) order by t.name`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var projectID string
		var team ProjectTeam
		if err := rows.Scan(&projectID, &team.ID, &team.Key, &team.Name); err != nil {
			return nil, err
		}
		out[projectID] = append(out[projectID], team)
	}
	return out, rows.Err()
}

func (h Handler) resolveTeams(ctx context.Context, workspaceID string, ids []string, keys []string) ([]ProjectTeam, error) {
	seen := map[string]bool{}
	teams := []ProjectTeam{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen["id:"+id] {
			continue
		}
		team, err := h.resolveTeam(ctx, workspaceID, `id=$2::uuid`, id)
		if err != nil {
			return nil, err
		}
		seen["id:"+id], seen[team.ID] = true, true
		teams = append(teams, team)
	}
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" || seen["key:"+key] {
			continue
		}
		team, err := h.resolveTeam(ctx, workspaceID, `key=$2`, key)
		if err != nil {
			return nil, err
		}
		if !seen[team.ID] {
			teams = append(teams, team)
			seen[team.ID] = true
		}
		seen["key:"+key] = true
	}
	return teams, nil
}

func (h Handler) resolveTeam(ctx context.Context, workspaceID, predicate, value string) (ProjectTeam, error) {
	var team ProjectTeam
	err := h.DB.QueryRow(ctx, `select id::text, key, name from team where workspace_id=$1::uuid and `+predicate+` and deleted_at is null`, workspaceID, value).Scan(&team.ID, &team.Key, &team.Name)
	return team, err
}

func replaceProjectTeams(ctx context.Context, tx pgx.Tx, projectID string, teams []ProjectTeam) error {
	if _, err := tx.Exec(ctx, `delete from project_team where project_id=$1::uuid`, projectID); err != nil {
		return err
	}
	for _, team := range teams {
		if _, err := tx.Exec(ctx, `insert into project_team (project_id, team_id) values ($1::uuid,$2::uuid) on conflict do nothing`, projectID, team.ID); err != nil {
			return err
		}
	}
	return nil
}

func uniqueSlug(ctx context.Context, tx pgx.Tx, workspaceID, base, existingID string) (string, error) {
	candidate := base
	for i := 2; ; i++ {
		var id string
		err := tx.QueryRow(ctx, `select id::text from project where workspace_id=$1::uuid and slug=$2 limit 1`, workspaceID, candidate).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) || id == existingID {
			return candidate, nil
		}
		if err != nil {
			return "", err
		}
		candidate = fmt.Sprintf("%s-%d", base, i)
	}
}

func insertOperation(ctx context.Context, tx pgx.Tx, workspaceID, entityType, entityID, opType string, payload any, createdBy string) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into operations (workspace_id, entity_type, entity_id, op_type, payload, created_by) values ($1::uuid,$2,$3::uuid,$4,$5::jsonb,$6)`, workspaceID, entityType, entityID, opType, body, createdBy)
	return err
}

var slugRe = regexp.MustCompile(`[^a-z0-9-]+`)

func sanitizeProjectSlug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = slugRe.ReplaceAllString(value, "-")
	value = strings.Trim(value, "-")
	if len(value) > 255 {
		value = strings.Trim(value[:255], "-")
	}
	return value
}
func validStatus(v string) bool {
	switch v {
	case "planned", "started", "paused", "completed", "canceled":
		return true
	default:
		return false
	}
}
func validPriority(v string) bool {
	switch v {
	case "none", "urgent", "high", "medium", "low":
		return true
	default:
		return false
	}
}
func valueOr(v *string, fallback string) string {
	if v != nil && strings.TrimSpace(*v) != "" {
		return strings.TrimSpace(*v)
	}
	return fallback
}
func nullableString(v string) *string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return &v
}
func truncatePtr(v *string, max int) *string {
	if v == nil {
		return nil
	}
	s := strings.TrimSpace(*v)
	if s == "" {
		return nil
	}
	if len(s) > max {
		s = s[:max]
	}
	return &s
}
func parseDate(v *string) (*time.Time, error) {
	if v == nil || strings.TrimSpace(*v) == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, *v)
	if err != nil {
		t2, err2 := time.Parse("2006-01-02", *v)
		if err2 != nil {
			return nil, err
		}
		t = t2
	}
	return &t, nil
}
func formatTS(ts pgtype.Timestamp) *string {
	if !ts.Valid {
		return nil
	}
	v := ts.Time.UTC().Format(time.RFC3339Nano)
	return &v
}
func projectIDs(projects []Project) []string {
	ids := make([]string, len(projects))
	for i, p := range projects {
		ids[i] = p.ID
	}
	return ids
}
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
