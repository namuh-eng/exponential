package views

import "testing"

func TestNormalizeViewFilterStateKeepsValidIssueDisplayOptions(t *testing.T) {
	state := NormalizeViewFilterState(map[string]any{
		"entityType": "issues",
		"scope":      "team",
		"issueFilters": []any{
			map[string]any{"type": "status", "operator": "is", "values": []any{"started"}},
			map[string]any{"type": "bad", "operator": "contains", "values": []any{"x"}},
		},
		"issueDisplayOptions": map[string]any{"groupBy": "assignee", "orderBy": "updated", "showEmptyColumns": true},
	}, "team-1")

	if state.EntityType != "issues" || state.Scope != "team" {
		t.Fatalf("unexpected state scope: %#v", state)
	}
	if len(state.IssueFilters) != 1 || state.IssueFilters[0].Type != "status" {
		t.Fatalf("filters not normalized: %#v", state.IssueFilters)
	}
	if state.IssueDisplayOptions.GroupBy != "assignee" || state.IssueDisplayOptions.OrderBy != "updated" || !state.IssueDisplayOptions.ShowEmptyColumns {
		t.Fatalf("display options not preserved: %#v", state.IssueDisplayOptions)
	}
}

func TestNormalizeViewFilterStateDefaultsProjectOptions(t *testing.T) {
	state := NormalizeViewFilterState(map[string]any{
		"entityType":          "projects",
		"projectStatusFilter": "bogus",
		"projectSortBy":       "name-asc",
		"projectDisplayOptions": map[string]any{
			"groupBy":           "lead",
			"visibleProperties": map[string]any{"lead": false},
		},
	}, "")

	if state.EntityType != "projects" || state.Scope != "workspace" {
		t.Fatalf("unexpected project state: %#v", state)
	}
	if state.ProjectStatusFilter != "all" || state.ProjectSortBy != "name-asc" {
		t.Fatalf("project filters not normalized: %#v", state)
	}
	if state.ProjectDisplayOptions.GroupBy != "lead" || state.ProjectDisplayOptions.VisibleProperties["lead"] || !state.ProjectDisplayOptions.VisibleProperties["team"] {
		t.Fatalf("project display options not normalized: %#v", state.ProjectDisplayOptions)
	}
}

func TestNormalizeLayoutForcesProjectViewsToList(t *testing.T) {
	if got := normalizeLayout("timeline", "projects", "board"); got != "list" {
		t.Fatalf("project layout = %q", got)
	}
	if got := normalizeLayout("timeline", "issues", "list"); got != "timeline" {
		t.Fatalf("issue layout = %q", got)
	}
}
