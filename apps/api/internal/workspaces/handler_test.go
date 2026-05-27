package workspaces

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSanitizeSlug(t *testing.T) {
	if got := sanitizeSlug(" My Great Workspace! "); got != "my-great-workspace" {
		t.Fatalf("slug = %q", got)
	}
}

func TestValidateSlug(t *testing.T) {
	if err := validateSlug("ok-slug"); err != nil {
		t.Fatalf("expected valid slug: %v", err)
	}
	if err := validateSlug("Bad Slug"); err == nil {
		t.Fatal("expected uppercase/space slug to fail")
	}
	if err := validateSlug("x"); err == nil {
		t.Fatal("expected short slug to fail")
	}
}

func TestTeamKeyBase(t *testing.T) {
	cases := map[string]string{
		"Exponential":  "EXP",
		"Linear Clone": "LCX",
		"1 2":          "WRK",
	}
	for input, want := range cases {
		if got := teamKeyBase(input); got != want {
			t.Fatalf("teamKeyBase(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestRoles(t *testing.T) {
	if !isManager("owner") || !isManager("admin") || isManager("member") {
		t.Fatal("manager role logic drifted")
	}
	if !validRole("guest") || validInviteRole("owner") {
		t.Fatal("role validation drifted")
	}
}

func TestInvitePreviewResponseDoesNotDiscloseEmail(t *testing.T) {
	workspaceID := "workspace-1"
	payload, err := json.Marshal(invitePreviewResponse{Valid: true, WorkspaceID: &workspaceID})
	if err != nil {
		t.Fatalf("marshal preview response: %v", err)
	}
	if strings.Contains(string(payload), "email") {
		t.Fatalf("invite preview disclosed email field: %s", payload)
	}
}

func TestMemberEntryTeamsCarryStableKeys(t *testing.T) {
	teamsJSON := []byte(`[{"id":"team-1","name":"Engineering Platform","key":"ENG"}]`)
	var teams []memberTeam
	if err := json.Unmarshal(teamsJSON, &teams); err != nil {
		t.Fatalf("unmarshal teams: %v", err)
	}
	if len(teams) != 1 || teams[0].Name == teams[0].Key {
		t.Fatalf("teams should preserve distinct names and route keys: %#v", teams)
	}
}

func TestEmailDomain(t *testing.T) {
	if got := emailDomain(" Person@Example.COM "); got != "example.com" {
		t.Fatalf("domain = %q", got)
	}
	for _, input := range []string{"", "missing-at", "a@localhost", "a@bad_domain.test"} {
		if got := emailDomain(input); got != "" {
			t.Fatalf("emailDomain(%q) = %q", input, got)
		}
	}
}

func TestParseImportCSV(t *testing.T) {
	rows := parseImportCSV("Title,Status\nFix bug,Todo\n,Done")
	if len(rows) != 2 {
		t.Fatalf("rows = %#v", rows)
	}
	if rows[0].row != 2 || rows[0].get("Title") != "Fix bug" || rows[0].get("Status") != "Todo" {
		t.Fatalf("first row = %#v", rows[0])
	}
}

func TestBillingStateDefaultsAndNormalization(t *testing.T) {
	state := readBillingState(map[string]any{"billing": map[string]any{"plan": "standard", "issuesUsed": float64(99)}})
	if state.plan != "business" || state.issuesUsed != 99 || state.usageLimit != 250 {
		t.Fatalf("state = %#v", state)
	}
	if len(state.paymentMethods) != 1 || len(state.invoices) != 1 {
		t.Fatalf("defaults missing = %#v", state)
	}
}

func TestNormalizeWorkspaceDocuments(t *testing.T) {
	settings := map[string]any{"documents": map[string]any{"defaultVisibility": "private", "autoLinkProjectDocuments": false, "templates": []any{map[string]any{"id": "tpl_1", "name": "Spec", "description": "Template"}, map[string]any{"id": "bad"}}}}
	got := normalizeWorkspaceDocuments(settings)
	if got.DefaultVisibility != "private" || got.AutoLinkProjectDocuments || len(got.Templates) != 1 {
		t.Fatalf("documents = %#v", got)
	}
}

func TestReadAndMergeCollaborationSettings(t *testing.T) {
	settings := map[string]any{"collaboration": map[string]any{"asks": map[string]any{"enabled": true, "intakeEmail": "help@example.com"}, "pulse": map[string]any{"digestFrequency": "daily", "velocityTarget": float64(20)}}}
	got := readCollaborationSettings(settings)
	if !got.Asks.Enabled || got.Asks.DefaultPriority != "medium" || got.Pulse.VelocityTarget != 20 {
		t.Fatalf("collaboration = %#v", got)
	}
	merged := mergeCollaborationSettings(settings, map[string]any{"asks": map[string]any{"defaultPriority": "urgent"}, "pulse": map[string]any{"velocityTarget": float64(55)}})
	next := readCollaborationSettings(map[string]any{"collaboration": merged})
	if next.Asks.DefaultPriority != "urgent" || next.Pulse.VelocityTarget != 55 {
		t.Fatalf("merged = %#v", next)
	}
}

func TestReadAndPatchInitiativeSettings(t *testing.T) {
	settings := map[string]any{"features": map[string]any{"initiatives": map[string]any{"enabled": false, "visibility": "teams"}}}
	got := readInitiativeSettings(settings)
	if got.Enabled || got.Visibility != "teams" || !got.ProjectRollups || got.RoadmapMode != "all" {
		t.Fatalf("settings = %#v", got)
	}
	patched, err := patchInitiativeSettings(got, map[string]any{"roadmapMode": "selected", "projectRollups": false})
	if err != nil || patched.RoadmapMode != "selected" || patched.ProjectRollups {
		t.Fatalf("patched = %#v err=%v", patched, err)
	}
	if _, err := patchInitiativeSettings(got, map[string]any{"visibility": "private"}); err == nil {
		t.Fatal("invalid visibility should fail")
	}
}

func TestReadAndPatchWorkspaceAISettings(t *testing.T) {
	settings := map[string]any{"ai": map[string]any{"workspaceAgentGuidance": " Existing policy ", "agentUsagePermission": "admins"}}
	got := readWorkspaceAISettings(settings)
	if got.WorkspaceAgentGuidance != "Existing policy" || got.AgentUsagePermission != "admins" || !got.AIFeaturesEnabled {
		t.Fatalf("ai = %#v", got)
	}
	patched := patchAISettings(got, map[string]any{"aiFeaturesEnabled": false, "workspaceAgentGuidance": "New", "agentUsagePermission": "members"})
	if patched.AIFeaturesEnabled || patched.WorkspaceAgentGuidance != "New" || patched.AgentUsagePermission != "members" {
		t.Fatalf("patched = %#v", patched)
	}
}

func TestReadAndNormalizeSLASettings(t *testing.T) {
	priority := "urgent"
	settings := map[string]any{"sla": map[string]any{"policies": []any{map[string]any{"id": "sla-1", "name": "Urgent", "responseTimeHours": float64(2), "resolutionTimeHours": float64(8), "conditions": map[string]any{"priority": priority, "teamKey": "eng"}, "createdAt": "2026-05-01T00:00:00Z", "updatedAt": "2026-05-01T00:00:00Z"}}}}
	got := readSLASettings(settings)
	if len(got.Policies) != 1 || got.Policies[0].Name != "Urgent" || got.Policies[0].Conditions.TeamKey == nil || *got.Policies[0].Conditions.TeamKey != "ENG" {
		t.Fatalf("sla = %#v", got)
	}
	if _, err := normalizeSLAPolicyInput(map[string]any{"name": "Bad", "responseTimeHours": float64(10), "resolutionTimeHours": float64(2)}); err == nil {
		t.Fatal("response target above resolution should fail")
	}
}

func TestApplicationScopesAndPermissionGroups(t *testing.T) {
	scopes := normalizeApplicationScopes([]byte(`["issues:read","custom.scope"]`))
	if len(scopes) != 2 || scopes[0] != "issues:read" {
		t.Fatalf("scopes = %#v", scopes)
	}
	groups := buildApplicationPermissionGroups(scopes)
	if len(groups) != 2 || groups[0].Label != "Issues" || groups[1].Descriptions[0] != "Custom Scope" {
		t.Fatalf("groups = %#v", groups)
	}
}

func TestSAMLAndSCIMSettingsHelpers(t *testing.T) {
	saml := normalizeSAMLInput(map[string]any{"enabled": true, "domains": []any{"Example.com"}, "idpSsoUrl": "https://idp.example.com/sso", "entityId": "entity", "certificate": "CERT", "test": true}, readSAMLSettings(map[string]any{}))
	if validation := validateSAMLSettings(saml); validation != "" {
		t.Fatalf("unexpected validation: %s", validation)
	}
	if saml.Status != "verified" || len(saml.Domains) != 1 || saml.Domains[0] != "example.com" {
		t.Fatalf("saml = %#v", saml)
	}
	secret, token := createSCIMToken("Okta")
	if !strings.HasPrefix(secret, "scim_") || token.TokenHash == "" || token.TokenHash == secret {
		t.Fatalf("secret/token = %q %#v", secret, token)
	}
	public := publicToken(token)
	if public.ID != token.ID || public.Name != "Okta" {
		t.Fatalf("public token = %#v", public)
	}
}
