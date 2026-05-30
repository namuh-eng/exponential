package issues

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	"github.com/namuh-eng/exponential/apps/api/internal/sanitizehtml"
	dbsqlc "github.com/namuh-eng/exponential/apps/api/internal/sqlc/generated"
	syncapi "github.com/namuh-eng/exponential/apps/api/internal/sync"
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
	TeamIDCamel        string   `json:"teamId"`
	StateID            *string  `json:"state_id"`
	StateIDCamel       *string  `json:"stateId"`
	Priority           *string  `json:"priority"`
	AssigneeID         *string  `json:"assignee_id"`
	AssigneeIDCamel    *string  `json:"assigneeId"`
	ProjectID          *string  `json:"project_id"`
	ProjectIDCamel     *string  `json:"projectId"`
	ProjectMilestoneID *string  `json:"project_milestone_id"`
	MilestoneIDCamel   *string  `json:"projectMilestoneId"`
	CycleID            *string  `json:"cycle_id"`
	CycleIDCamel       *string  `json:"cycleId"`
	ParentIssueID      *string  `json:"parent_issue_id"`
	ParentIssueIDCamel *string  `json:"parentIssueId"`
	Estimate           *float32 `json:"estimate"`
	DueDate            *string  `json:"due_date"`
	DueDateCamel       *string  `json:"dueDate"`
}

type updateRequest struct {
	Title              *string  `json:"title"`
	Description        *string  `json:"description"`
	StateID            *string  `json:"state_id"`
	StateIDCamel       *string  `json:"stateId"`
	Priority           *string  `json:"priority"`
	AssigneeID         *string  `json:"assignee_id"`
	AssigneeIDCamel    *string  `json:"assigneeId"`
	ProjectID          *string  `json:"project_id"`
	ProjectIDCamel     *string  `json:"projectId"`
	ProjectMilestoneID *string  `json:"project_milestone_id"`
	MilestoneIDCamel   *string  `json:"projectMilestoneId"`
	CycleID            *string  `json:"cycle_id"`
	CycleIDCamel       *string  `json:"cycleId"`
	ParentIssueID      *string  `json:"parent_issue_id"`
	ParentIssueIDCamel *string  `json:"parentIssueId"`
	Estimate           *float32 `json:"estimate"`
	DueDate            *string  `json:"due_date"`
	DueDateCamel       *string  `json:"dueDate"`
	SortOrder          *float32 `json:"sort_order"`
	Archive            *bool    `json:"archive"`
}

func (r *updateRequest) normalize() {
	if r.StateID == nil {
		r.StateID = r.StateIDCamel
	}
	if r.AssigneeID == nil {
		r.AssigneeID = r.AssigneeIDCamel
	}
	if r.ProjectID == nil {
		r.ProjectID = r.ProjectIDCamel
	}
	if r.ProjectMilestoneID == nil {
		r.ProjectMilestoneID = r.MilestoneIDCamel
	}
	if r.CycleID == nil {
		r.CycleID = r.CycleIDCamel
	}
	if r.ParentIssueID == nil {
		r.ParentIssueID = r.ParentIssueIDCamel
	}
	if r.DueDate == nil {
		r.DueDate = r.DueDateCamel
	}
}

func (r *createRequest) normalize() {
	if r.TeamID == "" {
		r.TeamID = r.TeamIDCamel
	}
	if r.StateID == nil {
		r.StateID = r.StateIDCamel
	}
	if r.AssigneeID == nil {
		r.AssigneeID = r.AssigneeIDCamel
	}
	if r.ProjectID == nil {
		r.ProjectID = r.ProjectIDCamel
	}
	if r.ProjectMilestoneID == nil {
		r.ProjectMilestoneID = r.MilestoneIDCamel
	}
	if r.CycleID == nil {
		r.CycleID = r.CycleIDCamel
	}
	if r.ParentIssueID == nil {
		r.ParentIssueID = r.ParentIssueIDCamel
	}
	if r.DueDate == nil {
		r.DueDate = r.DueDateCamel
	}
}

type SearchResult struct {
	ID            string  `json:"id"`
	Identifier    string  `json:"identifier"`
	Title         string  `json:"title"`
	Priority      string  `json:"priority"`
	StateName     string  `json:"stateName"`
	StateCategory string  `json:"stateCategory"`
	StateColor    string  `json:"stateColor"`
	AssigneeName  *string `json:"assigneeName"`
	AssigneeImage *string `json:"assigneeImage"`
	CreatedAt     string  `json:"createdAt"`
	TeamKey       string  `json:"teamKey,omitempty"`
	Path          string  `json:"path,omitempty"`
}

type subscriptionSummary struct {
	Subscribed   bool  `json:"subscribed"`
	WatcherCount int32 `json:"watcherCount"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Patch("/bulk", h.Bulk)
	r.Get("/search", h.Search)
	r.Get("/{id}/discussion-summary", h.GetDiscussionSummary)
	r.Post("/{id}/discussion-summary", h.GenerateDiscussionSummary)
	r.Get("/{id}/history", h.History)
	r.Post("/{id}/relations", h.CreateRelation)
	r.Delete("/{id}/relations/{relationID}", h.DeleteRelation)
	r.Get("/{id}/subscription", h.GetSubscription)
	r.Post("/{id}/subscription", h.Subscribe)
	r.Delete("/{id}/subscription", h.Unsubscribe)
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

func (h Handler) Search(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		problem.JSON(w, http.StatusOK, []SearchResult{})
		return
	}
	workspaceID := p.WorkspaceID
	requestedWorkspaceID := strings.TrimSpace(r.URL.Query().Get("workspaceId"))
	if requestedWorkspaceID != "" {
		ok, err := h.userInWorkspace(r.Context(), p.UserID, requestedWorkspaceID)
		if err != nil {
			problem.Write(w, 500, "Search issues failed", err.Error())
			return
		}
		if !ok {
			problem.JSON(w, http.StatusOK, []SearchResult{})
			return
		}
		workspaceID = requestedWorkspaceID
	}
	rows, err := h.DB.Query(r.Context(), `
		select i.id::text, i.identifier, i.title, i.priority::text, ws.name, ws.category::text, ws.color, u.name, u.image, i.created_at, t.key
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		left join "user" u on u.id=i.assignee_id
		where t.workspace_id=$1::uuid
		  and t.deleted_at is null
		  and i.archived_at is null
		  and (i.title ilike $2 or i.identifier ilike $2)
		order by i.created_at desc
		limit 10`, workspaceID, "%"+escapeLike(query)+"%")
	if err != nil {
		problem.Write(w, 500, "Search issues failed", err.Error())
		return
	}
	defer rows.Close()
	results := []SearchResult{}
	for rows.Next() {
		var result SearchResult
		var createdAt time.Time
		if err := rows.Scan(&result.ID, &result.Identifier, &result.Title, &result.Priority, &result.StateName, &result.StateCategory, &result.StateColor, &result.AssigneeName, &result.AssigneeImage, &createdAt, &result.TeamKey); err != nil {
			problem.Write(w, 500, "Search issues failed", err.Error())
			return
		}
		result.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		if result.TeamKey != "" {
			result.Path = fmt.Sprintf("/team/%s/issue/%s", url.PathEscape(result.TeamKey), url.PathEscape(result.Identifier))
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, 500, "Search issues failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, results)
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
	detail, err := h.issueDetail(r.Context(), issue, p.UserID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Get issue failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, detail)
}

func (h Handler) issueDetail(ctx context.Context, issue Issue, userID string) (map[string]any, error) {
	state, err := h.issueState(ctx, issue.StateID)
	if err != nil {
		return nil, err
	}
	team, err := h.issueTeam(ctx, issue.TeamID)
	if err != nil {
		return nil, err
	}
	creator, err := h.issueUser(ctx, issue.CreatorID)
	if err != nil {
		return nil, err
	}
	var assignee map[string]any
	if issue.AssigneeID != nil {
		assignee, err = h.issueUserWithID(ctx, *issue.AssigneeID)
		if err != nil {
			return nil, err
		}
	}
	var project map[string]any
	if issue.ProjectID != nil {
		project, err = h.issueProject(ctx, *issue.ProjectID)
		if err != nil {
			return nil, err
		}
	}
	var cycle map[string]any
	if issue.CycleID != nil {
		cycle, err = h.issueCycle(ctx, *issue.CycleID)
		if err != nil {
			return nil, err
		}
	}
	var parentIssue map[string]any
	if issue.ParentIssueID != nil {
		parentIssue, err = h.issueSummary(ctx, *issue.ParentIssueID)
		if err != nil {
			return nil, err
		}
	}
	labels, err := h.issueLabels(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	subIssues, err := h.issueSubIssues(ctx, issue.ID)
	if err != nil {
		return nil, err
	}
	subscription, err := h.subscriptionSummary(ctx, issue.ID, userID)
	if err != nil {
		return nil, err
	}
	reactions, err := h.issueReactions(ctx, issue.ID, userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":                   issue.ID,
		"number":               issue.Number,
		"identifier":           issue.Identifier,
		"title":                issue.Title,
		"description":          issue.Description,
		"priority":             issue.Priority,
		"estimate":             issue.Estimate,
		"dueDate":              issue.DueDate,
		"createdAt":            issue.CreatedAt,
		"updatedAt":            issue.UpdatedAt,
		"state":                state,
		"assignee":             assignee,
		"creator":              creator,
		"team":                 team,
		"project":              project,
		"cycle":                cycle,
		"parentIssue":          parentIssue,
		"relations":            []any{},
		"labels":               labels,
		"subscription":         subscription,
		"reactions":            reactions,
		"discussionSummary":    map[string]any{"enabled": false, "status": "disabled", "text": nil, "generatedAt": nil, "sourceCommentCount": 0},
		"comments":             []any{},
		"subIssues":            subIssues,
		"team_id":              issue.TeamID,
		"state_id":             issue.StateID,
		"assignee_id":          issue.AssigneeID,
		"creator_id":           issue.CreatorID,
		"parent_issue_id":      issue.ParentIssueID,
		"project_id":           issue.ProjectID,
		"project_milestone_id": issue.ProjectMilestoneID,
		"cycle_id":             issue.CycleID,
	}, nil
}

func (h Handler) issueReactions(ctx context.Context, issueID, userID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(ctx, `select emoji, count(*)::int, bool_or(user_id=$2) from issue_reaction where issue_id=$1::uuid group by emoji order by emoji`, issueID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	reactions := []map[string]any{}
	for rows.Next() {
		var emoji string
		var count int32
		var reactedByMe bool
		if err := rows.Scan(&emoji, &count, &reactedByMe); err != nil {
			return nil, err
		}
		reactions = append(reactions, map[string]any{"emoji": emoji, "count": count, "reacted": reactedByMe, "reactedByMe": reactedByMe})
	}
	return reactions, rows.Err()
}

func (h Handler) GetSubscription(w http.ResponseWriter, r *http.Request) {
	h.subscription(w, r, nil)
}

func (h Handler) Subscribe(w http.ResponseWriter, r *http.Request) {
	subscribed := true
	h.subscription(w, r, &subscribed)
}

func (h Handler) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	subscribed := false
	h.subscription(w, r, &subscribed)
}

func (h Handler) subscription(w http.ResponseWriter, r *http.Request, subscribed *bool) {
	p, _ := auth.FromContext(r.Context())
	issueID, err := h.resolveIssueID(r.Context(), p.WorkspaceID, chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Issue subscription failed", err.Error())
		return
	}
	if subscribed != nil {
		_, err := h.DB.Exec(r.Context(), `
			insert into issue_subscription (issue_id, user_id, subscribed, updated_at)
			values ($1::uuid,$2,$3,now())
			on conflict (issue_id, user_id)
			do update set subscribed=excluded.subscribed, updated_at=now()`, issueID, p.UserID, *subscribed)
		if err != nil {
			problem.Write(w, 500, "Issue subscription failed", err.Error())
			return
		}
	}
	summary, err := h.subscriptionSummary(r.Context(), issueID, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Issue subscription failed", err.Error())
		return
	}
	problem.JSON(w, 200, summary)
}

func (h Handler) userInWorkspace(ctx context.Context, userID, workspaceID string) (bool, error) {
	var one int
	err := h.DB.QueryRow(ctx, `select 1 from member where user_id=$1 and workspace_id=$2::uuid limit 1`, userID, workspaceID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (h Handler) resolveIssueID(ctx context.Context, workspaceID, id string) (string, error) {
	var issueID string
	where := "i.identifier=$2"
	if isUUIDLike(id) {
		where = "(i.identifier=$2 or i.id=$2::uuid)"
	}
	err := h.DB.QueryRow(ctx, `select i.id::text from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid and `+where+` limit 1`, workspaceID, id).Scan(&issueID)
	return issueID, err
}

func (h Handler) subscriptionSummary(ctx context.Context, issueID, userID string) (subscriptionSummary, error) {
	rows, err := h.DB.Query(ctx, `select user_id, subscribed from issue_subscription where issue_id=$1::uuid`, issueID)
	if err != nil {
		return subscriptionSummary{}, err
	}
	defer rows.Close()
	var summary subscriptionSummary
	for rows.Next() {
		var rowUserID string
		var subscribed bool
		if err := rows.Scan(&rowUserID, &subscribed); err != nil {
			return subscriptionSummary{}, err
		}
		if subscribed {
			summary.WatcherCount++
		}
		if rowUserID == userID {
			summary.Subscribed = subscribed
		}
	}
	return summary, rows.Err()
}

func (h Handler) issueState(ctx context.Context, stateID string) (map[string]any, error) {
	var id, name, category, color string
	err := h.DB.QueryRow(ctx, `select id::text,name,category::text,color from workflow_state where id=$1::uuid`, stateID).Scan(&id, &name, &category, &color)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "name": name, "category": category, "color": color}, nil
}

func (h Handler) issueTeam(ctx context.Context, teamID string) (map[string]any, error) {
	var id, name, key string
	err := h.DB.QueryRow(ctx, `select id::text,name,key from team where id=$1::uuid`, teamID).Scan(&id, &name, &key)
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "name": name, "key": key}, nil
}

func (h Handler) issueUser(ctx context.Context, userID string) (map[string]any, error) {
	var name string
	var image *string
	err := h.DB.QueryRow(ctx, `select name,image from "user" where id=$1`, userID).Scan(&name, &image)
	if errors.Is(err, pgx.ErrNoRows) {
		return map[string]any{"name": userID, "image": nil}, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"name": name, "image": image}, nil
}

func (h Handler) issueUserWithID(ctx context.Context, userID string) (map[string]any, error) {
	user, err := h.issueUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	user["id"] = userID
	return user, nil
}

func (h Handler) issueProject(ctx context.Context, projectID string) (map[string]any, error) {
	var id, name string
	var icon *string
	err := h.DB.QueryRow(ctx, `select id::text,name,icon from project where id=$1::uuid`, projectID).Scan(&id, &name, &icon)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "name": name, "icon": icon}, nil
}

func (h Handler) issueCycle(ctx context.Context, cycleID string) (map[string]any, error) {
	var id string
	var name *string
	var number int32
	err := h.DB.QueryRow(ctx, `select id::text,name,number from cycle where id=$1::uuid`, cycleID).Scan(&id, &name, &number)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "name": name, "number": number}, nil
}

func (h Handler) issueSummary(ctx context.Context, issueID string) (map[string]any, error) {
	var id, identifier, title string
	err := h.DB.QueryRow(ctx, `select id::text,identifier,title from issue where id=$1::uuid`, issueID).Scan(&id, &identifier, &title)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "identifier": identifier, "title": title}, nil
}

func (h Handler) issueLabels(ctx context.Context, issueID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(ctx, `select l.id::text,l.name,l.color from issue_label il join label l on l.id=il.label_id where il.issue_id=$1::uuid order by l.name`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	labels := []map[string]any{}
	for rows.Next() {
		var id, name, color string
		if err := rows.Scan(&id, &name, &color); err != nil {
			return nil, err
		}
		labels = append(labels, map[string]any{"id": id, "name": name, "color": color})
	}
	return labels, rows.Err()
}

func (h Handler) issueSubIssues(ctx context.Context, issueID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(ctx, `select i.id::text,i.identifier,i.title,i.priority::text,ws.id::text,ws.name,ws.category::text,ws.color from issue i left join workflow_state ws on ws.id=i.state_id where i.parent_issue_id=$1::uuid order by i.created_at`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	subIssues := []map[string]any{}
	for rows.Next() {
		var id, identifier, title, priority string
		var stateID, stateName, stateCategory, stateColor *string
		if err := rows.Scan(&id, &identifier, &title, &priority, &stateID, &stateName, &stateCategory, &stateColor); err != nil {
			return nil, err
		}
		var state map[string]any
		if stateID != nil {
			state = map[string]any{"id": *stateID, "name": stringPtrDefault(stateName, "Unknown"), "category": stringPtrDefault(stateCategory, "backlog"), "color": stringPtrDefault(stateColor, "#6b6f76")}
		}
		subIssues = append(subIssues, map[string]any{"id": id, "identifier": identifier, "title": title, "priority": priority, "state": state})
	}
	return subIssues, rows.Err()
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
	input.normalize()
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" || input.TeamID == "" {
		problem.Write(w, http.StatusBadRequest, "Invalid issue", "title and team_id are required")
		return
	}
	if input.Description != nil {
		description := sanitizehtml.RichText(*input.Description)
		input.Description = &description
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
		returning `+issueReturningColumns(), nextNumber, identifier, input.Title, input.Description, input.TeamID, stateID, input.AssigneeID, p.UserID, priority, input.Estimate, input.ParentIssueID, input.ProjectID, input.ProjectMilestoneID, input.CycleID, dueDate))
	if err != nil {
		problem.Write(w, 500, "Create issue failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "issue", issue.ID, "created", issue, p.UserID); err != nil {
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
	input.normalize()
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
		add("description = $%d", sanitizehtml.RichText(*input.Description))
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
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Update issue failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	args = append(args, existing.ID)
	updated, err := scanIssue(tx.QueryRow(r.Context(), `update issue set `+strings.Join(sets, ", ")+fmt.Sprintf(" where id = $%d::uuid returning ", len(args))+issueReturningColumns(), args...))
	if err != nil {
		problem.Write(w, 500, "Update issue failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "issue", updated.ID, "updated", updated, p.UserID); err != nil {
		problem.Write(w, 500, "Update issue failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
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
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Delete issue failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	_, err = tx.Exec(r.Context(), `delete from issue where id=$1::uuid`, existing.ID)
	if err != nil {
		problem.Write(w, 500, "Delete issue failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "issue", existing.ID, "deleted", existing, p.UserID); err != nil {
		problem.Write(w, 500, "Delete issue failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Delete issue failed", err.Error())
		return
	}
	body := map[string]bool{"success": true}
	h.storeIdempotency(r, p, http.StatusOK, body)
	problem.JSON(w, http.StatusOK, body)
}

func (h Handler) findIssue(ctx context.Context, id string, workspaceID string) (Issue, error) {
	workspaceUUID, err := uuidParam(workspaceID)
	if err != nil {
		return Issue{}, err
	}
	queries := dbsqlc.New(h.DB)
	if strings.Count(id, "-") == 4 && len(id) >= 32 {
		issueUUID, err := uuidParam(id)
		if err != nil {
			return Issue{}, err
		}
		row, err := queries.GetIssueByID(ctx, dbsqlc.GetIssueByIDParams{WorkspaceID: workspaceUUID, ID: issueUUID})
		if err != nil {
			return Issue{}, err
		}
		return issueFromSQLCByID(row), nil
	}
	row, err := queries.GetIssueByIdentifier(ctx, dbsqlc.GetIssueByIdentifierParams{WorkspaceID: workspaceUUID, Identifier: id})
	if err != nil {
		return Issue{}, err
	}
	return issueFromSQLCByIdentifier(row), nil
}

func uuidParam(value string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(value); err != nil {
		return pgtype.UUID{}, err
	}
	return id, nil
}

func textPtr(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func uuidPtr(value pgtype.UUID) *string {
	if !value.Valid {
		return nil
	}
	text := value.String()
	return &text
}

func uuidString(value pgtype.UUID) string {
	if !value.Valid {
		return ""
	}
	return value.String()
}

func float4Ptr(value pgtype.Float4) *float32 {
	if !value.Valid {
		return nil
	}
	return &value.Float32
}

func issueFromSQLCByID(row dbsqlc.GetIssueByIDRow) Issue {
	return Issue{
		ID:                 uuidString(row.ID),
		Number:             row.Number,
		Identifier:         row.Identifier,
		Title:              row.Title,
		Description:        textPtr(row.Description),
		TeamID:             uuidString(row.TeamID),
		StateID:            uuidString(row.StateID),
		AssigneeID:         textPtr(row.AssigneeID),
		CreatorID:          row.CreatorID,
		Priority:           row.Priority,
		Estimate:           float4Ptr(row.Estimate),
		ParentIssueID:      uuidPtr(row.ParentIssueID),
		ProjectID:          uuidPtr(row.ProjectID),
		ProjectMilestoneID: uuidPtr(row.ProjectMilestoneID),
		CycleID:            uuidPtr(row.CycleID),
		DueDate:            formatTS(row.DueDate),
		SortOrder:          row.SortOrder,
		CreatedAt:          *formatTS(row.CreatedAt),
		UpdatedAt:          *formatTS(row.UpdatedAt),
		ArchivedAt:         formatTS(row.ArchivedAt),
		CanceledAt:         formatTS(row.CanceledAt),
		CompletedAt:        formatTS(row.CompletedAt),
	}
}

func issueFromSQLCByIdentifier(row dbsqlc.GetIssueByIdentifierRow) Issue {
	return Issue{
		ID:                 uuidString(row.ID),
		Number:             row.Number,
		Identifier:         row.Identifier,
		Title:              row.Title,
		Description:        textPtr(row.Description),
		TeamID:             uuidString(row.TeamID),
		StateID:            uuidString(row.StateID),
		AssigneeID:         textPtr(row.AssigneeID),
		CreatorID:          row.CreatorID,
		Priority:           row.Priority,
		Estimate:           float4Ptr(row.Estimate),
		ParentIssueID:      uuidPtr(row.ParentIssueID),
		ProjectID:          uuidPtr(row.ProjectID),
		ProjectMilestoneID: uuidPtr(row.ProjectMilestoneID),
		CycleID:            uuidPtr(row.CycleID),
		DueDate:            formatTS(row.DueDate),
		SortOrder:          row.SortOrder,
		CreatedAt:          *formatTS(row.CreatedAt),
		UpdatedAt:          *formatTS(row.UpdatedAt),
		ArchivedAt:         formatTS(row.ArchivedAt),
		CanceledAt:         formatTS(row.CanceledAt),
		CompletedAt:        formatTS(row.CompletedAt),
	}
}

func issueColumns() string {
	return issueColumnsWithPrefix("i.")
}

func issueReturningColumns() string {
	return issueColumnsWithPrefix("")
}

func issueColumnsWithPrefix(prefix string) string {
	return prefix + `id::text, ` + prefix + `number, ` + prefix + `identifier, ` + prefix + `title, ` + prefix + `description, ` + prefix + `team_id::text, ` + prefix + `state_id::text, ` + prefix + `assignee_id, ` + prefix + `creator_id, ` + prefix + `priority::text, ` + prefix + `estimate, ` + prefix + `parent_issue_id::text, ` + prefix + `project_id::text, ` + prefix + `project_milestone_id::text, ` + prefix + `cycle_id::text, ` + prefix + `due_date, ` + prefix + `sort_order, ` + prefix + `created_at, ` + prefix + `updated_at, ` + prefix + `archived_at, ` + prefix + `canceled_at, ` + prefix + `completed_at`
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
func stringPtrDefault(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}
func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}
func isUUIDLike(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, r := range value {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
				return false
			}
		}
	}
	return true
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

func insertOperation(ctx context.Context, exec syncapi.OperationStore, workspaceID, entityType, entityID, opType string, payload any, userID string) error {
	return syncapi.InsertOperation(ctx, exec, workspaceID, entityType, entityID, opType, payload, userID)
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
