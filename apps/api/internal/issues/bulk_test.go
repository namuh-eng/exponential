package issues

import "testing"

func TestUniqueNonEmptyDedupesBulkIDs(t *testing.T) {
	got := uniqueNonEmpty([]string{" issue-1 ", "", "issue-1", "issue-2"})
	if len(got) != 2 || got[0] != "issue-1" || got[1] != "issue-2" {
		t.Fatalf("ids = %#v", got)
	}
}

func TestBulkHelpers(t *testing.T) {
	issues := []selectedBulkIssue{{TeamID: "team-1"}, {TeamID: "team-2"}, {TeamID: "team-1"}}
	teams := uniqueIssueTeamIDs(issues)
	if len(teams) != 2 || !containsString(teams, "team-2") || allTeamsEqual(teams, "team-1") {
		t.Fatalf("teams = %#v", teams)
	}
	if itoaSimple(123) != "123" {
		t.Fatalf("itoa = %q", itoaSimple(123))
	}
}
