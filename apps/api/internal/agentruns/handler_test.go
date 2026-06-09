package agentruns

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildGuidanceMergesSources(t *testing.T) {
	guidance := buildGuidance("Workspace: cite evidence.", "Account: small diffs.", "ENG: test plan.", true, "eng")
	if len(guidance.Entries) != 3 || guidance.EffectiveInstructions == "" || !guidance.AutoFixEnabled || guidance.TeamKey == nil || *guidance.TeamKey != "ENG" {
		t.Fatalf("guidance = %#v", guidance)
	}
}

func TestGuidanceEntryJSONMatchesOpenAPIContract(t *testing.T) {
	payload, err := json.Marshal(buildGuidance("Workspace: cite evidence.", "", "", false, "eng"))
	if err != nil {
		t.Fatal(err)
	}
	body := string(payload)
	for _, field := range []string{`"source"`, `"label"`, `"instructions"`} {
		if !strings.Contains(body, field) {
			t.Fatalf("guidance payload missing %s: %s", field, body)
		}
	}
	for _, field := range []string{`"Source"`, `"Label"`, `"Instructions"`} {
		if strings.Contains(body, field) {
			t.Fatalf("guidance payload leaked Go field %s: %s", field, body)
		}
	}
}

func TestCanPerformAgentPermission(t *testing.T) {
	if !canPerform("admin", "admins") || canPerform("member", "admins") || !canPerform("member", "members") || canPerform("guest", "members") {
		t.Fatal("permission matrix mismatch")
	}
}

func TestContextHrefResolvesIssuesProjectsAndSearch(t *testing.T) {
	if got := contextHref("fix ENG-123", "ENG"); got != "/team/ENG/issue/ENG-123" {
		t.Fatalf("issue href = %q", got)
	}
	if got := contextHref("project: Platform Polish", "ENG"); got != "/project/platform-polish/overview" {
		t.Fatalf("project href = %q", got)
	}
	if got := contextHref("loose context", "ENG"); got != "/search?q=loose+context" {
		t.Fatalf("search href = %q", got)
	}
}

func TestCreateRunPrependsWorkspaceRun(t *testing.T) {
	workspaceID := "workspace-test"
	mu.Lock()
	delete(runsByWorkspace, workspaceID)
	mu.Unlock()
	run := createRun(workspaceID, request{Title: "Investigate", Prompt: "Inspect this issue", TeamKey: "ENG", Context: "ENG-1"}, "Ashley", buildGuidance("", "", "", false, "ENG"))
	if run.Status != "queued" || run.Owner != "Ashley" || run.Suggestions[0].ContextURL != "/team/ENG/issue/ENG-1" {
		t.Fatalf("run = %#v", run)
	}
	if runs := listRuns(workspaceID); len(runs) != 2 || runs[0].ID != run.ID {
		t.Fatalf("runs = %#v", runs)
	}
}
