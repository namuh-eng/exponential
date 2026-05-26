package myissues

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type Team struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Key  string `json:"key"`
}

type State struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"`
	Color    string `json:"color"`
	Position int    `json:"position"`
}

type Label struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type Assignee struct {
	ID    string  `json:"id,omitempty"`
	Name  string  `json:"name"`
	Image *string `json:"image"`
}

type IssueEntry struct {
	ID          string    `json:"id"`
	Number      int       `json:"number"`
	Identifier  string    `json:"identifier"`
	Title       string    `json:"title"`
	Priority    string    `json:"priority"`
	StateID     string    `json:"stateId"`
	AssigneeID  *string   `json:"assigneeId"`
	Assignee    *Assignee `json:"assignee"`
	Labels      []Label   `json:"labels"`
	LabelIDs    []string  `json:"labelIds"`
	ProjectID   *string   `json:"projectId"`
	ProjectName *string   `json:"projectName"`
	DueDate     *string   `json:"dueDate"`
	CreatedAt   string    `json:"createdAt"`
	UpdatedAt   string    `json:"updatedAt"`
	DisplayAt   string    `json:"displayAt"`
	TeamKey     string    `json:"teamKey"`
}

type Group struct {
	State  State        `json:"state"`
	Issues []IssueEntry `json:"issues"`
}

type Option struct {
	Value string  `json:"value,omitempty"`
	ID    string  `json:"id,omitempty"`
	Label string  `json:"label,omitempty"`
	Name  string  `json:"name,omitempty"`
	Color string  `json:"color,omitempty"`
	Image *string `json:"image,omitempty"`
}

type FilterOptions struct {
	Statuses   []Option `json:"statuses"`
	Assignees  []Option `json:"assignees"`
	Labels     []Option `json:"labels"`
	Priorities []Option `json:"priorities"`
}

type Response struct {
	Groups        []Group       `json:"groups"`
	TotalCount    int           `json:"totalCount,omitempty"`
	FilterOptions FilterOptions `json:"filterOptions"`
}

type issueRecord struct {
	ID            string
	Number        int
	Identifier    string
	Title         string
	Priority      string
	StateID       string
	AssigneeID    *string
	AssigneeName  *string
	AssigneeImage *string
	ProjectID     *string
	ProjectName   *string
	DueDate       *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
	SortOrder     float64
	TeamID        string
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.Get)
	return r
}

func (h Handler) Get(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	tab := r.URL.Query().Get("tab")
	if tab == "" {
		tab = "assigned"
	}
	teams, err := h.teams(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Load my issues failed", err.Error())
		return
	}
	teamIDs := make([]string, 0, len(teams))
	teamByID := map[string]Team{}
	for _, team := range teams {
		teamIDs = append(teamIDs, team.ID)
		teamByID[team.ID] = team
	}
	if len(teamIDs) == 0 {
		problem.JSON(w, 200, Response{Groups: []Group{}, FilterOptions: emptyFilterOptions()})
		return
	}
	states, err := h.states(r.Context(), teamIDs)
	if err != nil {
		problem.Write(w, 500, "Load my issues failed", err.Error())
		return
	}
	issues, err := h.issuesForTab(r.Context(), tab, p.UserID, teamIDs)
	if err != nil {
		problem.Write(w, 500, "Load my issues failed", err.Error())
		return
	}
	labels, err := h.labelsByIssue(r.Context(), issueIDs(issues))
	if err != nil {
		problem.Write(w, 500, "Load my issues failed", err.Error())
		return
	}
	problem.JSON(w, 200, buildResponse(tab, issues, states, teamByID, labels))
}

func (h Handler) teams(ctx context.Context, workspaceID string) ([]Team, error) {
	rows, err := h.DB.Query(ctx, `select id::text, name, key from team where workspace_id=$1::uuid`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Team{}
	for rows.Next() {
		var item Team
		if err := rows.Scan(&item.ID, &item.Name, &item.Key); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (h Handler) states(ctx context.Context, teamIDs []string) ([]State, error) {
	rows, err := h.DB.Query(ctx, `select id::text, name, category, color, position from workflow_state where team_id = any($1::uuid[]) order by position asc`, teamIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []State{}
	for rows.Next() {
		var item State
		if err := rows.Scan(&item.ID, &item.Name, &item.Category, &item.Color, &item.Position); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (h Handler) issuesForTab(ctx context.Context, tab, userID string, teamIDs []string) ([]issueRecord, error) {
	switch tab {
	case "assigned":
		return h.fetchIssues(ctx, `i.assignee_id=$1`, userID, teamIDs, `i.sort_order asc, i.created_at desc`)
	case "created":
		return h.fetchIssues(ctx, `i.creator_id=$1`, userID, teamIDs, `i.created_at desc`)
	case "subscribed":
		return h.subscribedIssues(ctx, userID, teamIDs, true)
	default:
		return h.subscribedIssues(ctx, userID, teamIDs, false)
	}
}

func (h Handler) subscribedIssues(ctx context.Context, userID string, teamIDs []string, explicit bool) ([]issueRecord, error) {
	all := []issueRecord{}
	for _, query := range []string{`i.assignee_id=$1`, `i.creator_id=$1`} {
		items, err := h.fetchIssues(ctx, query, userID, teamIDs, `i.updated_at desc`)
		if err != nil {
			return nil, err
		}
		all = append(all, items...)
	}
	commented, err := h.fetchCommenterIssues(ctx, userID, teamIDs)
	if err != nil {
		return nil, err
	}
	all = append(all, commented...)
	if explicit {
		explicitItems, err := h.fetchExplicitSubscriptions(ctx, userID, teamIDs)
		if err != nil {
			return nil, err
		}
		all = append(all, explicitItems...)
	}
	return sortIssuesByUpdatedAtDesc(dedupeIssuesByID(all)), nil
}

func (h Handler) fetchIssues(ctx context.Context, predicate, userID string, teamIDs []string, order string) ([]issueRecord, error) {
	return h.scanIssues(ctx, `
		select i.id::text, i.number, i.identifier, i.title, i.priority::text, i.state_id::text, i.assignee_id, u.name, u.image,
		       i.project_id::text, p.name, i.due_date, i.created_at, i.updated_at, i.sort_order, i.team_id::text
		from issue i left join "user" u on u.id=i.assignee_id left join project p on p.id=i.project_id
		where i.team_id = any($2::uuid[]) and `+predicate+` and i.archived_at is null order by `+order, userID, teamIDs)
}

func (h Handler) fetchCommenterIssues(ctx context.Context, userID string, teamIDs []string) ([]issueRecord, error) {
	return h.scanIssues(ctx, `
		select i.id::text, i.number, i.identifier, i.title, i.priority::text, i.state_id::text, i.assignee_id, u.name, u.image,
		       i.project_id::text, p.name, i.due_date, i.created_at, i.updated_at, i.sort_order, i.team_id::text
		from comment c join issue i on i.id=c.issue_id left join "user" u on u.id=i.assignee_id left join project p on p.id=i.project_id
		where c.user_id=$1 and i.team_id = any($2::uuid[]) and i.archived_at is null order by i.updated_at desc`, userID, teamIDs)
}

func (h Handler) fetchExplicitSubscriptions(ctx context.Context, userID string, teamIDs []string) ([]issueRecord, error) {
	return h.scanIssues(ctx, `
		select i.id::text, i.number, i.identifier, i.title, i.priority::text, i.state_id::text, i.assignee_id, u.name, u.image,
		       i.project_id::text, p.name, i.due_date, i.created_at, i.updated_at, i.sort_order, i.team_id::text
		from issue_subscription s join issue i on i.id=s.issue_id left join "user" u on u.id=i.assignee_id left join project p on p.id=i.project_id
		where s.user_id=$1 and s.subscribed=true and i.team_id = any($2::uuid[]) and i.archived_at is null order by i.updated_at desc`, userID, teamIDs)
}

func (h Handler) scanIssues(ctx context.Context, sql string, args ...any) ([]issueRecord, error) {
	rows, err := h.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []issueRecord{}
	for rows.Next() {
		var item issueRecord
		if err := rows.Scan(&item.ID, &item.Number, &item.Identifier, &item.Title, &item.Priority, &item.StateID, &item.AssigneeID, &item.AssigneeName, &item.AssigneeImage, &item.ProjectID, &item.ProjectName, &item.DueDate, &item.CreatedAt, &item.UpdatedAt, &item.SortOrder, &item.TeamID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (h Handler) labelsByIssue(ctx context.Context, ids []string) (map[string][]Label, error) {
	if len(ids) == 0 {
		return map[string][]Label{}, nil
	}
	rows, err := h.DB.Query(ctx, `select il.issue_id::text, l.id::text, l.name, l.color from issue_label il join label l on l.id=il.label_id where il.issue_id = any($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string][]Label{}
	for rows.Next() {
		var issueID string
		var label Label
		if err := rows.Scan(&issueID, &label.ID, &label.Name, &label.Color); err != nil {
			return nil, err
		}
		result[issueID] = append(result[issueID], label)
	}
	return result, rows.Err()
}

func buildResponse(tab string, issues []issueRecord, states []State, teamByID map[string]Team, labels map[string][]Label) Response {
	stateByID := map[string]State{}
	for _, state := range states {
		stateByID[state.ID] = state
	}
	groupsByKey := map[string]*Group{}
	for _, issue := range issues {
		state, ok := stateByID[issue.StateID]
		if !ok {
			continue
		}
		groupKey := state.Category + ":" + state.Name
		group, ok := groupsByKey[groupKey]
		if !ok {
			state.ID = groupKey
			group = &Group{State: state, Issues: []IssueEntry{}}
			groupsByKey[groupKey] = group
		}
		group.Issues = append(group.Issues, issueEntry(tab, issue, groupKey, teamByID, labels[issue.ID]))
	}
	groups := make([]Group, 0, len(groupsByKey))
	for _, group := range groupsByKey {
		groups = append(groups, *group)
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].State.Position < groups[j].State.Position })
	return Response{Groups: groups, TotalCount: len(issues), FilterOptions: filterOptions(issues, groups, labels)}
}

func issueEntry(tab string, issue issueRecord, stateID string, teamByID map[string]Team, labels []Label) IssueEntry {
	labelIDs := []string{}
	for _, label := range labels {
		labelIDs = append(labelIDs, label.Name)
	}
	var assignee *Assignee
	if issue.AssigneeName != nil {
		assignee = &Assignee{Name: *issue.AssigneeName, Image: issue.AssigneeImage}
	}
	display := issue.CreatedAt
	if tab == "activity" {
		display = issue.UpdatedAt
	}
	var due *string
	if issue.DueDate != nil {
		formatted := issue.DueDate.UTC().Format(time.RFC3339)
		due = &formatted
	}
	return IssueEntry{ID: issue.ID, Number: issue.Number, Identifier: issue.Identifier, Title: issue.Title, Priority: issue.Priority, StateID: stateID, AssigneeID: issue.AssigneeID, Assignee: assignee, Labels: labels, LabelIDs: labelIDs, ProjectID: issue.ProjectID, ProjectName: issue.ProjectName, DueDate: due, CreatedAt: issue.CreatedAt.UTC().Format(time.RFC3339), UpdatedAt: issue.UpdatedAt.UTC().Format(time.RFC3339), DisplayAt: display.UTC().Format(time.RFC3339), TeamKey: teamByID[issue.TeamID].Key}
}

func issueIDs(issues []issueRecord) []string {
	ids := make([]string, 0, len(issues))
	seen := map[string]bool{}
	for _, issue := range issues {
		if !seen[issue.ID] {
			seen[issue.ID] = true
			ids = append(ids, issue.ID)
		}
	}
	return ids
}

func dedupeIssuesByID(issues []issueRecord) []issueRecord {
	latest := map[string]issueRecord{}
	for _, issue := range issues {
		if current, ok := latest[issue.ID]; !ok || current.UpdatedAt.Before(issue.UpdatedAt) {
			latest[issue.ID] = issue
		}
	}
	result := make([]issueRecord, 0, len(latest))
	for _, issue := range latest {
		result = append(result, issue)
	}
	return result
}

func sortIssuesByUpdatedAtDesc(issues []issueRecord) []issueRecord {
	sort.Slice(issues, func(i, j int) bool { return issues[i].UpdatedAt.After(issues[j].UpdatedAt) })
	return issues
}

func filterOptions(issues []issueRecord, groups []Group, labels map[string][]Label) FilterOptions {
	options := emptyFilterOptions()
	for _, group := range groups {
		options.Statuses = append(options.Statuses, Option{ID: group.State.ID, Name: group.State.Name, Color: group.State.Color})
	}
	seenAssignees := map[string]bool{}
	for _, issue := range issues {
		if issue.AssigneeID != nil && issue.AssigneeName != nil && !seenAssignees[*issue.AssigneeID] {
			seenAssignees[*issue.AssigneeID] = true
			options.Assignees = append(options.Assignees, Option{ID: *issue.AssigneeID, Name: *issue.AssigneeName, Image: issue.AssigneeImage})
		}
	}
	seenLabels := map[string]bool{}
	for _, list := range labels {
		for _, label := range list {
			if !seenLabels[label.Name] {
				seenLabels[label.Name] = true
				options.Labels = append(options.Labels, Option{ID: label.Name, Name: label.Name, Color: label.Color})
			}
		}
	}
	return options
}

func emptyFilterOptions() FilterOptions {
	return FilterOptions{Statuses: []Option{}, Assignees: []Option{}, Labels: []Option{}, Priorities: []Option{{Value: "urgent", Label: "Urgent"}, {Value: "high", Label: "High"}, {Value: "medium", Label: "Medium"}, {Value: "low", Label: "Low"}, {Value: "none", Label: "No priority"}}}
}
