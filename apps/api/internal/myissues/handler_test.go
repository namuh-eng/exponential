package myissues

import (
	"testing"
	"time"
)

func TestDedupeIssuesByIDKeepsLatestUpdatedAt(t *testing.T) {
	oldTime := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	newTime := time.Date(2026, 1, 2, 10, 0, 0, 0, time.UTC)
	issues := dedupeIssuesByID([]issueRecord{{ID: "issue-1", UpdatedAt: oldTime, Title: "old"}, {ID: "issue-1", UpdatedAt: newTime, Title: "new"}})
	if len(issues) != 1 || issues[0].Title != "new" {
		t.Fatalf("deduped issues = %#v", issues)
	}
}

func TestBuildResponseGroupsByStatusNameAcrossTeams(t *testing.T) {
	createdAt := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	updatedAt := time.Date(2026, 1, 2, 10, 0, 0, 0, time.UTC)
	assigneeID := "user-1"
	assigneeName := "Ashley"
	response := buildResponse("activity", []issueRecord{
		{ID: "issue-1", Number: 1, Identifier: "ENG-1", Title: "One", Priority: "high", StateID: "state-1", AssigneeID: &assigneeID, AssigneeName: &assigneeName, CreatedAt: createdAt, UpdatedAt: updatedAt, TeamID: "team-1"},
		{ID: "issue-2", Number: 2, Identifier: "OPS-2", Title: "Two", Priority: "low", StateID: "state-2", CreatedAt: createdAt, UpdatedAt: updatedAt, TeamID: "team-2"},
	}, []State{
		{ID: "state-1", Name: "Started", Category: "started", Color: "#00f", Position: 2},
		{ID: "state-2", Name: "Started", Category: "started", Color: "#00f", Position: 2},
	}, map[string]Team{"team-1": {ID: "team-1", Key: "ENG"}, "team-2": {ID: "team-2", Key: "OPS"}}, map[string][]Label{"issue-1": {{ID: "label-1", Name: "Bug", Color: "#f00"}}})

	if len(response.Groups) != 1 {
		t.Fatalf("groups = %#v", response.Groups)
	}
	if response.Groups[0].State.ID != "started:Started" || response.Groups[0].Issues[0].DisplayAt != updatedAt.Format(time.RFC3339) {
		t.Fatalf("bad grouped response = %#v", response.Groups[0])
	}
	if len(response.FilterOptions.Assignees) != 1 || len(response.FilterOptions.Labels) != 1 || response.FilterOptions.Statuses[0].ID != "started:Started" {
		t.Fatalf("bad filter options = %#v", response.FilterOptions)
	}
}
