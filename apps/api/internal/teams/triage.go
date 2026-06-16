package teams

import (
	"context"
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

const (
	triageDefaultAssigneeKey = "triageDefaultAssigneeId"
	triageDefaultLabelIDsKey = "triageDefaultLabelIds"
	triageDefaultProjectKey  = "triageDefaultProjectId"
	triageDefaultCycleKey    = "triageDefaultCycleId"
)

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
	DueDate            *string  `json:"dueDate"`
	Comment            *string  `json:"comment"`
	Subscribe          *bool    `json:"subscribe"`
	IssueIDs           []string `json:"issueIds"`
	fieldsPresent      map[string]bool
}

func (t *triageDecisionRequest) UnmarshalJSON(data []byte) error {
	type alias triageDecisionRequest
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*t = triageDecisionRequest(decoded)
	t.fieldsPresent = map[string]bool{}
	for key := range raw {
		t.fieldsPresent[key] = true
	}
	return nil
}

func (t triageDecisionRequest) hasField(key string) bool {
	return t.fieldsPresent != nil && t.fieldsPresent[key]
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
	problem.JSON(w, 200, map[string]any{"team": teamSummaryJSON(team), "issues": issues, "count": len(issues), "createStateId": states[0]["id"], "createStateName": states[0]["name"], "triageEnabled": true, "acceptDestinationStates": accept, "declineDestinationStates": decline, "metadataOptions": options, "defaults": triageDefaultSettings(team.Settings)})
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
	if input.Action == "accept" {
		applyTriageDefaultMetadata(team.Settings, &input)
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
	dueDate := any(nil)
	if input.DueDate != nil {
		parsed, err := parseTriageDueDate(input.DueDate)
		if err != nil {
			return map[string]any{"error": "Invalid due date"}, 400
		}
		dueDate = parsed
	}
	if err := h.validateTriageDecisionResources(r.Context(), team, input); err != nil {
		return map[string]any{"error": err.Error()}, 400
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
	if _, err := tx.Exec(r.Context(), `update issue set state_id=$1::uuid, updated_at=now(), canceled_at=$2, completed_at=$3, priority=coalesce($4,priority), estimate=coalesce($5,estimate), assignee_id=$6, project_id=$7::uuid, project_milestone_id=$8::uuid, cycle_id=$9::uuid, due_date=coalesce($10,due_date) where id=$11::uuid and team_id=$12::uuid and state_id=$13::uuid`, dest.ID, canceledAt, completedAt, priority, estimate, nullableTrim(input.AssigneeID), nullableTrim(input.ProjectID), nullableTrim(input.ProjectMilestoneID), nullableTrim(input.CycleID), dueDate, issueID, team.ID, current.StateID); err != nil {
		problem.Write(w, 500, "Triage decision failed", err.Error())
		return nil, 0
	}
	if input.Action == "accept" && input.LabelIDs != nil {
		if _, err := tx.Exec(r.Context(), `delete from issue_label where issue_id=$1::uuid`, issueID); err != nil {
			problem.Write(w, 500, "Triage decision failed", err.Error())
			return nil, 0
		}
		for _, labelID := range cleanStringIDs(input.LabelIDs) {
			if _, err := tx.Exec(r.Context(), `insert into issue_label (issue_id,label_id) values ($1::uuid,$2::uuid) on conflict do nothing`, issueID, labelID); err != nil {
				problem.Write(w, 500, "Triage decision failed", err.Error())
				return nil, 0
			}
		}
	}
	commentBody := stringPtrTrim(input.Comment)
	if input.Action == "decline" && commentBody == "" {
		commentBody = stringPtrTrim(input.Reason)
	}
	if commentBody != "" {
		if _, err := tx.Exec(r.Context(), `insert into comment (body,issue_id,user_id) values ($1,$2::uuid,$3)`, commentBody, issueID, userID); err != nil {
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
	rows, err := h.DB.Query(r.Context(), `select id::text,name,color from workflow_state where team_id=$1::uuid and category='triage' order by coalesce(is_default,false) desc, position asc, name asc, id asc`, teamID)
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
		labels, err := h.triageIssueLabels(r, id)
		if err != nil {
			return nil, err
		}
		labelIDs := make([]string, 0, len(labels))
		for _, label := range labels {
			if labelID, ok := label["id"].(string); ok {
				labelIDs = append(labelIDs, labelID)
			}
		}
		sourceContext, err := h.triageIssueSourceContext(r, id)
		if err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "identifier": identifier, "title": title, "description": description, "priority": priority, "stateId": stateID, "stateName": stateName, "stateColor": stateColor, "creatorId": creatorID, "creatorName": creatorName, "creatorImage": creatorImage, "createdAt": createdAt.UTC().Format(time.RFC3339), "updatedAt": updatedAt.UTC().Format(time.RFC3339), "labelIds": labelIDs, "labels": labels, "assigneeId": assigneeID, "projectId": projectID, "projectName": projectName, "projectMilestoneId": milestoneID, "cycleId": cycleID, "dueDate": dueDate, "estimate": estimate, "teamId": teamID, "sourceContext": sourceContext})
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
	labels, err := h.optionLabels(r.Context(), team.WorkspaceID, team.ID)
	if err != nil {
		return nil, err
	}
	cycles, err := h.optionCycles(r.Context(), team.ID)
	if err != nil {
		return nil, err
	}
	projects, err := h.optionProjects(r.Context(), team.WorkspaceID)
	if err != nil {
		return nil, err
	}
	milestones, err := h.triageProjectMilestones(r.Context(), team.WorkspaceID)
	if err != nil {
		return nil, err
	}
	members, err := h.triageMembers(r.Context(), team.ID, team.WorkspaceID)
	if err != nil {
		return nil, err
	}
	templates, err := h.optionTemplates(r.Context(), team.WorkspaceID, team.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"labels": labels, "cycles": cycles, "projects": projects, "projectMilestones": milestones, "members": members, "templates": templates}, nil
}

func (h Handler) triageProjectMilestones(ctx context.Context, workspaceID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(ctx, `select pm.id::text,pm.name,pm.project_id::text from project_milestone pm join project p on p.id=pm.project_id where p.workspace_id=$1::uuid order by p.name asc, pm.sort_order asc, pm.name asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, projectID string
		if err := rows.Scan(&id, &name, &projectID); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "name": name, "projectId": projectID})
	}
	return out, rows.Err()
}

func (h Handler) triageMembers(ctx context.Context, teamID, workspaceID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(ctx, `select u.id,u.name,u.email,u.image from team_member tm join "user" u on u.id=tm.user_id join member m on m.user_id=u.id and m.workspace_id=$2::uuid where tm.team_id=$1::uuid order by u.name asc,u.email asc`, teamID, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id string
		var name, email, image *string
		if err := rows.Scan(&id, &name, &email, &image); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "name": name, "email": email, "image": image})
	}
	return out, rows.Err()
}

func (h Handler) triageIssueLabels(r *http.Request, issueID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `select l.id::text,l.name,l.color from issue_label il join label l on l.id=il.label_id where il.issue_id=$1::uuid order by l.name asc`, issueID)
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

func (h Handler) triageIssueSourceContext(r *http.Request, issueID string) (map[string]any, error) {
	var raw []byte
	err := h.DB.QueryRow(r.Context(), `select metadata from issue_history where issue_id=$1::uuid and event_type='created' order by created_at asc limit 1`, issueID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	metadata := map[string]any{}
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return nil, err
	}
	return triageSourceContext(metadata), nil
}

func triageSourceContext(metadata map[string]any) map[string]any {
	source := strings.TrimSpace(stringFromAny(metadata["source"], ""))
	if source == "" {
		return nil
	}
	label := map[string]string{"slack_message": "Slack", "slack": "Slack", "discord_command": "Discord", "microsoft_teams_message": "Microsoft Teams", "inbound_email": "Email", "demo_seed": "Demo import"}[source]
	if label == "" {
		label = source
	}
	context := map[string]any{"source": source, "label": label}
	for _, key := range []string{"backlink", "url", "recipient", "sender", "title", "identifier"} {
		if value := strings.TrimSpace(stringFromAny(metadata[key], "")); value != "" {
			context[key] = value
		}
	}
	return context
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

func triageDefaultSettings(settings map[string]any) map[string]any {
	return map[string]any{
		"acceptDestinationStateId":  defaultTriageDestination(settings, "accept"),
		"declineDestinationStateId": defaultTriageDestination(settings, "decline"),
		"assigneeId":                settingString(settings, triageDefaultAssigneeKey),
		"labelIds":                  settingStringSlice(settings, triageDefaultLabelIDsKey),
		"projectId":                 settingString(settings, triageDefaultProjectKey),
		"cycleId":                   settingString(settings, triageDefaultCycleKey),
	}
}

func applyTriageDefaultMetadata(settings map[string]any, input *triageDecisionRequest) {
	if !input.hasField("assigneeId") {
		input.AssigneeID = stringPtrOrNil(settingString(settings, triageDefaultAssigneeKey))
	}
	if !input.hasField("labelIds") {
		input.LabelIDs = settingStringSlice(settings, triageDefaultLabelIDsKey)
	}
	if !input.hasField("projectId") {
		input.ProjectID = stringPtrOrNil(settingString(settings, triageDefaultProjectKey))
	}
	if !input.hasField("cycleId") {
		input.CycleID = stringPtrOrNil(settingString(settings, triageDefaultCycleKey))
	}
}

func (h Handler) validateTriageDefaultSettings(ctx context.Context, team triageTeam) error {
	input := triageDecisionRequest{
		AssigneeID: stringPtrOrNil(settingString(team.Settings, triageDefaultAssigneeKey)),
		LabelIDs:   settingStringSlice(team.Settings, triageDefaultLabelIDsKey),
		ProjectID:  stringPtrOrNil(settingString(team.Settings, triageDefaultProjectKey)),
		CycleID:    stringPtrOrNil(settingString(team.Settings, triageDefaultCycleKey)),
	}
	return h.validateTriageDecisionResources(ctx, team, input)
}

func (h Handler) validateTriageDecisionResources(ctx context.Context, team triageTeam, input triageDecisionRequest) error {
	if input.AssigneeID != nil && stringPtrTrim(input.AssigneeID) != "" {
		if err := h.validateTriageAssignee(ctx, team, stringPtrTrim(input.AssigneeID)); err != nil {
			return err
		}
	}
	if input.LabelIDs != nil {
		if err := h.validateTriageLabels(ctx, team, input.LabelIDs); err != nil {
			return err
		}
	}
	projectID := stringPtrTrim(input.ProjectID)
	if projectID != "" {
		if err := h.validateTriageProject(ctx, team.WorkspaceID, projectID); err != nil {
			return err
		}
	}
	milestoneID := stringPtrTrim(input.ProjectMilestoneID)
	if milestoneID != "" {
		if err := h.validateTriageMilestone(ctx, team.WorkspaceID, projectID, milestoneID); err != nil {
			return err
		}
	}
	if input.CycleID != nil && stringPtrTrim(input.CycleID) != "" {
		if err := h.validateTriageCycle(ctx, team.ID, stringPtrTrim(input.CycleID)); err != nil {
			return err
		}
	}
	return nil
}

func (h Handler) validateTriageAssignee(ctx context.Context, team triageTeam, userID string) error {
	var ok bool
	err := h.DB.QueryRow(ctx, `select exists(select 1 from team_member tm join member m on m.user_id=tm.user_id and m.workspace_id=$3::uuid where tm.team_id=$1::uuid and tm.user_id=$2)`, team.ID, userID, team.WorkspaceID).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Assignee is not a member of this team")
	}
	return nil
}

func (h Handler) validateTriageLabels(ctx context.Context, team triageTeam, labelIDs []string) error {
	ids := cleanStringIDs(labelIDs)
	if len(ids) == 0 {
		return nil
	}
	var count int
	err := h.DB.QueryRow(ctx, `select count(distinct id)::int from label where workspace_id=$1::uuid and (team_id is null or team_id=$2::uuid) and archived_at is null and id=any($3::uuid[])`, team.WorkspaceID, team.ID, ids).Scan(&count)
	if err != nil {
		return err
	}
	if count != len(ids) {
		return errors.New("Labels must belong to this workspace and team")
	}
	return nil
}

func (h Handler) validateTriageProject(ctx context.Context, workspaceID, projectID string) error {
	var ok bool
	err := h.DB.QueryRow(ctx, `select exists(select 1 from project where id=$1::uuid and workspace_id=$2::uuid and completed_at is null and canceled_at is null)`, projectID, workspaceID).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Project must belong to this workspace")
	}
	return nil
}

func (h Handler) validateTriageMilestone(ctx context.Context, workspaceID, projectID, milestoneID string) error {
	if projectID == "" {
		return errors.New("Project is required when setting a project milestone")
	}
	var ok bool
	err := h.DB.QueryRow(ctx, `select exists(select 1 from project_milestone pm join project p on p.id=pm.project_id where pm.id=$1::uuid and pm.project_id=$2::uuid and p.workspace_id=$3::uuid)`, milestoneID, projectID, workspaceID).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Project milestone must belong to the selected project")
	}
	return nil
}

func (h Handler) validateTriageCycle(ctx context.Context, teamID, cycleID string) error {
	var ok bool
	err := h.DB.QueryRow(ctx, `select exists(select 1 from cycle where id=$1::uuid and team_id=$2::uuid)`, cycleID, teamID).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("Cycle must belong to this team")
	}
	return nil
}

func parseTriageDueDate(value *string) (any, error) {
	trimmed := stringPtrTrim(value)
	if trimmed == "" {
		return nil, nil
	}
	if parsed, err := time.Parse(time.RFC3339, trimmed); err == nil {
		return parsed, nil
	}
	parsed, err := time.Parse("2006-01-02", trimmed)
	if err != nil {
		return nil, err
	}
	return parsed, nil
}

func cleanStringIDs(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		out = append(out, trimmed)
	}
	return out
}

func settingString(settings map[string]any, key string) string {
	if value, ok := settings[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func settingStringSlice(settings map[string]any, key string) []string {
	switch value := settings[key].(type) {
	case []string:
		return cleanStringIDs(value)
	case []any:
		out := []string{}
		for _, item := range value {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return cleanStringIDs(out)
	default:
		return nil
	}
}

func stringPtrOrNil(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
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
