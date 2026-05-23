package teams

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type analyticsIssue struct {
	ID             string
	Identifier     string
	Title          string
	Estimate       *float32
	CreatedAt      time.Time
	CompletedAt    *time.Time
	UpdatedAt      time.Time
	StatusName     *string
	StatusCategory *string
	ProjectID      *string
	ProjectName    *string
	CycleID        *string
	CycleName      *string
	CycleNumber    *int32
	Labels         []string
}

type analyticsCycle struct {
	ID        string
	Name      string
	Number    int32
	StartDate time.Time
	EndDate   time.Time
	Total     int
	Completed int
}

func (h Handler) Analytics(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeamRecord(r, p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load team analytics failed", err.Error())
		return
	}

	issues, err := h.analyticsIssues(r, team.ID)
	if err != nil {
		problem.Write(w, 500, "Load team analytics failed", err.Error())
		return
	}
	if err := h.attachAnalyticsLabels(r, issues); err != nil {
		problem.Write(w, 500, "Load team analytics failed", err.Error())
		return
	}
	cycles, err := h.analyticsCycles(r, team.ID, issues)
	if err != nil {
		problem.Write(w, 500, "Load team analytics failed", err.Error())
		return
	}
	query := analyticsQuery(r)
	filtered := filterAnalyticsIssues(issues, query)
	problem.JSON(w, 200, buildTeamAnalyticsResponse(team, query, issues, filtered, cycles))
}

func (h Handler) analyticsIssues(r *http.Request, teamID string) ([]analyticsIssue, error) {
	rows, err := h.DB.Query(r.Context(), `
		select i.id::text, i.identifier, i.title, i.estimate, i.created_at, i.completed_at, i.updated_at,
		       ws.name, ws.category::text, p.id::text, p.name, c.id::text, c.name, c.number
		from issue i
		left join workflow_state ws on ws.id=i.state_id
		left join project p on p.id=i.project_id
		left join cycle c on c.id=i.cycle_id
		where i.team_id=$1::uuid
		order by i.updated_at desc`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []analyticsIssue{}
	for rows.Next() {
		var item analyticsIssue
		if err := rows.Scan(&item.ID, &item.Identifier, &item.Title, &item.Estimate, &item.CreatedAt, &item.CompletedAt, &item.UpdatedAt, &item.StatusName, &item.StatusCategory, &item.ProjectID, &item.ProjectName, &item.CycleID, &item.CycleName, &item.CycleNumber); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (h Handler) attachAnalyticsLabels(r *http.Request, issues []analyticsIssue) error {
	if len(issues) == 0 {
		return nil
	}
	ids := []string{}
	byID := map[string]int{}
	for index, issue := range issues {
		ids = append(ids, issue.ID)
		byID[issue.ID] = index
	}
	rows, err := h.DB.Query(r.Context(), `select il.issue_id::text,l.name from issue_label il join label l on l.id=il.label_id where il.issue_id = any($1::uuid[])`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var issueID, name string
		if err := rows.Scan(&issueID, &name); err != nil {
			return err
		}
		if index, ok := byID[issueID]; ok {
			issues[index].Labels = append(issues[index].Labels, name)
		}
	}
	return rows.Err()
}

func (h Handler) analyticsCycles(r *http.Request, teamID string, issues []analyticsIssue) ([]analyticsCycle, error) {
	rows, err := h.DB.Query(r.Context(), `select id::text,name,number,start_date,end_date from cycle where team_id=$1::uuid order by end_date desc limit 5`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []analyticsCycle{}
	for rows.Next() {
		var cycle analyticsCycle
		if err := rows.Scan(&cycle.ID, &cycle.Name, &cycle.Number, &cycle.StartDate, &cycle.EndDate); err != nil {
			return nil, err
		}
		for _, issue := range issues {
			if issue.CycleID != nil && *issue.CycleID == cycle.ID {
				cycle.Total++
				if issue.CompletedAt != nil {
					cycle.Completed++
				}
			}
		}
		out = append(out, cycle)
	}
	return out, rows.Err()
}

func analyticsQuery(r *http.Request) map[string]any {
	q := r.URL.Query()
	return map[string]any{
		"measure":        validAnalyticsValue(q.Get("measure"), []string{"issue_count", "effort", "cycle_time", "lead_time", "triage_time", "issue_age"}, "issue_count"),
		"slice":          validAnalyticsValue(q.Get("slice"), []string{"status", "project", "cycle", "label", "created_week"}, "status"),
		"segment":        validAnalyticsValue(q.Get("segment"), []string{"none", "status", "project", "label"}, "none"),
		"range":          validAnalyticsValue(q.Get("range"), []string{"30d", "90d", "180d", "all"}, "90d"),
		"status":         optionalQuery(q.Get("status")),
		"project":        optionalQuery(q.Get("project")),
		"team":           optionalQuery(q.Get("team")),
		"label":          optionalQuery(q.Get("label")),
		"createdAfter":   optionalQuery(q.Get("createdAfter")),
		"completedAfter": optionalQuery(q.Get("completedAfter")),
	}
}

func filterAnalyticsIssues(issues []analyticsIssue, query map[string]any) []analyticsIssue {
	out := []analyticsIssue{}
	for _, issue := range issues {
		if status, _ := query["status"].(string); status != "" && !ptrEquals(issue.StatusCategory, status) && !ptrEquals(issue.StatusName, status) {
			continue
		}
		if project, _ := query["project"].(string); project != "" && !ptrEquals(issue.ProjectID, project) && !ptrEquals(issue.ProjectName, project) {
			continue
		}
		if label, _ := query["label"].(string); label != "" && !stringSliceContains(issue.Labels, label) {
			continue
		}
		out = append(out, issue)
	}
	return out
}

func buildTeamAnalyticsResponse(team teamRecordForSettings, query map[string]any, allIssues, filtered []analyticsIssue, cycles []analyticsCycle) map[string]any {
	buckets := map[string]map[string]any{}
	for _, issue := range filtered {
		label := analyticsSlice(issue, query["slice"].(string))
		bucket := buckets[label]
		if bucket == nil {
			bucket = map[string]any{"key": label, "label": label, "value": float64(0), "issueIds": []string{}, "count": 0, "completed": 0, "effort": float64(0), "drilldown": map[string]any{"label": label, "analyticsKey": "bucket:" + label, "issueIds": []string{}}}
		}
		ids := bucket["issueIds"].([]string)
		ids = append(ids, issue.ID)
		bucket["issueIds"] = ids
		bucket["count"] = bucket["count"].(int) + 1
		if issue.CompletedAt != nil {
			bucket["completed"] = bucket["completed"].(int) + 1
		}
		effort := float64(0)
		if issue.Estimate != nil {
			effort = float64(*issue.Estimate)
		}
		bucket["effort"] = bucket["effort"].(float64) + effort
		bucket["value"] = bucket["value"].(float64) + analyticsMeasure(issue, query["measure"].(string))
		bucket["drilldown"] = map[string]any{"label": label, "analyticsKey": "bucket:" + label, "issueIds": ids}
		buckets[label] = bucket
	}
	rows := []map[string]any{}
	for _, row := range buckets {
		rows = append(rows, row)
	}
	completed := 0
	effort := float64(0)
	for _, issue := range filtered {
		if issue.CompletedAt != nil {
			completed++
		}
		if issue.Estimate != nil {
			effort += float64(*issue.Estimate)
		}
	}
	return map[string]any{
		"team":  map[string]any{"id": team.ID, "name": team.Name, "key": team.Key},
		"query": query,
		"controls": map[string]any{
			"measures": []map[string]string{{"value": "issue_count", "label": "Issue count"}, {"value": "effort", "label": "Effort"}, {"value": "cycle_time", "label": "Cycle time"}, {"value": "lead_time", "label": "Lead time"}, {"value": "triage_time", "label": "Triage time"}, {"value": "issue_age", "label": "Issue age"}},
			"slices":   []map[string]string{{"value": "status", "label": "Status"}, {"value": "project", "label": "Project"}, {"value": "cycle", "label": "Cycle"}, {"value": "label", "label": "Label"}, {"value": "created_week", "label": "Created week"}},
			"segments": []map[string]string{{"value": "none", "label": "No segment"}, {"value": "status", "label": "Status"}, {"value": "project", "label": "Project"}, {"value": "label", "label": "Label"}},
			"ranges":   []map[string]string{{"value": "30d", "label": "Last 30 days"}, {"value": "90d", "label": "Last 90 days"}, {"value": "180d", "label": "Last 180 days"}, {"value": "all", "label": "All time"}},
		},
		"filters":      analyticsFilters(team, allIssues),
		"summary":      map[string]any{"issueCount": len(filtered), "completedCount": completed, "effort": effort, "velocity": completed / 4, "period": "Current selection"},
		"chart":        map[string]any{"title": "Team analytics", "points": rows},
		"metricCards":  []any{},
		"trend":        map[string]any{"title": "Created, completed, and active issues over time", "points": []any{}},
		"tableRows":    rows,
		"cycleMetrics": analyticsCycleMetrics(cycles),
		"emptyState":   emptyAnalyticsState(filtered),
		"actions":      map[string]any{"csv": map[string]any{"enabled": true, "label": "Export CSV"}, "share": map[string]any{"enabled": true, "label": "Copy share link"}, "fullscreen": map[string]any{"enabled": true, "label": "Full screen"}},
	}
}

func analyticsSlice(issue analyticsIssue, slice string) string {
	switch slice {
	case "project":
		return ptrValue(issue.ProjectName, "No project")
	case "cycle":
		if issue.CycleName != nil {
			return *issue.CycleName
		}
		return "No cycle"
	case "label":
		if len(issue.Labels) > 0 {
			return issue.Labels[0]
		}
		return "No label"
	case "created_week":
		return issue.CreatedAt.Format("2006-01-02")
	default:
		return ptrValue(issue.StatusName, "No status")
	}
}

func analyticsMeasure(issue analyticsIssue, measure string) float64 {
	if measure == "effort" && issue.Estimate != nil {
		return float64(*issue.Estimate)
	}
	return 1
}

func analyticsFilters(team teamRecordForSettings, issues []analyticsIssue) map[string]any {
	statuses := []string{}
	labels := []string{}
	projects := []map[string]any{}
	seenProjects := map[string]bool{}
	for _, issue := range issues {
		if issue.StatusCategory != nil && !stringSliceContains(statuses, *issue.StatusCategory) {
			statuses = append(statuses, *issue.StatusCategory)
		}
		for _, label := range issue.Labels {
			if !stringSliceContains(labels, label) {
				labels = append(labels, label)
			}
		}
		if issue.ProjectID != nil && !seenProjects[*issue.ProjectID] {
			seenProjects[*issue.ProjectID] = true
			projects = append(projects, map[string]any{"id": *issue.ProjectID, "name": ptrValue(issue.ProjectName, "Unnamed project")})
		}
	}
	return map[string]any{"statuses": statuses, "projects": projects, "teams": []map[string]any{{"id": team.ID, "key": team.Key, "name": team.Name}}, "labels": labels}
}

func analyticsCycleMetrics(cycles []analyticsCycle) []map[string]any {
	out := []map[string]any{}
	for _, cycle := range cycles {
		percentage := 0
		if cycle.Total > 0 {
			percentage = (cycle.Completed * 100) / cycle.Total
		}
		out = append(out, map[string]any{"id": cycle.ID, "name": cycle.Name, "total": cycle.Total, "completed": cycle.Completed, "percentage": percentage, "burndown": []any{}})
	}
	return out
}

func validAnalyticsValue(value string, allowed []string, fallback string) string {
	for _, item := range allowed {
		if value == item {
			return value
		}
	}
	return fallback
}
func optionalQuery(value string) any {
	if value == "" {
		return nil
	}
	return value
}
func ptrEquals(value *string, target string) bool { return value != nil && *value == target }
func ptrValue(value *string, fallback string) string {
	if value == nil || *value == "" {
		return fallback
	}
	return *value
}
func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func emptyAnalyticsState(issues []analyticsIssue) *string {
	if len(issues) > 0 {
		return nil
	}
	message := "No issues match these analytics filters. Broaden the date, status, project, or label filters to build an Insights chart."
	return &message
}
