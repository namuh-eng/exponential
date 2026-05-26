package teams

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

var triageAcceptCategories = map[string]bool{"backlog": true, "unstarted": true, "started": true, "completed": true}
var triagePriorities = map[string]bool{"none": true, "urgent": true, "high": true, "medium": true, "low": true}

type triageTeam struct {
	ID            string
	Name          string
	Key           string
	WorkspaceID   string
	Settings      map[string]any
	TriageEnabled bool
}

type triageDecisionRequest struct {
	Action             string   `json:"action"`
	DestinationStateID *string  `json:"destinationStateId"`
	Confirmed          bool     `json:"confirmed"`
	Reason             *string  `json:"reason"`
	Priority           *string  `json:"priority"`
	Estimate           *float32 `json:"estimate"`
	LabelIDs           []string `json:"labelIds"`
	CycleID            *string  `json:"cycleId"`
	ProjectID          *string  `json:"projectId"`
	ProjectMilestoneID *string  `json:"projectMilestoneId"`
	AssigneeID         *string  `json:"assigneeId"`
	Comment            *string  `json:"comment"`
	Subscribe          *bool    `json:"subscribe"`
	IssueIDs           []string `json:"issueIds"`
}

type triageDestinationState struct{ ID, Name, Category string }
type triageIssueStateRecord struct{ ID, StateID, Category string }

func (h Handler) ListTriage(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.loadTriageTeam(w, r, p.WorkspaceID, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	if !team.TriageEnabled {
		problem.JSON(w, 200, map[string]any{"team": teamSummaryJSON(team), "issues": []any{}, "count": 0, "createStateId": nil, "createStateName": nil, "triageEnabled": false})
		return
	}
	states, err := h.triageStates(r, team.ID)
	if err != nil {
		problem.Write(w, 500, "Load triage failed", err.Error())
		return
	}
	if len(states) == 0 {
		problem.JSON(w, 200, map[string]any{"team": teamSummaryJSON(team), "issues": []any{}, "count": 0, "createStateId": nil, "createStateName": nil, "triageEnabled": true})
		return
	}
	issues, err := h.triageIssues(r, team.ID)
	if err != nil {
		problem.Write(w, 500, "Load triage failed", err.Error())
		return
	}
	accept, decline, err := h.triageDecisionStates(r, team.ID, team.Settings)
	if err != nil {
		problem.Write(w, 500, "Load triage failed", err.Error())
		return
	}
	options, err := h.triageMetadataOptions(r, team)
	if err != nil {
		problem.Write(w, 500, "Load triage failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"team": teamSummaryJSON(team), "issues": issues, "count": len(issues), "createStateId": states[0]["id"], "createStateName": states[0]["name"], "triageEnabled": true, "acceptDestinationStates": accept, "declineDestinationStates": decline, "metadataOptions": options})
}

func (h Handler) DecideTriage(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.loadTriageTeam(w, r, p.WorkspaceID, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	var input triageDecisionRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	result, status := h.applyTriageDecision(w, r, team, p.UserID, chi.URLParam(r, "issueID"), input)
	if status != 0 {
		problem.JSON(w, status, result)
	}
}

func (h Handler) BulkTriage(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.loadTriageTeam(w, r, p.WorkspaceID, chi.URLParam(r, "key"))
	if !ok {
		return
	}
	var input triageDecisionRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	if len(input.IssueIDs) == 0 {
		problem.Write(w, 400, "Select at least one issue", "")
		return
	}
	if len(input.IssueIDs) > 100 {
		problem.Write(w, 400, "Bulk triage decisions are limited to 100 issues", "")
		return
	}
	results := []map[string]any{}
	updated := 0
	for _, issueID := range input.IssueIDs {
		result, status := h.applyTriageDecision(w, r, team, p.UserID, issueID, input)
		if status >= 200 && status < 300 {
			updated++
			results = append(results, map[string]any{"issueId": issueID, "status": "updated"})
		} else {
			results = append(results, map[string]any{"issueId": issueID, "status": "conflict", "error": result["error"]})
		}
	}
	status := 200
	if updated != len(input.IssueIDs) {
		status = 207
	}
	problem.JSON(w, status, map[string]any{"updatedCount": updated, "conflictCount": len(input.IssueIDs) - updated, "results": results, "decision": map[string]any{"action": input.Action, "reason": stringPtrTrim(input.Reason)}})
}

func (h Handler) applyTriageDecision(w http.ResponseWriter, r *http.Request, team triageTeam, userID, issueID string, input triageDecisionRequest) (map[string]any, int) {
	if input.Action != "accept" && input.Action != "decline" {
		return map[string]any{"error": "Invalid action"}, 400
	}
	if !input.Confirmed {
		return map[string]any{"error": "Decision confirmation is required"}, 400
	}
	destinationID := stringPtrTrim(input.DestinationStateID)
	if destinationID == "" {
		destinationID = defaultTriageDestination(team.Settings, input.Action)
	}
	if destinationID == "" {
		return map[string]any{"error": "Destination status is required"}, 400
	}
	dest, err := h.triageDestination(r, team.ID, destinationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return map[string]any{"error": "Destination status not found for this team"}, 400
	}
	if err != nil {
		problem.Write(w, 500, "Triage decision failed", err.Error())
		return nil, 0
	}
	if (input.Action == "accept" && !triageAcceptCategories[dest.Category]) || (input.Action == "decline" && dest.Category != "canceled") {
		return map[string]any{"error": "Destination status is not allowed for this triage decision"}, 400
	}
	current, err := h.triageIssueState(r, team.ID, issueID)
	if errors.Is(err, pgx.ErrNoRows) {
		return map[string]any{"error": "Issue not found"}, 404
	}
	if err != nil {
		problem.Write(w, 500, "Triage decision failed", err.Error())
		return nil, 0
	}
	if current.Category != "triage" {
		return map[string]any{"error": "Issue is not currently in triage"}, 409
	}
	priority := any(nil)
	if input.Priority != nil {
		value := stringPtrTrim(input.Priority)
		if !triagePriorities[value] {
			return map[string]any{"error": "Invalid priority"}, 400
		}
		priority = value
	}
	estimate := any(nil)
	if input.Estimate != nil {
		estimate = *input.Estimate
	}
	canceledAt := any(nil)
	if input.Action == "decline" {
		canceledAt = time.Now()
	}
	completedAt := any(nil)
	if dest.Category == "completed" {
		completedAt = time.Now()
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Triage decision failed", err.Error())
		return nil, 0
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err := tx.Exec(r.Context(), `update issue set state_id=$1::uuid, updated_at=now(), canceled_at=$2, completed_at=$3, priority=coalesce($4,priority), estimate=coalesce($5,estimate), assignee_id=$6, project_id=$7::uuid, project_milestone_id=$8::uuid, cycle_id=$9::uuid where id=$10::uuid and team_id=$11::uuid and state_id=$12::uuid`, dest.ID, canceledAt, completedAt, priority, estimate, nullableTrim(input.AssigneeID), nullableTrim(input.ProjectID), nullableTrim(input.ProjectMilestoneID), nullableTrim(input.CycleID), issueID, team.ID, current.StateID); err != nil {
		problem.Write(w, 500, "Triage decision failed", err.Error())
		return nil, 0
	}
	if input.Action == "accept" && input.LabelIDs != nil {
		if _, err := tx.Exec(r.Context(), `delete from issue_label where issue_id=$1::uuid`, issueID); err != nil {
			problem.Write(w, 500, "Triage decision failed", err.Error())
			return nil, 0
		}
		for _, labelID := range input.LabelIDs {
			if _, err := tx.Exec(r.Context(), `insert into issue_label (issue_id,label_id) values ($1::uuid,$2::uuid) on conflict do nothing`, issueID, labelID); err != nil {
				problem.Write(w, 500, "Triage decision failed", err.Error())
				return nil, 0
			}
		}
	}
	if input.Action == "accept" && stringPtrTrim(input.Comment) != "" {
		if _, err := tx.Exec(r.Context(), `insert into comment (body,issue_id,user_id) values ($1,$2::uuid,$3)`, stringPtrTrim(input.Comment), issueID, userID); err != nil {
			problem.Write(w, 500, "Triage decision failed", err.Error())
			return nil, 0
		}
	}
	if input.Action == "accept" && input.Subscribe != nil {
		if _, err := tx.Exec(r.Context(), `insert into issue_subscription (issue_id,user_id,subscribed,updated_at) values ($1::uuid,$2,$3,now()) on conflict (issue_id,user_id) do update set subscribed=$3, updated_at=now()`, issueID, userID, *input.Subscribe); err != nil {
			problem.Write(w, 500, "Triage decision failed", err.Error())
			return nil, 0
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Triage decision failed", err.Error())
		return nil, 0
	}
	return map[string]any{"issue": map[string]any{"id": issueID}, "decision": map[string]any{"action": input.Action, "destinationState": map[string]any{"id": dest.ID, "name": dest.Name, "category": dest.Category}, "reason": stringPtrTrim(input.Reason)}}, 200
}

func (h Handler) loadTriageTeam(w http.ResponseWriter, r *http.Request, workspaceID, key string) (triageTeam, bool) {
	var team triageTeam
	var raw []byte
	err := h.DB.QueryRow(r.Context(), `select id::text,name,key,workspace_id::text,coalesce(settings,'{}'::jsonb),coalesce(triage_enabled,true) from team where workspace_id=$1::uuid and key=$2 and deleted_at is null limit 1`, workspaceID, key).Scan(&team.ID, &team.Name, &team.Key, &team.WorkspaceID, &raw, &team.TriageEnabled)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return team, false
	}
	if err != nil {
		problem.Write(w, 500, "Load triage failed", err.Error())
		return team, false
	}
	team.Settings = map[string]any{}
	_ = json.Unmarshal(raw, &team.Settings)
	return team, true
}

func (h Handler) triageStates(r *http.Request, teamID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `select id::text,name,color from workflow_state where team_id=$1::uuid and category='triage'`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, color string
		if err := rows.Scan(&id, &name, &color); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "name": name, "color": color})
	}
	return out, rows.Err()
}

func (h Handler) triageIssues(r *http.Request, teamID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `select i.id::text,i.identifier,i.title,i.description,i.priority::text,i.state_id::text,ws.name,ws.color,i.creator_id,coalesce(u.name,'Unknown'),u.image,i.created_at,i.updated_at,i.assignee_id,i.project_id::text,p.name,i.project_milestone_id::text,i.cycle_id::text,i.due_date,i.estimate,i.team_id::text from issue i join workflow_state ws on ws.id=i.state_id left join "user" u on u.id=i.creator_id left join project p on p.id=i.project_id where i.team_id=$1::uuid and ws.category='triage' order by i.created_at desc`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, identifier, title, priority, stateID, stateName, stateColor, creatorID, creatorName, teamID string
		var description, creatorImage, assigneeID, projectID, projectName, milestoneID, cycleID, dueDate *string
		var estimate *float32
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &identifier, &title, &description, &priority, &stateID, &stateName, &stateColor, &creatorID, &creatorName, &creatorImage, &createdAt, &updatedAt, &assigneeID, &projectID, &projectName, &milestoneID, &cycleID, &dueDate, &estimate, &teamID); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "identifier": identifier, "title": title, "description": description, "priority": priority, "stateId": stateID, "stateName": stateName, "stateColor": stateColor, "creatorId": creatorID, "creatorName": creatorName, "creatorImage": creatorImage, "createdAt": createdAt.UTC().Format(time.RFC3339), "updatedAt": updatedAt.UTC().Format(time.RFC3339), "labelIds": []string{}, "labels": []any{}, "assigneeId": assigneeID, "projectId": projectID, "projectName": projectName, "projectMilestoneId": milestoneID, "cycleId": cycleID, "dueDate": dueDate, "estimate": estimate, "teamId": teamID})
	}
	return out, rows.Err()
}

func (h Handler) triageDecisionStates(r *http.Request, teamID string, settings map[string]any) ([]map[string]any, []map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `select id::text,name,category::text,color,position,is_default from workflow_state where team_id=$1::uuid order by position asc,name asc`, teamID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	accept := []map[string]any{}
	decline := []map[string]any{}
	acceptID := defaultTriageDestination(settings, "accept")
	declineID := defaultTriageDestination(settings, "decline")
	for rows.Next() {
		var id, name, category, color string
		var pos int32
		var isDefault *bool
		if err := rows.Scan(&id, &name, &category, &color, &pos, &isDefault); err != nil {
			return nil, nil, err
		}
		item := map[string]any{"id": id, "name": name, "category": category, "color": color, "position": pos, "isDefault": (id == acceptID || id == declineID || (isDefault != nil && *isDefault))}
		if triageAcceptCategories[category] {
			accept = append(accept, item)
		}
		if category == "canceled" {
			decline = append(decline, item)
		}
	}
	return accept, decline, rows.Err()
}

func (h Handler) triageMetadataOptions(r *http.Request, team triageTeam) (map[string]any, error) {
	return map[string]any{"labels": []any{}, "cycles": []any{}, "projects": []any{}, "projectMilestones": []any{}, "members": []any{}}, nil
}
func (h Handler) triageDestination(r *http.Request, teamID, id string) (triageDestinationState, error) {
	var s triageDestinationState
	err := h.DB.QueryRow(r.Context(), `select id::text,name,category::text from workflow_state where id=$1::uuid and team_id=$2::uuid limit 1`, id, teamID).Scan(&s.ID, &s.Name, &s.Category)
	return s, err
}
func (h Handler) triageIssueState(r *http.Request, teamID, id string) (triageIssueStateRecord, error) {
	var s triageIssueStateRecord
	err := h.DB.QueryRow(r.Context(), `select i.id::text,i.state_id::text,ws.category::text from issue i join workflow_state ws on ws.id=i.state_id where i.id=$1::uuid and i.team_id=$2::uuid limit 1`, id, teamID).Scan(&s.ID, &s.StateID, &s.Category)
	return s, err
}
func teamSummaryJSON(team triageTeam) map[string]any {
	return map[string]any{"id": team.ID, "name": team.Name, "key": team.Key, "workspaceId": team.WorkspaceID, "triageEnabled": team.TriageEnabled}
}
func defaultTriageDestination(settings map[string]any, action string) string {
	key := "triageAcceptDestinationStateId"
	if action == "decline" {
		key = "triageDeclineDestinationStateId"
	}
	if value, ok := settings[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}
func stringPtrTrim(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
func nullableTrim(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}
