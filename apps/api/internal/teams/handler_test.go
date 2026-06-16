package teams

import "testing"

func TestTeamKeyBase(t *testing.T) {
	if got := teamKeyBase("Linear Clone"); got != "LIN" {
		t.Fatalf("key = %q", got)
	}
	if got := teamKeyBase("123"); got != "WRK" {
		t.Fatalf("numeric key base = %q", got)
	}
}

func TestValidateKey(t *testing.T) {
	if err := validateKey("ENG"); err != nil {
		t.Fatalf("expected valid key: %v", err)
	}
	if err := validateKey("1BAD"); err == nil {
		t.Fatal("expected first-char validation failure")
	}
	if err := validateKey("TOO-LONG"); err == nil {
		t.Fatal("expected character validation failure")
	}
}

func TestParseCycleDate(t *testing.T) {
	if _, ok := parseCycleDate("2026-05-24"); !ok {
		t.Fatal("expected date-only cycle date")
	}
	if _, ok := parseCycleDate("not-a-date"); ok {
		t.Fatal("expected invalid cycle date")
	}
}

func TestEstimateOptions(t *testing.T) {
	if got := estimateOptions("not_in_use"); len(got) != 0 {
		t.Fatalf("estimates = %#v", got)
	}
	got := estimateOptions("fibonacci")
	if len(got) != 5 || got[0].Label != "1 point" || got[1].Label != "2 points" {
		t.Fatalf("estimates = %#v", got)
	}
}

func TestCreateIssueOptionStaticLists(t *testing.T) {
	if len(priorityOptions()) != 5 {
		t.Fatal("priority options drifted")
	}
	if len(dueDatePresets()) != 4 {
		t.Fatal("due date presets drifted")
	}
}

func TestDefaultWorkflowStatesIncludeTriageBeforeBacklog(t *testing.T) {
	states := defaultWorkflowStates()
	if len(states) == 0 {
		t.Fatal("default workflow states missing")
	}
	if states[0].Name != "Triage" || states[0].Category != "triage" {
		t.Fatalf("first default state = %#v", states[0])
	}
	if states[1].Name != "Backlog" || states[1].Category != "backlog" {
		t.Fatalf("second default state = %#v", states[1])
	}
	if states[0].Position >= states[1].Position {
		t.Fatalf("triage position should precede backlog: %#v", states[:2])
	}
}

func TestShouldBlockTriageStatusDelete(t *testing.T) {
	enabled := true
	disabled := false
	triageStatus := statusSummary{ID: "s-triage", Category: "triage"}
	backlogStatus := statusSummary{ID: "s-backlog", Category: "backlog"}

	if !shouldBlockTriageStatusDelete(teamRecordForSettings{TriageEnabled: &enabled}, triageStatus, false) {
		t.Fatal("triage-enabled teams should keep a triage status")
	}
	if shouldBlockTriageStatusDelete(teamRecordForSettings{TriageEnabled: &enabled}, triageStatus, true) {
		t.Fatal("teams with another triage status should allow deleting this one")
	}
	if shouldBlockTriageStatusDelete(teamRecordForSettings{TriageEnabled: &disabled}, triageStatus, false) {
		t.Fatal("triage-disabled teams should not be blocked by this guard")
	}
	if shouldBlockTriageStatusDelete(teamRecordForSettings{TriageEnabled: &enabled}, backlogStatus, false) {
		t.Fatal("non-triage statuses should not be blocked by this guard")
	}
}

func TestDuplicateIssueStatusIDDoesNotFallbackToTriage(t *testing.T) {
	statuses := map[string][]workflowStatus{
		"triage":  {{ID: "s-triage"}},
		"backlog": {{ID: "s-backlog"}},
	}
	ids := []string{"s-triage", "s-backlog"}

	if got := duplicateIssueStatusID(map[string]any{}, statuses, ids); got != "" {
		t.Fatalf("duplicate fallback = %q, want empty without canceled status", got)
	}

	statuses["canceled"] = []workflowStatus{{ID: "s-canceled"}}
	if got := duplicateIssueStatusID(map[string]any{}, statuses, ids); got != "s-canceled" {
		t.Fatalf("duplicate fallback = %q, want canceled", got)
	}

	settings := map[string]any{"duplicateIssueStatusId": "s-backlog"}
	if got := duplicateIssueStatusID(settings, statuses, ids); got != "s-backlog" {
		t.Fatalf("configured duplicate status = %q", got)
	}
}

func TestTriageDecisionRequestTracksPresentFields(t *testing.T) {
	var input triageDecisionRequest
	if err := input.UnmarshalJSON([]byte(`{"action":"accept","assigneeId":null,"labelIds":[]}`)); err != nil {
		t.Fatal(err)
	}
	if !input.hasField("assigneeId") || !input.hasField("labelIds") || input.hasField("projectId") {
		t.Fatalf("present fields = %#v", input.fieldsPresent)
	}
}

func TestApplyTriageDefaultMetadataOnlyForOmittedFields(t *testing.T) {
	settings := map[string]any{
		triageDefaultAssigneeKey: "user-default",
		triageDefaultLabelIDsKey: []any{"label-a", "label-b"},
		triageDefaultProjectKey:  "project-default",
		triageDefaultCycleKey:    "cycle-default",
	}
	input := triageDecisionRequest{fieldsPresent: map[string]bool{"assigneeId": true}, AssigneeID: nil}
	applyTriageDefaultMetadata(settings, &input)
	if input.AssigneeID != nil {
		t.Fatal("explicit null assignee should not be replaced by default")
	}
	if input.ProjectID == nil || *input.ProjectID != "project-default" || input.CycleID == nil || *input.CycleID != "cycle-default" {
		t.Fatalf("defaults not applied: %#v", input)
	}
	if len(input.LabelIDs) != 2 || input.LabelIDs[0] != "label-a" || input.LabelIDs[1] != "label-b" {
		t.Fatalf("label defaults = %#v", input.LabelIDs)
	}
}

func TestTriageSourceContextLabelsKnownSources(t *testing.T) {
	got := triageSourceContext(map[string]any{"source": "inbound_email", "sender": "customer@example.com", "title": "Need help"})
	if got["label"] != "Email" || got["sender"] != "customer@example.com" || got["title"] != "Need help" {
		t.Fatalf("source context = %#v", got)
	}
}
