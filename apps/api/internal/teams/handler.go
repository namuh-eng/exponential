package teams

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
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type Team struct {
	ID                  string  `json:"id"`
	Name                string  `json:"name"`
	Key                 string  `json:"key"`
	Icon                *string `json:"icon"`
	IsPrivate           bool    `json:"isPrivate"`
	IssueCount          int32   `json:"issueCount"`
	MemberCount         int32   `json:"memberCount"`
	CurrentUserIsMember bool    `json:"currentUserIsMember"`
	CreatedAt           string  `json:"createdAt"`
	RetiredAt           *string `json:"retiredAt"`
}

type listResponse struct {
	WorkspaceID    string `json:"workspaceId"`
	ViewerRole     string `json:"viewerRole"`
	CanManageTeams bool   `json:"canManageTeams"`
	Teams          []Team `json:"teams"`
}

type createRequest struct {
	Name      string `json:"name"`
	Key       string `json:"key"`
	IsPrivate bool   `json:"isPrivate"`
	Icon      string `json:"icon"`
}

type createResponse struct {
	Team Team `json:"team"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{key}/members", h.TeamMembers)
	r.Post("/{key}/members", h.UpdateTeamMembers)
	r.Patch("/{key}/members", h.PatchTeamMemberInvitation)
	r.Delete("/{key}/members", h.DeleteTeamMember)
	r.Get("/{key}/settings", h.GetSettings)
	r.Patch("/{key}/settings", h.UpdateSettings)
	r.Post("/{key}/settings", h.TeamLifecycleAction)
	r.Get("/{key}/templates", h.ListTemplates)
	r.Post("/{key}/templates", h.CreateTemplate)
	r.Patch("/{key}/templates", h.UpdateTemplate)
	r.Delete("/{key}/templates", h.DeleteTemplate)
	r.Get("/{key}/labels", h.ListLabels)
	r.Post("/{key}/labels", h.CreateLabel)
	r.Patch("/{key}/labels/{id}", h.UpdateLabel)
	r.Delete("/{key}/labels/{id}", h.DeleteLabel)
	r.Get("/{key}/create-issue-options", h.CreateIssueOptions)
	r.Get("/{key}/context", h.Context)
	r.Get("/{key}/analytics", h.Analytics)
	r.Get("/{key}/display-options", h.GetDisplayOptions)
	r.Put("/{key}/display-options", h.UpdateDisplayOptions)
	r.Get("/{key}/issues", h.Issues)
	r.Get("/{key}/statuses", h.ListStatuses)
	r.Post("/{key}/statuses", h.CreateStatus)
	r.Patch("/{key}/statuses", h.UpdateStatus)
	r.Delete("/{key}/statuses", h.DeleteStatus)
	r.Get("/{key}/triage", h.ListTriage)
	r.Patch("/{key}/triage/bulk", h.BulkTriage)
	r.Patch("/{key}/triage/{issueID}", h.DecideTriage)
	r.Get("/{key}/slack-notifications", h.GetSlackNotifications)
	r.Patch("/{key}/slack-notifications", h.UpdateSlackNotifications)
	r.Delete("/{key}/slack-notifications", h.DeleteSlackNotifications)
	r.Get("/{key}/recurring-issues", h.ListRecurringIssues)
	r.Post("/{key}/recurring-issues", h.CreateRecurringIssue)
	r.Patch("/{key}/recurring-issues/{id}", h.UpdateRecurringIssue)
	r.Delete("/{key}/recurring-issues/{id}", h.DeleteRecurringIssue)
	r.Get("/{key}/cycles", h.ListCycles)
	r.Post("/{key}/cycles", h.CreateCycle)
	r.Get("/{key}/cycles/{cycleID}", h.GetCycle)
	r.Patch("/{key}/cycles/{cycleID}", h.UpdateCycle)
	r.Delete("/{key}/cycles/{cycleID}", h.DeleteCycle)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	rows, err := h.DB.Query(r.Context(), `
		select t.id::text, t.name, t.key, t.icon, coalesce(t.is_private,false), coalesce(t.issue_count,0), t.created_at, t.retired_at,
		       count(tm.user_id)::int as member_count,
		       bool_or(tm.user_id = $2) as current_user_is_member
		from team t
		left join team_member tm on tm.team_id = t.id
		where t.workspace_id=$1::uuid and t.deleted_at is null and t.retired_at is null
		group by t.id, t.name, t.key, t.icon, t.is_private, t.issue_count, t.created_at, t.retired_at
		order by t.name asc, t.key asc`, p.WorkspaceID, p.UserID)
	if err != nil {
		problem.Write(w, 500, "List teams failed", err.Error())
		return
	}
	defer rows.Close()
	teams := []Team{}
	for rows.Next() {
		team, err := scanTeam(rows)
		if err != nil {
			problem.Write(w, 500, "List teams failed", err.Error())
			return
		}
		if !team.IsPrivate || team.CurrentUserIsMember || isAdmin(p.Role) {
			teams = append(teams, team)
		}
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, 500, "List teams failed", err.Error())
		return
	}
	problem.JSON(w, 200, listResponse{WorkspaceID: p.WorkspaceID, ViewerRole: p.Role, CanManageTeams: canCreateTeams(p.Role), Teams: teams})
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !canCreateTeams(p.Role) {
		problem.Write(w, 403, "You do not have permission to create teams", "")
		return
	}
	var input createRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		problem.Write(w, 400, "Team name is required", "")
		return
	}
	if len(name) > 255 {
		problem.Write(w, 400, "Team name must be 255 characters or fewer", "")
		return
	}
	key := normalizeKey(input.Key)
	if key == "" {
		var err error
		key, err = h.generatedKey(r.Context(), p.WorkspaceID, name)
		if err != nil {
			problem.Write(w, 500, "Create team failed", err.Error())
			return
		}
	}
	if err := validateKey(key); err != nil {
		problem.Write(w, 400, err.Error(), "")
		return
	}
	icon := strings.TrimSpace(input.Icon)
	if len(icon) > 16 {
		icon = icon[:16]
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create team failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	row := tx.QueryRow(r.Context(), `
		insert into team (name, key, workspace_id, icon, is_private)
		values ($1,$2,$3::uuid,$4,$5)
		returning id::text, name, key, icon, coalesce(is_private,false), coalesce(issue_count,0), created_at, retired_at, 1::int, true`, name, key, p.WorkspaceID, nullIfEmpty(icon), input.IsPrivate)
	team, err := scanTeam(row)
	if isUniqueViolation(err) {
		problem.Write(w, 409, "A team with this key already exists", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create team failed", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `insert into team_member (team_id, user_id) values ($1::uuid,$2)`, team.ID, p.UserID); err != nil {
		problem.Write(w, 500, "Create team failed", err.Error())
		return
	}
	if err := insertDefaultWorkflowStates(r.Context(), tx, team.ID); err != nil {
		problem.Write(w, 500, "Create team failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create team failed", err.Error())
		return
	}
	problem.JSON(w, 201, createResponse{Team: team})
}

type scanner interface{ Scan(dest ...any) error }

func scanTeam(row scanner) (Team, error) {
	var team Team
	var created time.Time
	var retired *time.Time
	if err := row.Scan(&team.ID, &team.Name, &team.Key, &team.Icon, &team.IsPrivate, &team.IssueCount, &created, &retired, &team.MemberCount, &team.CurrentUserIsMember); err != nil {
		return Team{}, err
	}
	team.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	if retired != nil {
		v := retired.UTC().Format(time.RFC3339Nano)
		team.RetiredAt = &v
	}
	return team, nil
}

func (h Handler) generatedKey(ctx context.Context, workspaceID, name string) (string, error) {
	base := teamKeyBase(name)
	rows, err := h.DB.Query(ctx, `select key from team where workspace_id=$1::uuid and key like $2 || '%'`, workspaceID, base)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	used := map[string]bool{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return "", err
		}
		used[key] = true
	}
	if !used[base] {
		return base, nil
	}
	for i := 2; i < 1000; i++ {
		candidate := fmt.Sprintf("%s%d", base, i)
		if len(candidate) <= 10 && !used[candidate] {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("unable to allocate team key")
}

func insertDefaultWorkflowStates(ctx context.Context, tx pgx.Tx, teamID string) error {
	states := []struct {
		Name      string
		Category  string
		Color     string
		Position  float32
		IsDefault bool
	}{
		{"Backlog", "backlog", "#bec2c8", 1000, true},
		{"Todo", "unstarted", "#bec2c8", 2000, true},
		{"In Progress", "started", "#f2c94c", 3000, true},
		{"Done", "completed", "#27ae60", 4000, true},
		{"Canceled", "canceled", "#828282", 5000, true},
	}
	for _, state := range states {
		if _, err := tx.Exec(ctx, `insert into workflow_state (team_id, name, category, color, position, is_default) values ($1::uuid,$2,$3,$4,$5,$6)`, teamID, state.Name, state.Category, state.Color, state.Position, state.IsDefault); err != nil {
			return err
		}
	}
	return nil
}

var nonKey = regexp.MustCompile(`[^A-Z0-9]+`)

func normalizeKey(value string) string { return strings.TrimSpace(strings.ToUpper(value)) }

func teamKeyBase(name string) string {
	key := nonKey.ReplaceAllString(strings.ToUpper(name), "")
	if key == "" || key[0] < 'A' || key[0] > 'Z' {
		return "WRK"
	}
	if len(key) > 3 {
		return key[:3]
	}
	for len(key) < 3 {
		key += "X"
	}
	return key
}

func validateKey(key string) error {
	if key == "" {
		return fmt.Errorf("Team key is required")
	}
	if len(key) > 10 {
		return fmt.Errorf("Team key must be 10 characters or fewer")
	}
	if key[0] < 'A' || key[0] > 'Z' || nonKey.MatchString(key) {
		return fmt.Errorf("Team key must start with a letter and only contain letters or numbers")
	}
	return nil
}

func nullIfEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func isAdmin(role string) bool        { return role == "owner" || role == "admin" }
func canCreateTeams(role string) bool { return isAdmin(role) }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
