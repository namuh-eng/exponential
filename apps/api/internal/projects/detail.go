package projects

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"
)

type detailIssue struct {
	ID                 string           `json:"id"`
	Identifier         string           `json:"identifier"`
	Title              string           `json:"title"`
	Priority           string           `json:"priority"`
	Assignee           *detailAssignee  `json:"assignee"`
	CreatedAt          string           `json:"createdAt"`
	Href               *string          `json:"href"`
	Labels             []map[string]any `json:"labels"`
	ProjectMilestoneID *string          `json:"projectMilestoneId"`
	completedAt        *time.Time
}

type detailAssignee struct {
	Name  string  `json:"name"`
	Image *string `json:"image"`
}

type detailIssueGroup struct {
	State  map[string]any `json:"state"`
	Issues []detailIssue  `json:"issues"`
	pos    float64
}

func (h Handler) projectDetail(ctx context.Context, workspaceID, workspaceSlug string, project Project) (map[string]any, error) {
	settings, workspaceSettings, err := h.projectAndWorkspaceSettings(ctx, project.ID, workspaceID)
	if err != nil {
		return nil, err
	}
	teams, err := h.detailTeams(ctx, project.ID)
	if err != nil {
		return nil, err
	}
	milestones, err := h.detailMilestones(ctx, project.ID, settings)
	if err != nil {
		return nil, err
	}
	groups, total, completed, err := h.detailIssueGroups(ctx, project.ID, workspaceSlug)
	if err != nil {
		return nil, err
	}
	milestoneCounts(milestones, groups)
	statuses := detailProjectStatuses(workspaceSettings)
	statusKey := project.Status
	if key := stringDetail(settings["projectStatusKey"], ""); key != "" {
		statusKey = key
	}
	status := detailFindStatus(statuses, statusKey)
	return map[string]any{
		"project": map[string]any{
			"id":              project.ID,
			"name":            project.Name,
			"description":     project.Description,
			"icon":            project.Icon,
			"slug":            project.Slug,
			"status":          statusKey,
			"statusLabel":     status["name"],
			"statusColor":     status["color"],
			"statusIcon":      status["icon"],
			"statusIsDefault": status["isDefault"],
			"priority":        project.Priority,
			"startDate":       project.StartDate,
			"targetDate":      project.TargetDate,
			"createdAt":       project.CreatedAt,
		},
		"lead":              nil,
		"members":           []any{},
		"teams":             teams,
		"labels":            []any{},
		"availableMembers":  []any{},
		"availableTeams":    teams,
		"availableLabels":   []any{},
		"availableStatuses": statuses,
		"slackChannel":      nil,
		"projectStatuses":   statuses,
		"resources":         sliceDetail(settings["resources"]),
		"activity":          sliceDetail(settings["activity"]),
		"milestones":        milestones,
		"issueGroups":       groups,
		"progress": map[string]any{
			"total":      total,
			"completed":  completed,
			"percentage": percentage(total, completed),
			"assignees":  []any{},
			"labels":     []any{},
		},
	}, nil
}

func (h Handler) projectAndWorkspaceSettings(ctx context.Context, projectID, workspaceID string) (map[string]any, map[string]any, error) {
	var projectRaw, workspaceRaw []byte
	err := h.DB.QueryRow(ctx, `select coalesce(p.settings,'{}'::jsonb), coalesce(w.settings,'{}'::jsonb) from project p join workspace w on w.id=p.workspace_id where p.id=$1::uuid and w.id=$2::uuid`, projectID, workspaceID).Scan(&projectRaw, &workspaceRaw)
	if err != nil {
		return nil, nil, err
	}
	projectSettings := map[string]any{}
	workspaceSettings := map[string]any{}
	_ = json.Unmarshal(projectRaw, &projectSettings)
	_ = json.Unmarshal(workspaceRaw, &workspaceSettings)
	return projectSettings, workspaceSettings, nil
}

func (h Handler) detailTeams(ctx context.Context, projectID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(ctx, `select t.id::text,t.name,t.key from project_team pt join team t on t.id=pt.team_id where pt.project_id=$1::uuid order by t.name`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, key string
		if err := rows.Scan(&id, &name, &key); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "name": name, "key": key})
	}
	return out, rows.Err()
}

func (h Handler) detailMilestones(ctx context.Context, projectID string, settings map[string]any) ([]map[string]any, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,sort_order from project_milestone where project_id=$1::uuid order by sort_order,name`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name string
		var sortOrder float64
		if err := rows.Scan(&id, &name, &sortOrder); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"id": id, "name": name, "sortOrder": sortOrder, "description": milestoneDescription(settings, id), "issueCount": int32(0), "completedCount": int32(0), "progress": int32(0)})
	}
	return out, rows.Err()
}

func (h Handler) detailIssueGroups(ctx context.Context, projectID, workspaceSlug string) ([]map[string]any, int, int, error) {
	rows, err := h.DB.Query(ctx, `select i.id::text,i.identifier,i.title,i.priority::text,i.created_at,i.completed_at,i.project_milestone_id::text,u.name,u.image,ws.id::text,ws.name,ws.category::text,ws.color,ws.position,t.key from issue i join workflow_state ws on ws.id=i.state_id join team t on t.id=i.team_id left join "user" u on u.id=i.assignee_id where i.project_id=$1::uuid and i.archived_at is null order by ws.position,i.created_at desc`, projectID)
	if err != nil {
		return nil, 0, 0, err
	}
	defer rows.Close()
	byState := map[string]*detailIssueGroup{}
	order := []string{}
	total, completed := 0, 0
	for rows.Next() {
		var issue detailIssue
		var created time.Time
		var completedAt *time.Time
		var assigneeName, assigneeImage *string
		var stateID, stateName, stateCategory, stateColor, teamKey string
		var position float64
		if err := rows.Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.Priority, &created, &completedAt, &issue.ProjectMilestoneID, &assigneeName, &assigneeImage, &stateID, &stateName, &stateCategory, &stateColor, &position, &teamKey); err != nil {
			return nil, 0, 0, err
		}
		if _, ok := byState[stateID]; !ok {
			byState[stateID] = &detailIssueGroup{State: map[string]any{"id": stateID, "name": stateName, "category": stateCategory, "color": stateColor}, Issues: []detailIssue{}, pos: position}
			order = append(order, stateID)
		}
		issue.CreatedAt = created.UTC().Format(time.RFC3339Nano)
		issue.completedAt = completedAt
		issue.Labels = []map[string]any{}
		if assigneeName != nil {
			issue.Assignee = &detailAssignee{Name: *assigneeName, Image: assigneeImage}
		}
		href := "/team/" + teamKey + "/issue/" + issue.Identifier
		if workspaceSlug != "" {
			href = "/" + workspaceSlug + href
		}
		issue.Href = &href
		byState[stateID].Issues = append(byState[stateID].Issues, issue)
		total++
		if completedAt != nil {
			completed++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, 0, 0, err
	}
	sort.Slice(order, func(i, j int) bool { return byState[order[i]].pos < byState[order[j]].pos })
	out := []map[string]any{}
	for _, id := range order {
		group := byState[id]
		out = append(out, map[string]any{"state": group.State, "issues": group.Issues})
	}
	return out, total, completed, nil
}

func milestoneCounts(milestones []map[string]any, groups []map[string]any) {
	byID := map[string]map[string]any{}
	for _, milestone := range milestones {
		if id, ok := milestone["id"].(string); ok {
			byID[id] = milestone
		}
	}
	for _, group := range groups {
		issues, _ := group["issues"].([]detailIssue)
		for _, issue := range issues {
			if issue.ProjectMilestoneID == nil {
				continue
			}
			milestone := byID[*issue.ProjectMilestoneID]
			if milestone == nil {
				continue
			}
			milestone["issueCount"] = milestone["issueCount"].(int32) + 1
			if issue.completedAt != nil {
				milestone["completedCount"] = milestone["completedCount"].(int32) + 1
			}
			milestone["progress"] = int32(percentage(int(milestone["issueCount"].(int32)), int(milestone["completedCount"].(int32))))
		}
	}
}

func percentage(total, completed int) int {
	if total == 0 {
		return 0
	}
	return int(float64(completed) / float64(total) * 100)
}

func detailProjectStatuses(settings map[string]any) []map[string]any {
	statuses := []map[string]any{
		{"id": "planned", "key": "planned", "name": "Planned", "color": "#6b6f76", "icon": "○", "isDefault": true},
		{"id": "started", "key": "started", "name": "In progress", "color": "#b58900", "icon": "◐", "isDefault": true},
		{"id": "paused", "key": "paused", "name": "Paused", "color": "#6b6f76", "icon": "Ⅱ", "isDefault": true},
		{"id": "completed", "key": "completed", "name": "Completed", "color": "#2e7d32", "icon": "✓", "isDefault": true},
		{"id": "canceled", "key": "canceled", "name": "Canceled", "color": "#6b6f76", "icon": "×", "isDefault": true},
	}
	for _, raw := range sliceDetail(settings["projectStatuses"]) {
		rec := recordDetail(raw)
		key, _ := rec["key"].(string)
		name, _ := rec["name"].(string)
		if key == "" || name == "" {
			continue
		}
		statuses = append(statuses, map[string]any{"id": stringDetail(rec["id"], key), "key": key, "name": name, "color": stringDetail(rec["color"], "#6b6f76"), "icon": stringDetail(rec["icon"], "•"), "isDefault": false})
	}
	return statuses
}

func detailFindStatus(statuses []map[string]any, key string) map[string]any {
	for _, status := range statuses {
		if status["key"] == key {
			return status
		}
	}
	return map[string]any{"key": key, "name": key, "color": "#6b6f76", "icon": "•", "isDefault": false}
}

func (h Handler) enrichProjects(ctx context.Context, projects []Project) error {
	if len(projects) == 0 {
		return nil
	}
	settingsByProject, workspaceSettings, err := h.projectListSettings(ctx, projects)
	if err != nil {
		return err
	}
	labels, err := h.projectListLabels(ctx, settingsByProject)
	if err != nil {
		return err
	}
	statuses := detailProjectStatuses(workspaceSettings)
	for i := range projects {
		settings := settingsByProject[projects[i].ID]
		statusKey := projects[i].Status
		if key := stringDetail(settings["projectStatusKey"], ""); key != "" {
			statusKey = key
		}
		status := detailFindStatus(statuses, statusKey)
		projects[i].Status = statusKey
		projects[i].StatusLabel = stringDetail(status["name"], statusKey)
		projects[i].StatusColor = stringDetail(status["color"], "#6b6f76")
		projects[i].StatusIcon = stringDetail(status["icon"], "•")
		projects[i].Labels = labels[projects[i].ID]
		if projects[i].Labels == nil {
			projects[i].Labels = []ProjectLabelRef{}
		}
	}
	return nil
}

func (h Handler) projectListSettings(ctx context.Context, projects []Project) (map[string]map[string]any, map[string]any, error) {
	out := map[string]map[string]any{}
	ids := projectIDs(projects)
	rows, err := h.DB.Query(ctx, `select id::text, coalesce(settings,'{}'::jsonb) from project where id = any($1::uuid[])`, ids)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, nil, err
		}
		settings := map[string]any{}
		_ = json.Unmarshal(raw, &settings)
		out[id] = settings
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	var workspaceSettingsRaw []byte
	workspaceSettings := map[string]any{}
	if err := h.DB.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid`, projects[0].WorkspaceID).Scan(&workspaceSettingsRaw); err == nil {
		_ = json.Unmarshal(workspaceSettingsRaw, &workspaceSettings)
	}
	return out, workspaceSettings, nil
}

func (h Handler) projectListLabels(ctx context.Context, settingsByProject map[string]map[string]any) (map[string][]ProjectLabelRef, error) {
	labelToProjects := map[string][]string{}
	for projectID, settings := range settingsByProject {
		for _, raw := range sliceDetail(settings["labelIds"]) {
			if id, ok := raw.(string); ok && strings.TrimSpace(id) != "" {
				labelToProjects[id] = append(labelToProjects[id], projectID)
			}
		}
	}
	out := map[string][]ProjectLabelRef{}
	if len(labelToProjects) == 0 {
		return out, nil
	}
	ids := make([]string, 0, len(labelToProjects))
	for id := range labelToProjects {
		ids = append(ids, id)
	}
	rows, err := h.DB.Query(ctx, `select id::text,name,color from project_label where id = any($1::uuid[]) order by name`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var label ProjectLabelRef
		if err := rows.Scan(&label.ID, &label.Name, &label.Color); err != nil {
			return nil, err
		}
		for _, projectID := range labelToProjects[label.ID] {
			out[projectID] = append(out[projectID], label)
		}
	}
	return out, rows.Err()
}

func recordDetail(value any) map[string]any {
	if v, ok := value.(map[string]any); ok {
		return v
	}
	return map[string]any{}
}
func sliceDetail(value any) []any {
	if v, ok := value.([]any); ok {
		return v
	}
	return []any{}
}
func stringDetail(value any, fallback string) string {
	if v, ok := value.(string); ok && v != "" {
		return v
	}
	return fallback
}
