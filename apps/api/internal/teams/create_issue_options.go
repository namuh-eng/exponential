package teams

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type issueOptionsTeam struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Key           string `json:"key"`
	CyclesEnabled bool   `json:"cyclesEnabled"`
	EstimateType  string `json:"estimateType"`
}

type optionStatus struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Category  string         `json:"category"`
	Color     string         `json:"color"`
	IsDefault *bool          `json:"isDefault"`
	Behavior  map[string]any `json:"behavior"`
}

type optionUser struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Image *string `json:"image"`
}

type optionLabel struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type optionProject struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Icon *string `json:"icon"`
}

type optionCycle struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Number    int32  `json:"number"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
}

type optionTemplate struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Settings    map[string]any `json:"settings"`
}

type relationIssue struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
}

type estimateOption struct {
	Value int32  `json:"value"`
	Label string `json:"label"`
}

type valueLabel struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type createIssueOptionsResponse struct {
	Team           issueOptionsTeam `json:"team"`
	Statuses       []optionStatus   `json:"statuses"`
	Priorities     []valueLabel     `json:"priorities"`
	Assignees      []optionUser     `json:"assignees"`
	Labels         []optionLabel    `json:"labels"`
	Projects       []optionProject  `json:"projects"`
	Cycles         []optionCycle    `json:"cycles"`
	Estimates      []estimateOption `json:"estimates"`
	Templates      []optionTemplate `json:"templates"`
	RelationIssues []relationIssue  `json:"relationIssues"`
	DueDatePresets []valueLabel     `json:"dueDatePresets"`
}

func (h Handler) CreateIssueOptions(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, settings, err := h.findIssueOptionsTeam(r.Context(), p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load create issue options failed", err.Error())
		return
	}
	if teamRetired(settings) {
		problem.Write(w, 409, "Retired teams cannot accept new issues", "")
		return
	}
	statuses, err := h.optionStatuses(r.Context(), team.ID, settings)
	if err != nil {
		problem.Write(w, 500, "Load create issue options failed", err.Error())
		return
	}
	assignees, err := h.optionAssignees(r.Context(), team.ID)
	if err != nil {
		problem.Write(w, 500, "Load create issue options failed", err.Error())
		return
	}
	if len(assignees) == 0 {
		assignees = []optionUser{{ID: p.UserID, Name: p.UserID}}
	}
	labels, err := h.optionLabels(r.Context(), p.WorkspaceID, team.ID)
	if err != nil {
		problem.Write(w, 500, "Load create issue options failed", err.Error())
		return
	}
	projects, err := h.optionProjects(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Load create issue options failed", err.Error())
		return
	}
	cycles, err := h.optionCycles(r.Context(), team.ID)
	if err != nil {
		problem.Write(w, 500, "Load create issue options failed", err.Error())
		return
	}
	templates, err := h.optionTemplates(r.Context(), p.WorkspaceID, team.ID)
	if err != nil {
		problem.Write(w, 500, "Load create issue options failed", err.Error())
		return
	}
	relations, err := h.optionRelationIssues(r.Context(), team.ID)
	if err != nil {
		problem.Write(w, 500, "Load create issue options failed", err.Error())
		return
	}
	problem.JSON(w, 200, createIssueOptionsResponse{Team: team, Statuses: statuses, Priorities: priorityOptions(), Assignees: assignees, Labels: labels, Projects: projects, Cycles: cycles, Estimates: estimateOptions(team.EstimateType), Templates: templates, RelationIssues: relations, DueDatePresets: dueDatePresets()})
}

func (h Handler) findIssueOptionsTeam(ctx context.Context, workspaceID, key string) (issueOptionsTeam, map[string]any, error) {
	var team issueOptionsTeam
	var estimateType *string
	var settingsRaw []byte
	var retiredAt *time.Time
	err := h.DB.QueryRow(ctx, `select id::text,name,key,coalesce(cycles_enabled,false),estimate_type,coalesce(settings,'{}'::jsonb),retired_at from team where workspace_id=$1::uuid and key=$2 and deleted_at is null`, workspaceID, key).Scan(&team.ID, &team.Name, &team.Key, &team.CyclesEnabled, &estimateType, &settingsRaw, &retiredAt)
	if estimateType != nil && *estimateType != "" {
		team.EstimateType = *estimateType
	} else {
		team.EstimateType = "not_in_use"
	}
	settings := map[string]any{}
	_ = json.Unmarshal(settingsRaw, &settings)
	if retiredAt != nil {
		settings["retiredAt"] = retiredAt.UTC().Format(time.RFC3339)
	}
	return team, settings, err
}

func (h Handler) optionStatuses(ctx context.Context, teamID string, settings map[string]any) ([]optionStatus, error) {
	behaviors, _ := settings["statusBehaviors"].(map[string]any)
	rows, err := h.DB.Query(ctx, `select id::text,name,category::text,color,is_default from workflow_state where team_id=$1::uuid order by position asc, name asc`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []optionStatus{}
	for rows.Next() {
		var s optionStatus
		if err := rows.Scan(&s.ID, &s.Name, &s.Category, &s.Color, &s.IsDefault); err != nil {
			return nil, err
		}
		if b, ok := behaviors[s.ID].(map[string]any); ok {
			s.Behavior = b
		} else {
			s.Behavior = map[string]any{}
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (h Handler) optionAssignees(ctx context.Context, teamID string) ([]optionUser, error) {
	rows, err := h.DB.Query(ctx, `select u.id,u.name,u.image from team_member tm join "user" u on u.id=tm.user_id where tm.team_id=$1::uuid order by u.name asc`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []optionUser{}
	for rows.Next() {
		var u optionUser
		if err := rows.Scan(&u.ID, &u.Name, &u.Image); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (h Handler) optionLabels(ctx context.Context, workspaceID, teamID string) ([]optionLabel, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,color from label where workspace_id=$1::uuid and (team_id is null or team_id=$2::uuid) and archived_at is null order by name asc`, workspaceID, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []optionLabel{}
	for rows.Next() {
		var v optionLabel
		if err := rows.Scan(&v.ID, &v.Name, &v.Color); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (h Handler) optionProjects(ctx context.Context, workspaceID string) ([]optionProject, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,icon from project where workspace_id=$1::uuid order by name asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []optionProject{}
	for rows.Next() {
		var v optionProject
		if err := rows.Scan(&v.ID, &v.Name, &v.Icon); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (h Handler) optionCycles(ctx context.Context, teamID string) ([]optionCycle, error) {
	rows, err := h.DB.Query(ctx, `select id::text, coalesce(name,''), number, start_date, end_date from cycle where team_id=$1::uuid order by start_date desc, number desc`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []optionCycle{}
	for rows.Next() {
		var v optionCycle
		var start, end time.Time
		if err := rows.Scan(&v.ID, &v.Name, &v.Number, &start, &end); err != nil {
			return nil, err
		}
		if v.Name == "" {
			v.Name = "Cycle " + strconv.Itoa(int(v.Number))
		}
		v.StartDate = start.UTC().Format(time.RFC3339)
		v.EndDate = end.UTC().Format(time.RFC3339)
		out = append(out, v)
	}
	return out, rows.Err()
}

func (h Handler) optionTemplates(ctx context.Context, workspaceID, teamID string) ([]optionTemplate, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,description,coalesce(settings,'{}'::jsonb) from issue_template where workspace_id=$1::uuid and (team_id is null or team_id=$2::uuid) and template_type='issue' order by name asc`, workspaceID, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []optionTemplate{}
	for rows.Next() {
		var v optionTemplate
		var raw []byte
		if err := rows.Scan(&v.ID, &v.Name, &v.Description, &raw); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(raw, &v.Settings)
		if _, archived := v.Settings["archivedAt"]; !archived {
			out = append(out, v)
		}
	}
	return out, rows.Err()
}

func (h Handler) optionRelationIssues(ctx context.Context, teamID string) ([]relationIssue, error) {
	rows, err := h.DB.Query(ctx, `select id::text,identifier,title from issue where team_id=$1::uuid and archived_at is null order by created_at desc`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []relationIssue{}
	for rows.Next() {
		var v relationIssue
		if err := rows.Scan(&v.ID, &v.Identifier, &v.Title); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func priorityOptions() []valueLabel {
	return []valueLabel{{"urgent", "Urgent"}, {"high", "High"}, {"medium", "Medium"}, {"low", "Low"}, {"none", "No priority"}}
}
func dueDatePresets() []valueLabel {
	return []valueLabel{{"today", "Today"}, {"tomorrow", "Tomorrow"}, {"next-week", "Next week"}, {"custom", "Custom date"}}
}
func estimateOptions(t string) []estimateOption {
	if t == "not_in_use" {
		return []estimateOption{}
	}
	return []estimateOption{{1, "1 point"}, {2, "2 points"}, {3, "3 points"}, {5, "5 points"}, {8, "8 points"}}
}
func teamRetired(settings map[string]any) bool { return false }
