package issues

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type bulkRequest struct {
	IssueIDs []string    `json:"issueIds"`
	Updates  bulkUpdates `json:"updates"`
}

type bulkUpdates struct {
	StateID    *string  `json:"stateId"`
	AssigneeID *string  `json:"assigneeId"`
	Priority   *string  `json:"priority"`
	LabelIDs   []string `json:"labelIds"`
	ProjectID  *string  `json:"projectId"`
	CycleID    *string  `json:"cycleId"`
	DueDate    *string  `json:"dueDate"`
	Archive    *bool    `json:"archive"`
	Delete     bool     `json:"delete"`
}

type selectedBulkIssue struct{ ID, Identifier, TeamID string }

func (h Handler) Bulk(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input bulkRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	issueIDs := uniqueNonEmpty(input.IssueIDs)
	if len(issueIDs) == 0 {
		problem.JSON(w, 400, map[string]string{"error": "Select at least one issue"})
		return
	}
	if len(issueIDs) > 200 {
		problem.JSON(w, 400, map[string]string{"error": "Bulk updates are limited to 200 issues"})
		return
	}
	for _, issueID := range issueIDs {
		if _, err := uuid.Parse(issueID); err != nil {
			problem.JSON(w, 400, map[string]string{"error": "One or more issues were not found"})
			return
		}
	}
	selected, err := h.selectedBulkIssues(r, p.WorkspaceID, issueIDs)
	if err != nil {
		problem.Write(w, 500, "Load issues failed", err.Error())
		return
	}
	if len(selected) != len(issueIDs) {
		problem.JSON(w, 404, map[string]string{"error": "One or more issues were not found"})
		return
	}
	teamIDs := uniqueIssueTeamIDs(selected)
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Bulk update failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	changed, errMsg := h.validateBulkUpdates(r, tx, p.WorkspaceID, teamIDs, &input.Updates)
	if errMsg != "" {
		problem.JSON(w, 400, map[string]string{"error": errMsg})
		return
	}
	if input.Updates.Delete {
		if _, err := tx.Exec(r.Context(), `delete from issue where id = any($1::uuid[])`, issueIDs); err != nil {
			problem.Write(w, 500, "Bulk delete failed", err.Error())
			return
		}
	} else if err := applyIssueUpdate(r, tx, issueIDs, input.Updates); err != nil {
		problem.Write(w, 500, "Bulk update failed", err.Error())
		return
	}
	if input.Updates.LabelIDs != nil {
		if err := replaceBulkLabels(r, tx, issueIDs, input.Updates.LabelIDs); err != nil {
			problem.Write(w, 500, "Bulk labels failed", err.Error())
			return
		}
	}
	for _, issue := range selected {
		payload := map[string]any{"id": issue.ID, "identifier": issue.Identifier, "changedFields": changed, "bulk": true}
		if err := insertOperation(r.Context(), tx, p.WorkspaceID, "issue", issue.ID, "updated", payload, p.UserID); err != nil {
			problem.Write(w, 500, "Record bulk operation failed", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Bulk update failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]int{"updatedCount": len(selected)})
}

func (h Handler) selectedBulkIssues(r *http.Request, workspaceID string, issueIDs []string) ([]selectedBulkIssue, error) {
	rows, err := h.DB.Query(r.Context(), `select i.id::text, i.identifier, i.team_id::text from issue i join team t on t.id=i.team_id where i.id = any($1::uuid[]) and t.workspace_id=$2::uuid`, issueIDs, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []selectedBulkIssue{}
	for rows.Next() {
		var item selectedBulkIssue
		if err := rows.Scan(&item.ID, &item.Identifier, &item.TeamID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (h Handler) validateBulkUpdates(r *http.Request, q RelationshipQueryer, workspaceID string, teamIDs []string, updates *bulkUpdates) ([]string, string) {
	changed := []string{}
	if updates.StateID != nil {
		if strings.TrimSpace(*updates.StateID) == "" {
			return nil, "Status is required"
		}
		if _, err := uuid.Parse(strings.TrimSpace(*updates.StateID)); err != nil {
			return nil, "Workflow state not found for selected issues"
		}
		*updates.StateID = strings.TrimSpace(*updates.StateID)
		var teamID, category string
		if err := q.QueryRow(r.Context(), `select team_id::text, category from workflow_state where id=$1::uuid for share`, *updates.StateID).Scan(&teamID, &category); err != nil || !allTeamsEqual(teamIDs, teamID) {
			return nil, "Workflow state not found for selected issues"
		}
		_ = category
		changed = append(changed, "stateId")
	}
	if updates.AssigneeID != nil {
		if *updates.AssigneeID != "" {
			var one int
			if err := q.QueryRow(r.Context(), `select 1 from member where workspace_id=$1::uuid and user_id=$2 limit 1 for share`, workspaceID, *updates.AssigneeID).Scan(&one); err != nil {
				return nil, "Assignee is not a workspace member"
			}
		}
		changed = append(changed, "assigneeId")
	}
	if updates.Priority != nil {
		next := *updates.Priority
		if next == "" {
			next = "none"
		}
		if !validPriority(next) {
			return nil, "Invalid priority"
		}
		changed = append(changed, "priority")
	}
	if updates.ProjectID != nil {
		projectID := nullableID(updates.ProjectID)
		if _, err := NormalizeProjectMilestoneRelationship(r.Context(), q, workspaceID, projectID, nil); err != nil {
			return nil, err.Title()
		}
		updates.ProjectID = stringPtrFromNullable(projectID)
		changed = append(changed, "projectId")
	}
	if updates.CycleID != nil {
		cycleID := nullableID(updates.CycleID)
		if cycleID != nil {
			var teamID string
			if err := q.QueryRow(r.Context(), `select team_id::text from cycle where id=$1::uuid for share`, *cycleID).Scan(&teamID); err != nil || !allTeamsEqual(teamIDs, teamID) {
				return nil, "Cycle not found for selected issues"
			}
		}
		updates.CycleID = stringPtrFromNullable(cycleID)
		changed = append(changed, "cycleId")
	}
	if updates.DueDate != nil {
		if *updates.DueDate != "" {
			if _, err := time.Parse("2006-01-02", *updates.DueDate); err != nil {
				return nil, "Invalid due date"
			}
		}
		changed = append(changed, "dueDate")
	}
	if updates.Archive != nil {
		changed = append(changed, "archivedAt")
	}
	if updates.LabelIDs != nil {
		updates.LabelIDs = uniqueNonEmpty(updates.LabelIDs)
		if err := ValidateLabelsForTeams(r.Context(), q, workspaceID, teamIDs, updates.LabelIDs); err != nil {
			return nil, err.Title()
		}
		changed = append(changed, "labelIds")
	}
	return changed, ""
}

func applyIssueUpdate(r *http.Request, tx pgx.Tx, issueIDs []string, updates bulkUpdates) error {
	sets := []string{"updated_at=now()"}
	args := []any{issueIDs}
	n := 2
	if updates.StateID != nil {
		sets = append(sets, "state_id=$"+itoaSimple(n)+"::uuid")
		args = append(args, *updates.StateID)
		n++
	}
	if updates.AssigneeID != nil {
		if *updates.AssigneeID == "" {
			sets = append(sets, "assignee_id=null")
		} else {
			sets = append(sets, "assignee_id=$"+itoaSimple(n))
			args = append(args, *updates.AssigneeID)
			n++
		}
	}
	if updates.Priority != nil {
		pr := *updates.Priority
		if pr == "" {
			pr = "none"
		}
		sets = append(sets, "priority=$"+itoaSimple(n))
		args = append(args, pr)
		n++
	}
	if updates.ProjectID != nil {
		if *updates.ProjectID == "" {
			sets = append(sets, "project_id=null", "project_milestone_id=null")
		} else {
			sets = append(sets, "project_id=$"+itoaSimple(n)+"::uuid")
			args = append(args, *updates.ProjectID)
			n++
			sets = append(sets, "project_milestone_id=null")
		}
	}
	if updates.CycleID != nil {
		if *updates.CycleID == "" {
			sets = append(sets, "cycle_id=null")
		} else {
			sets = append(sets, "cycle_id=$"+itoaSimple(n)+"::uuid")
			args = append(args, *updates.CycleID)
			n++
		}
	}
	if updates.DueDate != nil {
		if *updates.DueDate == "" {
			sets = append(sets, "due_date=null")
		} else {
			sets = append(sets, "due_date=$"+itoaSimple(n))
			args = append(args, *updates.DueDate)
			n++
		}
	}
	if updates.Archive != nil {
		if *updates.Archive {
			sets = append(sets, "archived_at=now()")
		} else {
			sets = append(sets, "archived_at=null")
		}
	}
	_, err := tx.Exec(r.Context(), `update issue set `+strings.Join(sets, ",")+` where id = any($1::uuid[])`, args...)
	return err
}

func replaceBulkLabels(r *http.Request, tx pgx.Tx, issueIDs []string, labelIDs []string) error {
	if _, err := tx.Exec(r.Context(), `delete from issue_label where issue_id = any($1::uuid[])`, issueIDs); err != nil {
		return err
	}
	values := []string{}
	args := []any{}
	for _, issueID := range issueIDs {
		for _, labelID := range uniqueNonEmpty(labelIDs) {
			args = append(args, issueID, labelID)
			values = append(values, "($"+itoaSimple(len(args)-1)+"::uuid,$"+itoaSimple(len(args))+"::uuid)")
		}
	}
	if len(values) == 0 {
		return nil
	}
	_, err := tx.Exec(r.Context(), `insert into issue_label (issue_id,label_id) values `+strings.Join(values, ","), args...)
	return err
}

func uniqueNonEmpty(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
func uniqueIssueTeamIDs(values []selectedBulkIssue) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range values {
		if !seen[v.TeamID] {
			seen[v.TeamID] = true
			out = append(out, v.TeamID)
		}
	}
	return out
}
func allTeamsEqual(values []string, expected string) bool {
	for _, v := range values {
		if v != expected {
			return false
		}
	}
	return true
}
func containsString(values []string, expected string) bool {
	for _, v := range values {
		if v == expected {
			return true
		}
	}
	return false
}
func stringPtrFromNullable(value *string) *string {
	if value == nil {
		empty := ""
		return &empty
	}
	return value
}
func itoaSimple(v int) string {
	if v == 0 {
		return "0"
	}
	digits := []byte{}
	for v > 0 {
		digits = append([]byte{byte('0' + v%10)}, digits...)
		v /= 10
	}
	return string(digits)
}
