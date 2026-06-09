package teams

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type teamIssuesResponse struct {
	Team          teamIssuesTeam         `json:"team"`
	Groups        []teamIssueGroup       `json:"groups"`
	FilterOptions teamIssueFilterOptions `json:"filterOptions"`
}

type teamIssuesTeam struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Key  string `json:"key"`
}

type teamIssueState struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Category string  `json:"category"`
	Color    string  `json:"color"`
	Position float64 `json:"position,omitempty"`
}

type teamIssueLabel struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type teamIssueAssignee struct {
	Name  string  `json:"name"`
	Image *string `json:"image"`
}

type teamIssueItem struct {
	ID          string             `json:"id"`
	Number      int32              `json:"number"`
	Identifier  string             `json:"identifier"`
	Title       string             `json:"title"`
	Priority    string             `json:"priority"`
	StateID     string             `json:"stateId"`
	AssigneeID  *string            `json:"assigneeId"`
	Assignee    *teamIssueAssignee `json:"assignee"`
	CreatorID   *string            `json:"creatorId"`
	CreatorName *string            `json:"creatorName"`
	Labels      []teamIssueLabel   `json:"labels"`
	LabelIDs    []string           `json:"labelIds"`
	ProjectID   *string            `json:"projectId"`
	ProjectName *string            `json:"projectName"`
	CycleID     *string            `json:"cycleId"`
	CycleName   *string            `json:"cycleName"`
	Estimate    *float32           `json:"estimate"`
	DueDate     *string            `json:"dueDate"`
	CreatedAt   string             `json:"createdAt"`
	TeamID      string             `json:"teamId"`
}

type teamIssueGroup struct {
	State  teamIssueState  `json:"state"`
	Issues []teamIssueItem `json:"issues"`
}

type teamIssueOption struct {
	ID       string  `json:"id,omitempty"`
	Name     string  `json:"name,omitempty"`
	Color    string  `json:"color,omitempty"`
	Category string  `json:"category,omitempty"`
	Value    string  `json:"value,omitempty"`
	Label    string  `json:"label,omitempty"`
	Image    *string `json:"image,omitempty"`
}

type teamIssueFilterOptions struct {
	Statuses   []teamIssueOption `json:"statuses"`
	Assignees  []teamIssueOption `json:"assignees"`
	Labels     []teamIssueOption `json:"labels"`
	Projects   []teamIssueOption `json:"projects"`
	Creators   []teamIssueOption `json:"creators"`
	Cycles     []teamIssueOption `json:"cycles"`
	Estimates  []teamIssueOption `json:"estimates"`
	DueDates   []teamIssueOption `json:"dueDates"`
	Teams      []teamIssueOption `json:"teams"`
	Priorities []teamIssueOption `json:"priorities"`
}

type teamIssueRecord struct {
	ID            string
	Number        int32
	Identifier    string
	Title         string
	Priority      string
	StateID       string
	AssigneeID    *string
	AssigneeName  *string
	AssigneeImage *string
	CreatorID     *string
	ProjectID     *string
	ProjectName   *string
	CycleID       *string
	Estimate      *float32
	DueDate       *time.Time
	CreatedAt     time.Time
	SortOrder     float64
	TeamID        string
}

func (h Handler) Issues(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeamRecord(r, p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load team issues failed", err.Error())
		return
	}
	teamIDs, err := h.hierarchyTeamIDs(r.Context(), team.ID)
	if err != nil {
		problem.Write(w, 500, "Load team issues failed", err.Error())
		return
	}
	states, err := h.teamIssueStates(r.Context(), teamIDs)
	if err != nil {
		problem.Write(w, 500, "Load team issues failed", err.Error())
		return
	}
	issues, err := h.teamIssueRecords(r.Context(), teamIDs)
	if err != nil {
		problem.Write(w, 500, "Load team issues failed", err.Error())
		return
	}
	labels, err := h.teamIssueLabels(r.Context(), issueIDsForTeamIssues(issues))
	if err != nil {
		problem.Write(w, 500, "Load team issues failed", err.Error())
		return
	}
	creators, err := h.creatorNames(r.Context(), issues)
	if err != nil {
		problem.Write(w, 500, "Load team issues failed", err.Error())
		return
	}
	cycles, err := h.cycleNames(r.Context(), issues)
	if err != nil {
		problem.Write(w, 500, "Load team issues failed", err.Error())
		return
	}
	teams, err := h.teamOptions(r.Context(), teamIDs)
	if err != nil {
		problem.Write(w, 500, "Load team issues failed", err.Error())
		return
	}
	problem.JSON(w, 200, buildTeamIssuesResponse(team, states, issues, labels, creators, cycles, teams))
}

func (h Handler) hierarchyTeamIDs(ctx context.Context, rootID string) ([]string, error) {
	rows, err := h.DB.Query(ctx, `with recursive tree as (select id from team where id=$1::uuid union all select child.id from team child join tree on child.parent_team_id=tree.id where child.deleted_at is null and child.retired_at is null) select id::text from tree`, rootID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		ids = []string{rootID}
	}
	return ids, rows.Err()
}

func (h Handler) teamIssueStates(ctx context.Context, teamIDs []string) ([]teamIssueState, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,category::text,color,position from workflow_state where team_id = any($1::uuid[]) order by position asc`, teamIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	states := []teamIssueState{}
	for rows.Next() {
		var state teamIssueState
		if err := rows.Scan(&state.ID, &state.Name, &state.Category, &state.Color, &state.Position); err != nil {
			return nil, err
		}
		states = append(states, state)
	}
	return states, rows.Err()
}

func (h Handler) teamIssueRecords(ctx context.Context, teamIDs []string) ([]teamIssueRecord, error) {
	rows, err := h.DB.Query(ctx, `select i.id::text,i.number,i.identifier,i.title,i.priority::text,i.state_id::text,i.assignee_id,u.name,u.image,i.creator_id,i.project_id::text,p.name,i.cycle_id::text,i.estimate,i.due_date,i.created_at,i.sort_order,i.team_id::text from issue i left join "user" u on u.id=i.assignee_id left join project p on p.id=i.project_id where i.team_id = any($1::uuid[]) and i.archived_at is null order by i.sort_order asc, i.created_at desc`, teamIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	issues := []teamIssueRecord{}
	for rows.Next() {
		var item teamIssueRecord
		if err := rows.Scan(&item.ID, &item.Number, &item.Identifier, &item.Title, &item.Priority, &item.StateID, &item.AssigneeID, &item.AssigneeName, &item.AssigneeImage, &item.CreatorID, &item.ProjectID, &item.ProjectName, &item.CycleID, &item.Estimate, &item.DueDate, &item.CreatedAt, &item.SortOrder, &item.TeamID); err != nil {
			return nil, err
		}
		issues = append(issues, item)
	}
	return issues, rows.Err()
}

func (h Handler) teamIssueLabels(ctx context.Context, ids []string) (map[string][]teamIssueLabel, error) {
	out := map[string][]teamIssueLabel{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := h.DB.Query(ctx, `select il.issue_id::text,l.id::text,l.name,l.color from issue_label il join label l on l.id=il.label_id where il.issue_id = any($1::uuid[]) order by l.name asc`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var issueID string
		var label teamIssueLabel
		if err := rows.Scan(&issueID, &label.ID, &label.Name, &label.Color); err != nil {
			return nil, err
		}
		out[issueID] = append(out[issueID], label)
	}
	return out, rows.Err()
}

func (h Handler) creatorNames(ctx context.Context, issues []teamIssueRecord) (map[string]string, error) {
	ids := []string{}
	seen := map[string]bool{}
	for _, issue := range issues {
		if issue.CreatorID != nil && !seen[*issue.CreatorID] {
			seen[*issue.CreatorID] = true
			ids = append(ids, *issue.CreatorID)
		}
	}
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := h.DB.Query(ctx, `select id, name from "user" where id = any($1::text[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var name *string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		if name != nil {
			out[id] = *name
		}
	}
	return out, rows.Err()
}

func (h Handler) cycleNames(ctx context.Context, issues []teamIssueRecord) (map[string]string, error) {
	ids := []string{}
	seen := map[string]bool{}
	for _, issue := range issues {
		if issue.CycleID != nil && !seen[*issue.CycleID] {
			seen[*issue.CycleID] = true
			ids = append(ids, *issue.CycleID)
		}
	}
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := h.DB.Query(ctx, `select id::text, name, number from cycle where id = any($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var name *string
		var number int32
		if err := rows.Scan(&id, &name, &number); err != nil {
			return nil, err
		}
		if name != nil && *name != "" {
			out[id] = *name
		} else {
			out[id] = "Cycle " + strconv.Itoa(int(number))
		}
	}
	return out, rows.Err()
}

func (h Handler) teamOptions(ctx context.Context, teamIDs []string) ([]teamIssueOption, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name from team where id = any($1::uuid[]) order by name asc`, teamIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []teamIssueOption{}
	for rows.Next() {
		var item teamIssueOption
		if err := rows.Scan(&item.ID, &item.Name); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func issueIDsForTeamIssues(issues []teamIssueRecord) []string {
	ids := make([]string, 0, len(issues))
	for _, issue := range issues {
		ids = append(ids, issue.ID)
	}
	return ids
}

func buildTeamIssuesResponse(team teamRecordForSettings, states []teamIssueState, issues []teamIssueRecord, labels map[string][]teamIssueLabel, creators map[string]string, cycles map[string]string, teams []teamIssueOption) teamIssuesResponse {
	byState := map[string][]teamIssueItem{}
	assignees := map[string]teamIssueOption{}
	labelOptions := map[string]teamIssueOption{}
	projects := map[string]teamIssueOption{}
	creatorOptions := map[string]teamIssueOption{}
	cycleOptions := map[string]teamIssueOption{}
	estimates := map[string]bool{}
	dueDates := map[string]bool{}
	for _, issue := range issues {
		itemLabels := labels[issue.ID]
		labelIDs := []string{}
		for _, label := range itemLabels {
			labelIDs = append(labelIDs, label.ID)
			labelOptions[label.ID] = teamIssueOption{ID: label.ID, Name: label.Name, Color: label.Color}
		}
		var assignee *teamIssueAssignee
		if issue.AssigneeID != nil && issue.AssigneeName != nil {
			assignee = &teamIssueAssignee{Name: *issue.AssigneeName, Image: issue.AssigneeImage}
			assignees[*issue.AssigneeID] = teamIssueOption{ID: *issue.AssigneeID, Name: *issue.AssigneeName, Image: issue.AssigneeImage}
		}
		var creatorName *string
		if issue.CreatorID != nil {
			if name, ok := creators[*issue.CreatorID]; ok {
				creatorName = &name
				creatorOptions[*issue.CreatorID] = teamIssueOption{ID: *issue.CreatorID, Name: name}
			}
		}
		if issue.ProjectID != nil && issue.ProjectName != nil {
			projects[*issue.ProjectID] = teamIssueOption{ID: *issue.ProjectID, Name: *issue.ProjectName}
		}
		var cycleName *string
		if issue.CycleID != nil {
			if name, ok := cycles[*issue.CycleID]; ok {
				cycleName = &name
				cycleOptions[*issue.CycleID] = teamIssueOption{ID: *issue.CycleID, Name: name}
			}
		}
		var due *string
		if issue.DueDate != nil {
			value := issue.DueDate.UTC().Format("2006-01-02")
			due = &value
			dueDates[value] = true
		}
		if issue.Estimate != nil {
			estimates[formatFloat(*issue.Estimate)] = true
		}
		byState[issue.StateID] = append(byState[issue.StateID], teamIssueItem{ID: issue.ID, Number: issue.Number, Identifier: issue.Identifier, Title: issue.Title, Priority: issue.Priority, StateID: issue.StateID, AssigneeID: issue.AssigneeID, Assignee: assignee, CreatorID: issue.CreatorID, CreatorName: creatorName, Labels: itemLabels, LabelIDs: labelIDs, ProjectID: issue.ProjectID, ProjectName: issue.ProjectName, CycleID: issue.CycleID, CycleName: cycleName, Estimate: issue.Estimate, DueDate: due, CreatedAt: issue.CreatedAt.UTC().Format(time.RFC3339Nano), TeamID: issue.TeamID})
	}
	groups := []teamIssueGroup{}
	for _, state := range states {
		stateIssues := byState[state.ID]
		if stateIssues == nil {
			stateIssues = []teamIssueItem{}
		}
		groups = append(groups, teamIssueGroup{State: state, Issues: stateIssues})
	}
	return teamIssuesResponse{Team: teamIssuesTeam{ID: team.ID, Name: team.Name, Key: team.Key}, Groups: groups, FilterOptions: teamIssueFilterOptions{Statuses: stateOptions(states), Assignees: sortedOptions(assignees), Labels: sortedOptions(labelOptions), Projects: sortedOptions(projects), Creators: sortedOptions(creatorOptions), Cycles: sortedOptions(cycleOptions), Estimates: valueOptions(estimates), DueDates: valueOptions(dueDates), Teams: teams, Priorities: priorityIssueOptions()}}
}

func stateOptions(states []teamIssueState) []teamIssueOption {
	out := []teamIssueOption{}
	for _, s := range states {
		out = append(out, teamIssueOption{ID: s.ID, Name: s.Name, Category: s.Category, Color: s.Color})
	}
	return out
}
func sortedOptions(values map[string]teamIssueOption) []teamIssueOption {
	out := []teamIssueOption{}
	for _, v := range values {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
func valueOptions(values map[string]bool) []teamIssueOption {
	keys := []string{}
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := []teamIssueOption{}
	for _, key := range keys {
		out = append(out, teamIssueOption{Value: key, Label: key})
	}
	return out
}
func priorityIssueOptions() []teamIssueOption {
	return []teamIssueOption{{Value: "urgent", Label: "Urgent"}, {Value: "high", Label: "High"}, {Value: "medium", Label: "Medium"}, {Value: "low", Label: "Low"}, {Value: "none", Label: "No priority"}}
}
func formatFloat(v float32) string { return strconv.FormatFloat(float64(v), 'f', -1, 32) }
