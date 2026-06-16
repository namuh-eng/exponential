package workspaces

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestJiraCredentialValidation(t *testing.T) {
	_, err := readJiraCredentialInput(map[string]any{"deployment": "cloud", "baseUrl": "https://acme.atlassian.net", "token": "secret"})
	if err == nil || !strings.Contains(err.Error(), "email") {
		t.Fatalf("expected cloud email validation, got %v", err)
	}
	credential, err := readJiraCredentialInput(map[string]any{"deployment": "server", "baseUrl": "https://jira.example.com/", "token": "pat"})
	if err != nil {
		t.Fatalf("server credential should be valid: %v", err)
	}
	if credential.BaseURL != "https://jira.example.com" || credential.Deployment != "server" {
		t.Fatalf("credential normalized incorrectly: %#v", credential)
	}
}

func TestJiraClientUsesServerBearerAndBuildsPreview(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer pat-token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/rest/api/2/project":
			_, _ = w.Write([]byte(`[{"id":"100","key":"ENG","name":"Engineering"}]`))
		case "/rest/api/2/search":
			if r.URL.Query().Get("jql") != `project = "ENG" ORDER BY created ASC` {
				t.Fatalf("jql = %q", r.URL.Query().Get("jql"))
			}
			_, _ = w.Write([]byte(`{"startAt":0,"total":1,"issues":[{"id":"10001","key":"ENG-1","fields":{"summary":"Ship importer","description":"Move Jira issues","status":{"id":"1","name":"To Do"},"priority":{"id":"2","name":"High"},"assignee":{"displayName":"Ada"},"labels":["migration"],"project":{"id":"100","key":"ENG","name":"Engineering"},"comment":{"comments":[{"id":"c1","body":"Looks good","author":{"displayName":"Ada"}}]}}}]}`))
		default:
			t.Fatalf("unexpected path = %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := jiraClient{credential: jiraCredential{Deployment: "server", BaseURL: server.URL, Token: "pat-token"}, client: server.Client()}
	projects, err := client.projects(t.Context())
	if err != nil || len(projects) != 1 || projects[0].Key != "ENG" {
		t.Fatalf("projects = %#v err=%v", projects, err)
	}
	issues, err := client.issues(t.Context(), "ENG", 50)
	if err != nil || len(issues) != 1 {
		t.Fatalf("issues = %#v err=%v", issues, err)
	}
	preview, statuses := buildJiraPreview(client.credential, issues)
	if len(preview) != 1 || preview[0].Key != "ENG-1" || preview[0].CommentCount != 1 || preview[0].SourceURL != server.URL+"/browse/ENG-1" {
		t.Fatalf("preview = %#v", preview)
	}
	if len(statuses) != 1 || statuses[0] != "To Do" {
		t.Fatalf("statuses = %#v", statuses)
	}
}

func TestJiraTextValueExtractsAtlassianDocumentText(t *testing.T) {
	input := map[string]any{"content": []any{map[string]any{"content": []any{map[string]any{"text": "Line one"}}}, map[string]any{"content": []any{map[string]any{"text": "Line two"}}}}}
	if got := jiraTextValue(input); got != "Line one\nLine two" {
		t.Fatalf("text = %q", got)
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

func TestValidatedOAuthRedirectsRejectsUnsafeURLs(t *testing.T) {
	_, err := validatedOAuthRedirects(workspaceAPIAction{RedirectURLs: []any{"http://example.com/callback"}})
	if err == nil || !strings.Contains(err.Error(), "HTTPS") {
		t.Fatalf("expected HTTPS validation error, got %v", err)
	}
	_, err = validatedOAuthRedirects(workspaceAPIAction{RedirectURL: "https://localhost/callback"})
	if err == nil || !strings.Contains(err.Error(), "localhost") {
		t.Fatalf("expected localhost validation error, got %v", err)
	}
	got, err := validatedOAuthRedirects(workspaceAPIAction{RedirectURLs: []any{"https://example.com/callback", "https://example.com/callback"}})
	if err != nil || len(got) != 1 || got[0] != "https://example.com/callback" {
		t.Fatalf("redirects = %#v err=%v", got, err)
	}
}

func TestValidatedOAuthScopes(t *testing.T) {
	got, err := validatedOAuthScopes([]any{"read", "read", "issues:write"})
	if err != nil || len(got) != 2 || got[0] != "read" || got[1] != "issues:write" {
		t.Fatalf("scopes = %#v err=%v", got, err)
	}
	if _, err := validatedOAuthScopes([]any{"admin"}); err == nil {
		t.Fatal("unsupported scope should fail")
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
