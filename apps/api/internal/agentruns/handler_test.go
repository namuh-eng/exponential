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

func TestBuildRunFailsWithProviderDisabled(t *testing.T) {
	provider := providerStatus{Configured: false, Reason: "AI provider is not configured"}
	run := buildRun(request{Title: "Investigate", Prompt: "Inspect this issue", TeamKey: "ENG", Context: "ENG-1"}, "Ashley", buildGuidance("", "", "", false, "ENG"), contextSnapshot{Type: "issue", Identifier: "ENG-1", Title: "Broken inbox", TeamKey: "ENG", State: "Triage", Priority: "high"}, provider)
	if run.Status != "failed" || run.FailureReason == nil || !strings.Contains(run.Output, "provider") || len(run.Suggestions) != 0 {
		t.Fatalf("run = %#v", run)
	}
}

func TestBuildRunCreatesWorkspaceDerivedIssueSuggestion(t *testing.T) {
	run := buildRun(request{Title: "Investigate", Prompt: "Summarize customer impact and propose next issue update", TeamKey: "ENG", Context: "ENG-1"}, "Ashley", buildGuidance("Cite workspace evidence.", "", "", false, "ENG"), contextSnapshot{Type: "issue", Identifier: "ENG-1", Title: "Broken inbox", Description: "Unread count is stale", TeamKey: "ENG", State: "Triage", Priority: "high", Assignee: "Riley"}, providerStatus{Configured: true, Provider: "workspace", Model: "workspace-summarizer"})
	if run.Status != "needs_review" || len(run.Suggestions) != 1 {
		t.Fatalf("run = %#v", run)
	}
	if run.Suggestions[0].Target != "ENG-1" || run.Suggestions[0].ContextURL != "/team/ENG/issue/ENG-1" {
		t.Fatalf("suggestion = %#v", run.Suggestions[0])
	}
	if !strings.Contains(run.Output, "Broken inbox") || !strings.Contains(run.Output, "workspace/workspace-summarizer") {
		t.Fatalf("output = %q", run.Output)
	}
}

func TestReviewSuggestionRecordsReviewerAndDecision(t *testing.T) {
	now := "2026-06-17T12:00:00Z"
	reviewer := "Ashley"
	suggestion := suggestion("suggestion-1", "Propose update", "Update the issue summary.", "ENG-1", "ENG")
	suggestion.Status = "accepted"
	suggestion.ReviewedBy = &reviewer
	suggestion.ReviewedAt = &now
	payload, err := json.Marshal(suggestion)
	if err != nil {
		t.Fatal(err)
	}
	body := string(payload)
	for _, field := range []string{`"status":"accepted"`, `"reviewedBy":"Ashley"`, `"reviewedAt":"2026-06-17T12:00:00Z"`} {
		if !strings.Contains(body, field) {
			t.Fatalf("review payload missing %s: %s", field, body)
		}
	}
}

func TestBuildExternalActionRunProposesIssueWithSourceContext(t *testing.T) {
	mappedUserID := "user-1"
	source := SourceContext{
		Provider:               "slack",
		WorkspaceIntegrationID: "11111111-1111-4111-8111-111111111111",
		ExternalTeamID:         "T123",
		ExternalChannelID:      "C123",
		ExternalThreadID:       "1718123456.000100",
		Permalink:              "https://acme.slack.com/archives/C123/p1718123456000100",
		Metadata:               map[string]any{"token": "[redacted]", "locale": "en-US"},
		Actor:                  SourceActor{ExternalID: "U123", DisplayName: "Riley", MappedUserID: &mappedUserID},
	}
	run, snapshot := buildExternalActionRun(externalActionRequest{Action: "propose_issue", Prompt: "Customer is blocked on exports; propose the right issue.", TeamKey: "ENG", Source: source}, "Riley", buildGuidance("Cite sources.", "", "", false, "ENG"), providerStatus{Configured: true, Provider: "workspace", Model: "workspace-summarizer"})
	if run.Status != "needs_review" || len(run.Suggestions) != 1 {
		t.Fatalf("run = %#v", run)
	}
	if run.SourceContext == nil || run.SourceContext.Provider != "slack" || snapshot.Source == nil || snapshot.Source.ExternalThreadID == "" {
		t.Fatalf("source not captured: run=%#v snapshot=%#v", run.SourceContext, snapshot.Source)
	}
	if !run.Suggestions[0].IsExternalContext || run.Suggestions[0].ContextURL != source.Permalink {
		t.Fatalf("suggestion = %#v", run.Suggestions[0])
	}
	if !strings.Contains(run.Output, "Slack") || !strings.Contains(run.Output, "Riley") {
		t.Fatalf("output = %q", run.Output)
	}
}

func TestBuildExternalActionRunFailsWithProviderDisabled(t *testing.T) {
	source := SourceContext{Provider: "zendesk", ExternalTicketID: "123", Actor: SourceActor{ExternalID: "agent-1"}}
	reason := "AI provider is not configured"
	run, _ := buildExternalActionRun(externalActionRequest{Action: "propose_issue", Prompt: "Propose an issue from this ticket.", TeamKey: "ENG", Source: source}, "Support Agent", buildGuidance("", "", "", false, "ENG"), providerStatus{Configured: false, Reason: reason})
	if run.Status != "failed" || run.FailureReason == nil || *run.FailureReason != reason || len(run.Suggestions) != 0 {
		t.Fatalf("run = %#v", run)
	}
}

func TestNormalizeExternalActionRedactsMetadataAndAliasesProvider(t *testing.T) {
	mappedUserID := " user-1 "
	input := normalizeExternalActionRequest(externalActionRequest{Action: " Propose_Issue ", TeamKey: " eng ", Source: SourceContext{Provider: "Teams", Metadata: map[string]any{"botToken": "secret", "ticketId": "123"}, Actor: SourceActor{MappedUserID: &mappedUserID}}})
	if input.Action != "propose_issue" || input.TeamKey != "ENG" || input.Source.Provider != "microsoft_teams" {
		t.Fatalf("normalized = %#v", input)
	}
	if input.Source.Metadata["botToken"] != "[redacted]" || input.Source.Metadata["ticketId"] != "123" {
		t.Fatalf("metadata = %#v", input.Source.Metadata)
	}
	if input.Source.Actor.MappedUserID == nil || *input.Source.Actor.MappedUserID != "user-1" {
		t.Fatalf("mapped user = %#v", input.Source.Actor.MappedUserID)
	}
}
