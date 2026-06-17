package integrations

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestSetupRequirement(t *testing.T) {
	t.Setenv("AUTH_SLACK_ID", "")
	t.Setenv("AUTH_SLACK_SECRET", "")
	if got := setupRequirement("slack"); got == nil || got.Type != "configuration_required" {
		t.Fatalf("slack requirement = %#v", got)
	}
	t.Setenv("AUTH_SLACK_ID", "id")
	t.Setenv("AUTH_SLACK_SECRET", "secret")
	if got := setupRequirement("slack"); got != nil {
		t.Fatalf("configured slack requirement = %#v", got)
	}
	t.Setenv("AUTH_DISCORD_ID", "")
	t.Setenv("AUTH_DISCORD_SECRET", "")
	t.Setenv("DISCORD_PUBLIC_KEY", "")
	if got := setupRequirement("discord"); got == nil || got.Type != "configuration_required" {
		t.Fatalf("discord requirement = %#v", got)
	}
	t.Setenv("AUTH_DISCORD_ID", "id")
	t.Setenv("AUTH_DISCORD_SECRET", "secret")
	t.Setenv("DISCORD_PUBLIC_KEY", strings.Repeat("a", 64))
	if got := setupRequirement("discord"); got != nil {
		t.Fatalf("configured discord requirement = %#v", got)
	}
	t.Setenv("AUTH_MICROSOFT_ID", "")
	t.Setenv("AUTH_MICROSOFT_SECRET", "")
	t.Setenv("MICROSOFT_TEAMS_BOT_SECRET", "")
	if got := setupRequirement("microsoft_teams"); got == nil || got.Type != "configuration_required" {
		t.Fatalf("microsoft teams requirement = %#v", got)
	}
	t.Setenv("AUTH_MICROSOFT_ID", "id")
	t.Setenv("AUTH_MICROSOFT_SECRET", "secret")
	t.Setenv("MICROSOFT_TEAMS_BOT_SECRET", "bot-secret")
	if got := setupRequirement("microsoft_teams"); got != nil {
		t.Fatalf("configured microsoft teams requirement = %#v", got)
	}
	t.Setenv("AUTH_INTERCOM_ID", "")
	t.Setenv("AUTH_INTERCOM_SECRET", "")
	t.Setenv("INTERCOM_SIGNING_SECRET", "")
	if got := setupRequirement("intercom"); got == nil || got.Type != "configuration_required" {
		t.Fatalf("intercom requirement = %#v", got)
	}
	t.Setenv("AUTH_INTERCOM_ID", "id")
	t.Setenv("AUTH_INTERCOM_SECRET", "secret")
	t.Setenv("INTERCOM_SIGNING_SECRET", "signing-secret")
	if got := setupRequirement("intercom"); got != nil {
		t.Fatalf("configured intercom requirement = %#v", got)
	}
	if got := setupRequirement("github"); got == nil || got.Message == "" {
		t.Fatalf("github requirement = %#v", got)
	}
	if got := setupRequirement("jira"); got == nil || !strings.Contains(got.Message, "Jira") {
		t.Fatalf("jira requirement = %#v", got)
	}
}

func TestCanManage(t *testing.T) {
	if !canManage("owner") || !canManage("admin") || canManage("member") {
		t.Fatal("integration role permissions drifted")
	}
}

func TestIntegrationActions(t *testing.T) {
	if got := integrationActions(true, false, "not_connected", nil); !got.CanConnect || got.CanReconnect || got.CanDisconnect {
		t.Fatalf("not connected actions = %#v", got)
	}
	if got := integrationActions(true, true, "revoked", nil); !got.CanReconnect || got.CanDisconnect {
		t.Fatalf("revoked actions = %#v", got)
	}
	if got := integrationActions(false, true, "connected", nil); got.CanManage || got.CanDisconnect {
		t.Fatalf("member actions = %#v", got)
	}
}

func TestFormatTime(t *testing.T) {
	if formatTime(nil) != nil {
		t.Fatal("nil time should stay nil")
	}
	value := time.Date(2026, 5, 24, 1, 2, 3, 0, time.UTC)
	got := formatTime(&value)
	if got == nil || *got != "2026-05-24T01:02:03Z" {
		t.Fatalf("formatted = %#v", got)
	}
}

func TestSlackAuthorizationURL(t *testing.T) {
	got := slackAuthorizationURL("client", "https://app.example/", "state-token")
	if !strings.HasPrefix(got, "https://slack.com/oauth/v2/authorize?") {
		t.Fatalf("unexpected URL = %q", got)
	}
	if !strings.Contains(got, "client_id=client") || !strings.Contains(got, "state=state-token") {
		t.Fatalf("missing query params = %q", got)
	}
	if !strings.Contains(got, "links%3Aread") || !strings.Contains(got, "links%3Awrite") || !strings.Contains(got, "channels%3Ahistory") {
		t.Fatalf("missing Slack thread/unfurl scopes = %q", got)
	}
	if !strings.Contains(got, "redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fintegrations%2Fslack%2Foauth%2Fcallback") {
		t.Fatalf("missing redirect uri = %q", got)
	}
}

func TestSlackOAuthConfig(t *testing.T) {
	t.Setenv("AUTH_SLACK_ID", "slack-id")
	t.Setenv("AUTH_SLACK_SECRET", "slack-secret")
	clientID, clientSecret, ok := slackOAuthConfig()
	if !ok || clientID != "slack-id" || clientSecret != "slack-secret" {
		t.Fatalf("config = %q %q %v", clientID, clientSecret, ok)
	}
}

func TestSlackSignatureVerification(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	body := []byte(`{"team_id":"T123","event":{"type":"message"}}`)
	timestamp := strconv.FormatInt(now.Unix(), 10)
	signature := slackTestSignature("secret", timestamp, body)

	if !verifySlackSignature("secret", timestamp, signature, body, now) {
		t.Fatal("valid Slack signature was rejected")
	}
	if verifySlackSignature("secret", timestamp, signature, []byte(`{"team_id":"T999"}`), now) {
		t.Fatal("tampered Slack body was accepted")
	}
	stale := strconv.FormatInt(now.Add(-10*time.Minute).Unix(), 10)
	if verifySlackSignature("secret", stale, slackTestSignature("secret", stale, body), body, now) {
		t.Fatal("stale Slack timestamp was accepted")
	}
}

func TestIntercomAuthorizationURL(t *testing.T) {
	got := intercomAuthorizationURL("client", "https://app.example/", "state-token")
	if !strings.HasPrefix(got, "https://app.intercom.com/oauth?") {
		t.Fatalf("unexpected URL = %q", got)
	}
	if !strings.Contains(got, "client_id=client") || !strings.Contains(got, "state=state-token") {
		t.Fatalf("missing auth params = %q", got)
	}
	if !strings.Contains(got, "redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fintegrations%2Fintercom%2Foauth%2Fcallback") {
		t.Fatalf("missing redirect uri = %q", got)
	}
}

func TestIntercomSignatureVerification(t *testing.T) {
	body := []byte(`{"app_id":"app_123","conversation":{"id":"conv_123"}}`)
	macSHA1 := hmac.New(sha1.New, []byte("secret"))
	_, _ = macSHA1.Write(body)
	hubSignature := "sha1=" + hex.EncodeToString(macSHA1.Sum(nil))
	if !verifyIntercomSignature("secret", hubSignature, "", body) {
		t.Fatal("valid Intercom sha1 signature was rejected")
	}
	macSHA256 := hmac.New(sha256.New, []byte("secret"))
	_, _ = macSHA256.Write(body)
	intercomSignature := hex.EncodeToString(macSHA256.Sum(nil))
	if !verifyIntercomSignature("secret", "", intercomSignature, body) {
		t.Fatal("valid Intercom sha256 signature was rejected")
	}
	if verifyIntercomSignature("secret", hubSignature, "", []byte(`{"app_id":"tampered"}`)) {
		t.Fatal("tampered Intercom body was accepted")
	}
}

func TestIntercomActionFromPayload(t *testing.T) {
	payload := map[string]any{
		"app_id": "app_123",
		"conversation": map[string]any{
			"id":        "conv_123",
			"subject":   "Refund feedback",
			"permalink": "https://app.intercom.com/a/inbox/inbox/conversation/conv_123",
		},
		"contact": map[string]any{"id": "contact_1", "name": "Ada", "email": "ada@example.com"},
		"company": map[string]any{"id": "company_1", "name": "Acme"},
	}
	got := intercomActionFromPayload(payload)
	if got.AppID != "app_123" || got.ConversationID != "conv_123" || got.Title != "Refund feedback" {
		t.Fatalf("action = %#v", got)
	}
	if got.ContactEmail != "ada@example.com" || got.CompanyName != "Acme" {
		t.Fatalf("customer mapping = %#v", got)
	}
}

func TestSlackTeamID(t *testing.T) {
	if got := slackTeamID(map[string]any{"team_id": "T123"}); got != "T123" {
		t.Fatalf("top-level team id = %q", got)
	}
	if got := slackTeamID(map[string]any{"team": map[string]any{"id": "T456"}}); got != "T456" {
		t.Fatalf("nested team id = %q", got)
	}
}

func TestSlackEventsURLVerificationUsesSignedFixture(t *testing.T) {
	t.Setenv("SLACK_SIGNING_SECRET", "secret")
	body := []byte(`{"type":"url_verification","team_id":"T123","challenge":"challenge-token"}`)
	now := time.Now().UTC()
	timestamp := strconv.FormatInt(now.Unix(), 10)
	req := httptest.NewRequest(http.MethodPost, "/api/integrations/slack/events", strings.NewReader(string(body)))
	req.Header.Set("X-Slack-Request-Timestamp", timestamp)
	req.Header.Set("X-Slack-Signature", slackTestSignature("secret", timestamp, body))
	rec := httptest.NewRecorder()

	Handler{}.SlackEvents(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "challenge-token") {
		t.Fatalf("challenge response = %s", rec.Body.String())
	}
}

func TestGitHubConfigAndSetupRequirement(t *testing.T) {
	t.Setenv("GITHUB_APP_ID", "")
	t.Setenv("GITHUB_CLIENT_ID", "")
	t.Setenv("GITHUB_PRIVATE_KEY", "")
	t.Setenv("GITHUB_WEBHOOK_SECRET", "")
	if got := setupRequirement("github"); got == nil || got.Type != "configuration_required" || !strings.Contains(got.Message, "GITHUB_APP_ID") {
		t.Fatalf("github requirement = %#v", got)
	}
	t.Setenv("GITHUB_APP_ID", "123")
	t.Setenv("GITHUB_CLIENT_ID", "client-id")
	t.Setenv("GITHUB_PRIVATE_KEY", "private-key")
	t.Setenv("GITHUB_WEBHOOK_SECRET", "webhook-secret")
	if got := setupRequirement("github"); got != nil {
		t.Fatalf("configured github requirement = %#v", got)
	}
	cfg, ok := loadGitHubConfig()
	if !ok || cfg.AppID != "123" || cfg.ClientID != "client-id" || cfg.PrivateKey != "private-key" || cfg.WebhookSecret != "webhook-secret" {
		t.Fatalf("github config = %#v ok=%v", cfg, ok)
	}
}

func TestGitHubSignatureVerification(t *testing.T) {
	body := []byte(`{"installation":{"id":123},"repository":{"id":456,"full_name":"namuh-eng/exponential"}}`)
	signature := githubTestSignature("secret", body)
	if !verifyGitHubSignature("secret", signature, body) {
		t.Fatal("valid GitHub signature was rejected")
	}
	if verifyGitHubSignature("secret", signature, []byte(`{"installation":{"id":999}}`)) {
		t.Fatal("tampered GitHub body was accepted")
	}
	if verifyGitHubSignature("secret", strings.Replace(signature, "sha256=", "sha1=", 1), body) {
		t.Fatal("wrong signature algorithm was accepted")
	}
}

func TestGitHubRepositoryMappingActive(t *testing.T) {
	payload := map[string]any{
		"repository": map[string]any{"id": float64(456), "full_name": "namuh-eng/exponential"},
	}
	if !githubRepositoryMappingActive(map[string]any{"repositorySelection": "all"}, payload) {
		t.Fatal("all repositories should accept repository payload")
	}
	selected := map[string]any{
		"repositorySelection": "selected",
		"selectedRepositories": []map[string]any{{"id": "456", "fullName": "namuh-eng/exponential", "active": true}},
	}
	if !githubRepositoryMappingActive(selected, payload) {
		t.Fatal("selected active repository was rejected")
	}
	inactive := map[string]any{
		"repositorySelection": "selected",
		"selectedRepositories": []map[string]any{{"id": "456", "fullName": "namuh-eng/exponential", "active": false}},
	}
	if githubRepositoryMappingActive(inactive, payload) {
		t.Fatal("inactive repository mapping was accepted")
	}
	unknown := map[string]any{"repositorySelection": "unknown"}
	if githubRepositoryMappingActive(unknown, payload) {
		t.Fatal("unknown repository selection should not accept repository payload")
	}
}

func TestGitHubIntegrationDetailsAreSecretFree(t *testing.T) {
	details := githubIntegrationDetails(map[string]any{
		"installationId": "12345",
		"account": map[string]any{"login": "namuh-eng", "type": "Organization"},
		"repositorySelection": "selected",
		"selectedRepositories": []map[string]any{{"id": "456", "fullName": "namuh-eng/exponential", "active": true}},
		"privateKey": "do-not-return",
		"webhookSecret": "do-not-return",
	})
	encoded, err := json.Marshal(details)
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	if !strings.Contains(text, "namuh-eng/exponential") || !strings.Contains(text, "12345") {
		t.Fatalf("details missing safe metadata: %s", text)
	}
	if strings.Contains(text, "do-not-return") || strings.Contains(text, "privateKey") || strings.Contains(text, "webhookSecret") {
		t.Fatalf("details leaked secret-like metadata: %s", text)
	}
}

func TestExchangeSlackOAuthUsesConfiguredEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth.v2.access" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("client_secret") != "client-secret" || r.Form.Get("code") != "code-123" {
			t.Fatalf("form = %#v", r.Form)
		}
		_, _ = w.Write([]byte(`{"ok":true,"access_token":"xoxb-token","scope":"channels:read,chat:write","bot_user_id":"Ubot","team":{"id":"T123","name":"Acme"},"authed_user":{"id":"Uinstaller"}}`))
	}))
	defer server.Close()
	t.Setenv("SLACK_API_BASE_URL", server.URL)

	got, err := exchangeSlackOAuth(t.Context(), server.Client(), "client-secret", "code-123", "https://app.example/callback")
	if err != nil {
		t.Fatal(err)
	}
	if got.AccessToken != "xoxb-token" || got.Team.ID != "T123" || got.BotUserID != "Ubot" {
		t.Fatalf("oauth response = %#v", got)
	}
}

func TestPostSlackMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat.postMessage" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer xoxb-token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		var body slackPostMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Channel != "C123" || body.Text != "Hello" {
			t.Fatalf("body = %#v", body)
		}
		_, _ = w.Write([]byte(`{"ok":true,"ts":"123.456"}`))
	}))
	defer server.Close()
	t.Setenv("SLACK_API_BASE_URL", server.URL)

	if err := postSlackMessage(t.Context(), server.Client(), "xoxb-token", slackPostMessageRequest{Channel: "C123", Text: "Hello"}); err != nil {
		t.Fatal(err)
	}
}

func TestPostSlackUnfurl(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat.unfurl" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer xoxb-token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		var body slackUnfurlRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Channel != "C123" || body.MessageTS != "171.000" || body.Unfurls["https://app.test/issue/ENG-1"].Title == "" {
			t.Fatalf("body = %#v", body)
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	t.Setenv("SLACK_API_BASE_URL", server.URL)

	err := postSlackUnfurl(t.Context(), server.Client(), "xoxb-token", slackUnfurlRequest{
		Channel:   "C123",
		MessageTS: "171.000",
		Unfurls: map[string]slackUnfurlAttachment{
			"https://app.test/issue/ENG-1": {Title: "ENG-1 Fix login"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestSlackMessageShouldSyncPreventsLoopsAndNonReplies(t *testing.T) {
	if !slackMessageShouldSync(slackMessageEvent{Type: "message", Channel: "C123", TS: "2.0", ThreadTS: "1.0", Text: "reply", User: "U1"}, "UBOT") {
		t.Fatal("human thread reply should sync")
	}
	for name, message := range map[string]slackMessageEvent{
		"root":    {Type: "message", Channel: "C123", TS: "1.0", ThreadTS: "1.0", Text: "root", User: "U1"},
		"bot":     {Type: "message", Channel: "C123", TS: "2.0", ThreadTS: "1.0", Text: "bot", User: "UBOT"},
		"subtype": {Type: "message", Channel: "C123", TS: "2.0", ThreadTS: "1.0", Text: "bot", Subtype: "bot_message"},
		"empty":   {Type: "message", Channel: "C123", TS: "2.0", ThreadTS: "1.0", Text: " "},
	} {
		if slackMessageShouldSync(message, "UBOT") {
			t.Fatalf("%s message should not sync: %#v", name, message)
		}
	}
}

func TestIssueIdentifierFromURL(t *testing.T) {
	cases := map[string]string{
		"https://app.example/team/ENG/issue/ENG-574":     "ENG-574",
		"https://app.example/team/ENG/issue/eng-574?x=y": "ENG-574",
		"https://app.example/documents/project-plan":     "",
	}
	for input, want := range cases {
		if got := issueIdentifierFromURL(input); got != want {
			t.Fatalf("issueIdentifierFromURL(%q) = %q want %q", input, got, want)
		}
	}
}

func TestIsConfiguredAppLink(t *testing.T) {
	t.Setenv("EXPONENTIAL_APP_URL", "https://app.example")
	if !isConfiguredAppLink("https://app.example/team/ENG/issue/ENG-1") {
		t.Fatal("expected configured app link")
	}
	if isConfiguredAppLink("https://other.example/team/ENG/issue/ENG-1") {
		t.Fatal("external link should not be unfurled")
	}
}

func TestPrivateSlackUnfurlIsAccessSafe(t *testing.T) {
	got := privateSlackUnfurl("https://app.example/team/ENG/issue/ENG-1")
	if got.Title != "Private exponential link" || strings.Contains(got.Text, "ENG-1") {
		t.Fatalf("fallback unfurl leaked details: %#v", got)
	}
}

func TestSlackIssueCreationEnabledSettings(t *testing.T) {
	if !slackIssueCreationEnabled(map[string]any{}) {
		t.Fatal("Slack issue creation should default on")
	}
	if slackIssueCreationEnabled(map[string]any{"slackIssueCreationEnabled": false}) {
		t.Fatal("top-level disabled setting was ignored")
	}
	if slackIssueCreationEnabled(map[string]any{"slack": map[string]any{"issueCreationEnabled": false}}) {
		t.Fatal("nested Slack disabled setting was ignored")
	}
	if slackIssueCreationEnabled(map[string]any{"integrations": map[string]any{"slack": map[string]any{"issueCreationEnabled": false}}}) {
		t.Fatal("workspace integration disabled setting was ignored")
	}
}

func TestSlackAskSettingsRespectPriorityAutoAssignAndEnabled(t *testing.T) {
	priority, autoAssign, enabled := slackAskSettings(map[string]any{"collaboration": map[string]any{"asks": map[string]any{"enabled": true, "defaultPriority": "urgent", "autoAssign": false}}})
	if priority != "urgent" || autoAssign || !enabled {
		t.Fatalf("settings = %q %v %v", priority, autoAssign, enabled)
	}

	priority, autoAssign, enabled = slackAskSettings(map[string]any{"collaboration": map[string]any{"asks": map[string]any{"defaultPriority": "invalid"}}})
	if priority != "medium" || !autoAssign || enabled {
		t.Fatalf("default settings = %q %v %v", priority, autoAssign, enabled)
	}
}

func TestSlackDefaultAssigneePrefersWorkflowAutomation(t *testing.T) {
	got := slackDefaultAssignee(map[string]any{
		"defaultAssigneeId":  "fallback-user",
		"workflowAutomation": map[string]any{"defaultAssigneeId": "workflow-user"},
	})
	if got != "workflow-user" {
		t.Fatalf("default assignee = %q", got)
	}
}

func TestSlackSourceFromPayloadBuildsFallbackPermalink(t *testing.T) {
	payload := slackInteractionPayload{}
	payload.Team.ID = "T123"
	payload.Channel.ID = "C123"
	payload.Channel.Name = "requests"
	payload.Message.TS = "1710000000.000100"
	payload.Message.User = "Umsg"

	source := slackSourceFromPayload(payload)
	if source.TeamID != "T123" || source.ChannelID != "C123" || source.ThreadTS != payload.Message.TS {
		t.Fatalf("source = %#v", source)
	}
	if !strings.Contains(source.Permalink, "https://slack.com/app_redirect?") ||
		!strings.Contains(source.Permalink, "channel=C123") ||
		!strings.Contains(source.Permalink, "message_ts=1710000000.000100") {
		t.Fatalf("fallback permalink = %q", source.Permalink)
	}
}

func TestBuildSlackIssueModalIncludesCoreFields(t *testing.T) {
	payload := slackInteractionPayload{}
	payload.Message.Text = "Fix login redirects\nmore context"
	metadata := slackIssuePrivateMetadata{
		WorkspaceID: "workspace-1",
		TeamID:      "team-1",
		TeamKey:     "ENG",
		UserID:      "user-1",
		SlackUserID: "U123",
		Source:      slackSourceMetadata{Permalink: "https://slack.example/archives/C/p1"},
	}
	view, err := buildSlackIssueModal(payload, metadata, slackIssueModalOptions{
		Teams:      []slackIssueTeamOption{{ID: "team-1", Key: "ENG", Name: "Engineering", TriageEnabled: true}},
		Statuses:   []slackIssueFieldOption{{ID: "state-triage", Name: "Triage", Category: "triage"}},
		Priorities: prioritySlackOptions(),
		Assignees:  []slackIssueFieldOption{{ID: "user-1", Name: "Ada"}},
		Labels:     []slackIssueFieldOption{{ID: "label-1", Name: "Bug"}},
		Projects:   []slackIssueFieldOption{{ID: "project-1", Name: "Website"}},
		Templates:  []slackIssueTemplateOption{{ID: "template-1", Name: "Bug report"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if view["callback_id"] != slackCreateIssueSubmitCallbackID {
		t.Fatalf("callback = %#v", view["callback_id"])
	}
	blocks, ok := view["blocks"].([]map[string]any)
	if !ok {
		t.Fatalf("blocks = %#v", view["blocks"])
	}
	blockIDs := map[string]bool{}
	for _, block := range blocks {
		if id, ok := block["block_id"].(string); ok {
			blockIDs[id] = true
		}
	}
	for _, id := range []string{"team", "title", "description", "template", "status", "assignee", "priority", "labels", "project", "triage"} {
		if !blockIDs[id] {
			t.Fatalf("modal missing block %q in %#v", id, blockIDs)
		}
	}
	rawMetadata, ok := view["private_metadata"].(string)
	if !ok || !strings.Contains(rawMetadata, `"slackUserId":"U123"`) {
		t.Fatalf("private metadata = %#v", view["private_metadata"])
	}
}

func TestSlackIssueInputFromView(t *testing.T) {
	metadata := slackIssuePrivateMetadata{
		WorkspaceID: "workspace-1",
		TeamID:      "team-default",
		TeamKey:     "ENG",
		UserID:      "user-1",
		SlackUserID: "U123",
		Source:      slackSourceMetadata{ChannelID: "C123"},
	}
	view := slackInteractionView{}
	view.State.Values = map[string]map[string]slackInteractionStateValue{
		"team":        {"team": {SelectedOption: &slackOption{Value: "team-2"}}},
		"title":       {"title": {Value: "  New issue  "}},
		"description": {"description": {Value: "details"}},
		"priority":    {"priority": {SelectedOption: &slackOption{Value: "high"}}},
		"labels":      {"labels": {SelectedOptions: []slackOption{{Value: "label-1"}, {Value: "label-2"}}}},
		"triage":      {"triage": {SelectedOption: &slackOption{Value: "false"}}},
	}
	input := slackIssueInputFromView(view, metadata)
	if input.TeamID != "team-2" || input.Title != "New issue" || input.Priority != "high" || input.UseTriage {
		t.Fatalf("input = %#v", input)
	}
	if len(input.LabelIDs) != 2 || input.LabelIDs[0] != "label-1" || input.LabelIDs[1] != "label-2" {
		t.Fatalf("labels = %#v", input.LabelIDs)
	}
}

func TestOpenSlackView(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/views.open" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer xoxb-token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["trigger_id"] != "trigger-1" || body["view"] == nil {
			t.Fatalf("body = %#v", body)
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	t.Setenv("SLACK_API_BASE_URL", server.URL)

	if err := openSlackView(t.Context(), server.Client(), "xoxb-token", "trigger-1", map[string]any{"type": "modal"}); err != nil {
		t.Fatal(err)
	}
}

func TestDiscordAuthorizationURL(t *testing.T) {
	got := discordAuthorizationURL("client", "https://app.example/", "state-token")
	if !strings.HasPrefix(got, "https://discord.com/oauth2/authorize?") {
		t.Fatalf("unexpected URL = %q", got)
	}
	if !strings.Contains(got, "client_id=client") || !strings.Contains(got, "state=state-token") {
		t.Fatalf("missing query params = %q", got)
	}
	if !strings.Contains(got, "scope=bot+applications.commands") || !strings.Contains(got, "permissions=0") {
		t.Fatalf("missing Discord install scope = %q", got)
	}
	if !strings.Contains(got, "redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fintegrations%2Fdiscord%2Foauth%2Fcallback") {
		t.Fatalf("missing redirect uri = %q", got)
	}
}

func TestDiscordSignatureVerification(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	body := []byte(`{"type":1}`)
	timestamp := strconv.FormatInt(now.Unix(), 10)
	signature := ed25519.Sign(privateKey, append([]byte(timestamp), body...))

	if !verifyDiscordSignature(hex.EncodeToString(publicKey), timestamp, hex.EncodeToString(signature), body, now) {
		t.Fatal("valid Discord signature was rejected")
	}
	if verifyDiscordSignature(hex.EncodeToString(publicKey), timestamp, hex.EncodeToString(signature), []byte(`{"type":2}`), now) {
		t.Fatal("tampered Discord body was accepted")
	}
	stale := strconv.FormatInt(now.Add(-10*time.Minute).Unix(), 10)
	staleSignature := ed25519.Sign(privateKey, append([]byte(stale), body...))
	if verifyDiscordSignature(hex.EncodeToString(publicKey), stale, hex.EncodeToString(staleSignature), body, now) {
		t.Fatal("stale Discord timestamp was accepted")
	}
}

func TestMicrosoftTeamsAuthorizationURL(t *testing.T) {
	got := microsoftTeamsAuthorizationURL("client", "https://app.example/", "state-token")
	if !strings.HasPrefix(got, "https://login.microsoftonline.com/common/adminconsent?") {
		t.Fatalf("unexpected URL = %q", got)
	}
	if !strings.Contains(got, "client_id=client") || !strings.Contains(got, "state=state-token") {
		t.Fatalf("missing query params = %q", got)
	}
	if !strings.Contains(got, "redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fintegrations%2Fmicrosoft-teams%2Foauth%2Fcallback") {
		t.Fatalf("missing redirect uri = %q", got)
	}
}

func TestMicrosoftTeamsSignatureVerification(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	body := []byte(`{"type":"message","text":"create issue Bug","channelData":{"tenant":{"id":"tenant-1"}}}`)
	timestamp := strconv.FormatInt(now.Unix(), 10)
	signature := microsoftTeamsTestSignature("secret", timestamp, body)
	if !verifyMicrosoftTeamsSignature("secret", timestamp, signature, body, now) {
		t.Fatal("valid Microsoft Teams signature was rejected")
	}
	if verifyMicrosoftTeamsSignature("secret", timestamp, signature, []byte(`{"type":"message","text":"tampered"}`), now) {
		t.Fatal("tampered Microsoft Teams body was accepted")
	}
	stale := strconv.FormatInt(now.Add(-10*time.Minute).Unix(), 10)
	if verifyMicrosoftTeamsSignature("secret", stale, microsoftTeamsTestSignature("secret", stale, body), body, now) {
		t.Fatal("stale Microsoft Teams timestamp was accepted")
	}
}

func TestMicrosoftTeamsCommandParsingAndChannelPolicy(t *testing.T) {
	command, rest := microsoftTeamsCommand("<at>exponential</at> create issue Fix production alert")
	if command != "create_issue" || rest != "Fix production alert" {
		t.Fatalf("issue command = %q %q", command, rest)
	}
	command, rest = microsoftTeamsCommand("summarize thread")
	if command != "summarize_thread" || rest != "" {
		t.Fatalf("summarize command = %q %q", command, rest)
	}
	standard := microsoftTeamsActivity{}
	standard.ChannelData.Channel.ChannelType = "standard"
	if !microsoftTeamsStandardChannel(standard) {
		t.Fatal("standard channel was rejected")
	}
	shared := microsoftTeamsActivity{}
	shared.ChannelData.Channel.ChannelType = "shared"
	if microsoftTeamsStandardChannel(shared) {
		t.Fatal("shared channel was accepted")
	}
}

func TestPostMicrosoftTeamsMessageUsesWebhook(t *testing.T) {
	var got map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/teams-webhook" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Fatalf("content type = %q", r.Header.Get("Content-Type"))
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	err := postMicrosoftTeamsMessage(t.Context(), server.Client(), microsoftTeamsCredential{}, microsoftTeamsOutboundMessage{ChannelID: "19:channel", Text: "Project update", WebhookURL: server.URL + "/teams-webhook"})
	if err != nil {
		t.Fatal(err)
	}
	if got["type"] != "message" || got["text"] != "Project update" {
		t.Fatalf("payload = %#v", got)
	}
}

func TestPostMicrosoftTeamsMessageFailureIsRetryableAndAuthAware(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "expired", http.StatusUnauthorized)
	}))
	defer server.Close()

	err := postMicrosoftTeamsMessage(t.Context(), server.Client(), microsoftTeamsCredential{ServiceURL: server.URL, BotToken: "token"}, microsoftTeamsOutboundMessage{ChannelID: "19:channel", Text: "Project update"})
	if err == nil {
		t.Fatal("expected delivery failure")
	}
	if !isMicrosoftTeamsAuthFailure(err) {
		t.Fatalf("expected auth failure, got %v", err)
	}
	status, nextRunAt := providerJobFailureStatus(1, 3)
	if status != "failed" || nextRunAt == nil {
		t.Fatalf("retry status = %q next=%v", status, nextRunAt)
	}
	status, nextRunAt = providerJobFailureStatus(3, 3)
	if status != "dead" || nextRunAt != nil {
		t.Fatalf("dead status = %q next=%v", status, nextRunAt)
	}
}

func TestDiscordCommandParsingAndResponses(t *testing.T) {
	subcommand, options := discordSubcommand(discordCommandData{
		Name:    "exponential",
		Options: []discordOption{{Name: "issue", Type: discordApplicationCommandOptionSubcmd, Options: []discordOption{{Name: "title", Type: discordApplicationCommandOptionString, Value: "  Fix login  "}}}},
	})
	if subcommand != "issue" || discordOptionString(options, "title") != "Fix login" {
		t.Fatalf("parsed command = %q %#v", subcommand, options)
	}
	response := discordIssueCardResponse("Created", discordCommandIssue{Identifier: "ENG-1", Title: "Fix login", TeamKey: "ENG", StateName: "Triage", Priority: "high"}, false)
	data := response["data"].(map[string]any)
	if data["flags"] != nil || !strings.Contains(data["content"].(string), "ENG-1") {
		t.Fatalf("issue card response = %#v", response)
	}
	ephemeral := discordMessageResponse("private", true)
	if ephemeral["data"].(map[string]any)["flags"] != discordInteractionResponseEphemeral {
		t.Fatalf("ephemeral response = %#v", ephemeral)
	}
}

func TestNormalizeGitLabOrigin(t *testing.T) {
	cases := map[string]string{
		"":                                "https://gitlab.com",
		"gitlab.example.com":              "https://gitlab.example.com",
		"https://GitLab.Example.com/":     "https://gitlab.example.com",
		"https://gitlab.example.com:8443": "https://gitlab.example.com:8443",
	}
	for input, want := range cases {
		got, err := normalizeGitLabOrigin(input)
		if err != nil {
			t.Fatalf("normalizeGitLabOrigin(%q) error = %v", input, err)
		}
		if got != want {
			t.Fatalf("normalizeGitLabOrigin(%q) = %q want %q", input, got, want)
		}
	}
	for _, input := range []string{"http://gitlab.example.com", "https://user@gitlab.example.com", "https://gitlab.example.com/group", "https://gitlab.example.com?token=x"} {
		if got, err := normalizeGitLabOrigin(input); err == nil {
			t.Fatalf("normalizeGitLabOrigin(%q) = %q, expected error", input, got)
		}
	}
}

func TestValidateGitLabToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v4/user" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Header.Get("PRIVATE-TOKEN") != "glpat-valid" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"id":123,"username":"octo","name":"Octo User"}`))
	}))
	defer server.Close()

	user, err := validateGitLabToken(t.Context(), server.Client(), server.URL, "glpat-valid")
	if err != nil {
		t.Fatal(err)
	}
	if user.ID != 123 || user.Username != "octo" {
		t.Fatalf("user = %#v", user)
	}
	if _, err := validateGitLabToken(t.Context(), server.Client(), server.URL, "bad"); err == nil {
		t.Fatal("invalid token was accepted")
	}
}

func TestGitLabWebhookSecretVerification(t *testing.T) {
	if !verifyGitLabWebhookSecret("secret", "secret") {
		t.Fatal("valid GitLab webhook secret was rejected")
	}
	if verifyGitLabWebhookSecret("secret", "wrong") {
		t.Fatal("invalid GitLab webhook secret was accepted")
	}
	if verifyGitLabWebhookSecret("", "") {
		t.Fatal("empty GitLab webhook secret was accepted")
	}
}

func TestGitLabMergeRequestEventParsing(t *testing.T) {
	payload := gitLabWebhookPayload{ObjectKind: "merge_request"}
	payload.Project.ID = float64(7)
	payload.Project.PathWithNamespace = "namuh/exponential"
	payload.Project.WebURL = "https://gitlab.example.com/namuh/exponential"
	payload.User.Name = "Ada"
	payload.User.Username = "ada"
	payload.User.Email = "ada@example.com"
	payload.ObjectAttributes.ID = float64(42)
	payload.ObjectAttributes.IID = float64(5)
	payload.ObjectAttributes.Action = "merge"
	payload.ObjectAttributes.State = "merged"
	payload.ObjectAttributes.Title = "Fix ENG-581 and eng-12"
	payload.ObjectAttributes.Description = "Closes PROD-7"
	payload.ObjectAttributes.SourceBranch = "feature/eng-581-gitlab"
	payload.ObjectAttributes.TargetBranch = "main"
	payload.ObjectAttributes.URL = "https://gitlab.example.com/namuh/exponential/-/merge_requests/5"
	payload.ObjectAttributes.LastCommit.Message = "Follow-up for OPS-3"
	payload.Commits = []gitLabCommitPayload{{Message: "Refs ENG-581"}}

	event, ok := gitLabMergeRequestEventFromPayload(payload)
	if !ok {
		t.Fatal("merge request event was not parsed")
	}
	if event.Action != "merged" || event.ProjectID != "7" || event.MRIID != "5" || event.ActorName != "Ada" {
		t.Fatalf("event = %#v", event)
	}
	want := []string{"ENG-12", "ENG-581", "OPS-3", "PROD-7"}
	if strings.Join(event.Identifiers, ",") != strings.Join(want, ",") {
		t.Fatalf("identifiers = %#v want %#v", event.Identifiers, want)
	}
}

func slackTestSignature(secret string, timestamp string, body []byte) string {
	base := "v0:" + timestamp + ":" + string(body)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(base))
	return "v0=" + hex.EncodeToString(mac.Sum(nil))
}

func TestProviderJobFailureStatus(t *testing.T) {
	status, nextRunAt := providerJobFailureStatus(2, 5)
	if status != "failed" || nextRunAt == nil {
		t.Fatalf("retryable failure = %q %#v", status, nextRunAt)
	}
	status, nextRunAt = providerJobFailureStatus(5, 5)
	if status != "dead" || nextRunAt != nil {
		t.Fatalf("terminal failure = %q %#v", status, nextRunAt)
	}
}

func TestRowHealthIncludesAuditEvents(t *testing.T) {
	health := row{
		AuditEvents: []AuditEvent{
			{
				EventType: "job_failed",
				Severity:  "error",
				Message:   "Slack delivery failed after token expiry.",
				CreatedAt: "2026-06-10T12:00:00Z",
			},
		},
	}.Health()
	if len(health.AuditEvents) != 1 {
		t.Fatalf("audit events = %#v", health.AuditEvents)
	}
	if health.AuditEvents[0].Message != "Slack delivery failed after token expiry." {
		t.Fatalf("audit event message = %#v", health.AuditEvents[0])
	}
}

func TestIntegrationJSONOmitsCredentialFields(t *testing.T) {
	payload, err := json.Marshal(Integration{
		CatalogItem: CatalogItem{Provider: "slack", Name: "Slack", Description: "Slack"},
		Status:      "connected",
		Actions:     integrationActions(true, true, "connected", nil),
		Health: Health{
			AuditEvents: []AuditEvent{
				{EventType: "job_failed", Severity: "error", Message: "retry failed", CreatedAt: "2026-06-10T12:00:00Z"},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	body := string(payload)
	for _, forbidden := range []string{"clientSecret", "accessToken", "refreshToken", "secretRef", "encryptedPayload", "credentialRef"} {
		if strings.Contains(strings.ToLower(body), strings.ToLower(forbidden)) {
			t.Fatalf("integration response leaked %q in %s", forbidden, body)
		}
	}
}

func TestSentrySetupRequirementAndAuthorizationURL(t *testing.T) {
	t.Setenv("AUTH_SENTRY_ID", "")
	t.Setenv("AUTH_SENTRY_SECRET", "")
	t.Setenv("SENTRY_WEBHOOK_SECRET", "")
	if got := setupRequirement("sentry"); got == nil || got.Type != "configuration_required" {
		t.Fatalf("sentry requirement = %#v", got)
	}
	t.Setenv("AUTH_SENTRY_ID", "sentry-id")
	t.Setenv("AUTH_SENTRY_SECRET", "sentry-secret")
	t.Setenv("SENTRY_WEBHOOK_SECRET", "webhook-secret")
	if got := setupRequirement("sentry"); got != nil {
		t.Fatalf("configured sentry requirement = %#v", got)
	}
	got := sentryAuthorizationURL("client", "https://app.example/", "state-token")
	if !strings.HasPrefix(got, "https://sentry.io/oauth/authorize/?") {
		t.Fatalf("unexpected Sentry URL = %q", got)
	}
	if !strings.Contains(got, "client_id=client") || !strings.Contains(got, "state=state-token") {
		t.Fatalf("missing query params = %q", got)
	}
	if !strings.Contains(got, "event%3Awrite") || !strings.Contains(got, "org%3Aread") {
		t.Fatalf("missing Sentry scopes = %q", got)
	}
	if !strings.Contains(got, "redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fintegrations%2Fsentry%2Foauth%2Fcallback") {
		t.Fatalf("missing redirect uri = %q", got)
	}
}

func TestSentrySignatureVerification(t *testing.T) {
	body := []byte(`{"issue":{"id":"123"}}`)
	mac := hmac.New(sha256.New, []byte("secret"))
	_, _ = mac.Write(body)
	signature := hex.EncodeToString(mac.Sum(nil))
	if !verifySentrySignature("secret", signature, body) {
		t.Fatal("valid Sentry signature was rejected")
	}
	if !verifySentrySignature("secret", "sha256="+signature, body) {
		t.Fatal("prefixed Sentry signature was rejected")
	}
	if verifySentrySignature("secret", signature, []byte(`{"issue":{"id":"456"}}`)) {
		t.Fatal("tampered Sentry body was accepted")
	}
}

func TestSentryIssueActionFromPayload(t *testing.T) {
	payload := map[string]any{
		"query":           "ENG",
		"teamKey":         "ENG",
		"issueIdentifier": "ENG-42",
		"assigneeEmail":   "ASHLEY@EXAMPLE.COM",
		"issue": map[string]any{
			"id":        "987",
			"short_id":  "PROJ-987",
			"title":     "panic in worker",
			"permalink": "https://sentry.example/issues/987",
			"project":   map[string]any{"id": "11", "slug": "api"},
		},
	}
	got := sentryIssueActionFromPayload(payload)
	if got.Query != "ENG" || got.TeamKey != "ENG" || got.IssueID != "ENG-42" {
		t.Fatalf("parsed action = %#v", got)
	}
	if got.AssigneeEmail != "ashley@example.com" || got.SentryIssue.ID != "987" || got.SentryIssue.Project.Slug != "api" {
		t.Fatalf("parsed Sentry issue = %#v", got)
	}
}

func TestFrontSignatureVerification(t *testing.T) {
	body := []byte(`{"workspaceSlug":"acme","conversation":{"id":"cnv_123"}}`)
	mac := hmac.New(sha256.New, []byte("secret"))
	_, _ = mac.Write(body)
	signature := hex.EncodeToString(mac.Sum(nil))
	if !verifyFrontSignature("secret", signature, body) {
		t.Fatal("valid Front signature was rejected")
	}
	if !verifyFrontSignature("secret", "sha256="+signature, body) {
		t.Fatal("prefixed Front signature was rejected")
	}
	if verifyFrontSignature("secret", signature, []byte(`{"workspaceSlug":"other"}`)) {
		t.Fatal("tampered Front body was accepted")
	}
}

func TestValidateFrontTokenUsesConfiguredBaseURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/teammates" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer front-token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"_results":[]}`))
	}))
	defer server.Close()
	if err := validateFrontToken(t.Context(), server.Client(), server.URL, "front-token"); err != nil {
		t.Fatal(err)
	}
}

func TestPostFrontJSONReopensConversation(t *testing.T) {
	seen := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path)
		if r.Header.Get("Authorization") != "Bearer front-token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	credential := frontCredential{APIToken: "front-token", BaseURL: server.URL}
	if err := postFrontJSON(t.Context(), server.Client(), credential, http.MethodPost, "/conversations/cnv_123/comments", map[string]any{"body": "done"}); err != nil {
		t.Fatal(err)
	}
	if err := postFrontJSON(t.Context(), server.Client(), credential, http.MethodPatch, "/conversations/cnv_123", map[string]any{"status": "open"}); err != nil {
		t.Fatal(err)
	}
	if strings.Join(seen, ",") != "POST /conversations/cnv_123/comments,PATCH /conversations/cnv_123" {
		t.Fatalf("requests = %#v", seen)
	}
}

func TestFrontReopenCommentBody(t *testing.T) {
	body := frontReopenCommentBody(map[string]any{"identifier": "ENG-7", "title": "Fix exports", "category": "canceled", "issueUrl": "https://app.example/team/ENG/issue/ENG-7"})
	if !strings.Contains(body, "ENG-7 Fix exports was canceled") || !strings.Contains(body, "https://app.example/team/ENG/issue/ENG-7") {
		t.Fatalf("body = %q", body)
func TestZendeskSetupRequirementAndSubdomain(t *testing.T) {
	if got := setupRequirement("zendesk"); got != nil {
		t.Fatalf("zendesk should be configurable from admin setup, got %#v", got)
	}
	subdomain, accountURL, err := normalizeZendeskSubdomain("https://Acme.zendesk.com/")
	if err != nil {
		t.Fatal(err)
	}
	if subdomain != "acme" || accountURL != "https://acme.zendesk.com" {
		t.Fatalf("normalized = %q %q", subdomain, accountURL)
	}
	if _, _, err := normalizeZendeskSubdomain("https://acme.zendesk.com/path"); err == nil {
		t.Fatal("Zendesk origin with path was accepted")
	}
}

func TestZendeskSignatureVerification(t *testing.T) {
	body := []byte(`{"ticket":{"id":"42"}}`)
	mac := hmac.New(sha256.New, []byte("secret"))
	_, _ = mac.Write(body)
	signature := hex.EncodeToString(mac.Sum(nil))
	if !verifyZendeskSignature("secret", signature, body) {
		t.Fatal("valid Zendesk signature was rejected")
	}
	if !verifyZendeskSignature("secret", "sha256="+signature, body) {
		t.Fatal("prefixed Zendesk signature was rejected")
	}
	if verifyZendeskSignature("secret", signature, []byte(`{"ticket":{"id":"43"}}`)) {
		t.Fatal("tampered Zendesk body was accepted")
	}
}

func TestZendeskTicketActionFromPayload(t *testing.T) {
	payload := map[string]any{
		"query":           "ENG",
		"teamKey":         "ENG",
		"issueIdentifier": "ENG-42",
		"ticket": map[string]any{
			"id":          "123",
			"url":         "https://acme.zendesk.com/agent/tickets/123",
			"subject":     "Customer cannot export",
			"description": "Export fails",
			"status":      "open",
			"requester":   map[string]any{"id": "9", "name": "Ada", "email": "ADA@EXAMPLE.COM"},
			"organization": map[string]any{"id": "7", "name": "Acme"},
		},
	}
	got := zendeskTicketActionFromPayload(payload)
	if got.Query != "ENG" || got.TeamKey != "ENG" || got.IssueID != "ENG-42" {
		t.Fatalf("parsed action = %#v", got)
	}
	if got.Subdomain != "acme" || got.Ticket.ID != "123" || got.Ticket.Requester.Email != "ada@example.com" || got.Ticket.Organization.Name != "Acme" {
		t.Fatalf("parsed ticket = %#v", got.Ticket)
	}
}

func TestUpdateZendeskTicket(t *testing.T) {
	var got map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v2/tickets/123.json" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		username, password, ok := r.BasicAuth()
		if !ok || username != "admin@example.com/token" || password != "token" {
			t.Fatalf("basic auth = %q %q %v", username, password, ok)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(`{"ticket":{"id":123}}`))
	}))
	defer server.Close()
	t.Setenv("ZENDESK_API_BASE_URL", server.URL)

	err := updateZendeskTicket(t.Context(), server.Client(), zendeskCredential{Subdomain: "acme", AccountURL: "https://acme.zendesk.com", Email: "admin@example.com", APIToken: "token"}, "123", "Done")
	if err != nil {
		t.Fatal(err)
	}
	ticket := got["ticket"].(map[string]any)
	comment := ticket["comment"].(map[string]any)
	if comment["body"] != "Done" || comment["public"] != false || ticket["status"] != "open" {
		t.Fatalf("payload = %#v", got)

	}
}

type recordingFrontLinkExecutor struct {
	query string
	args  []any
}

func (e *recordingFrontLinkExecutor) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	e.query = query
	e.args = args
	return pgconn.CommandTag{}, nil
}

func TestInsertFrontIssueLinkUsesConversationMessageID(t *testing.T) {
	executor := &recordingFrontLinkExecutor{}
	install := frontInstallRecord{WorkspaceID: "00000000-0000-4000-8000-000000000001", IntegrationID: "00000000-0000-4000-8000-000000000002", ExternalID: "cmp_123", Metadata: map[string]any{"companyId": "cmp_meta"}}
	conversation := frontConversationRef{ID: "cnv_123", InboxID: "inb_1", MessageID: "msg_123", Permalink: "https://front.example/cnv_123"}

	if err := insertFrontIssueLinkTx(t.Context(), executor, install, "00000000-0000-4000-8000-000000000003", conversation, false); err != nil {
		t.Fatal(err)
	}
	if got := executor.args[6]; got != "msg_123" {
		t.Fatalf("external_message_ts = %#v", got)
	}
	if got := executor.args[8]; got != "cnv_123:00000000-0000-4000-8000-000000000003" {
		t.Fatalf("source_event_id = %#v", got)
	}
}

func TestInsertFrontIssueLinkFallbackMessageIDIsPerConversationLink(t *testing.T) {
	executor := &recordingFrontLinkExecutor{}
	install := frontInstallRecord{WorkspaceID: "00000000-0000-4000-8000-000000000001", IntegrationID: "00000000-0000-4000-8000-000000000002", Metadata: map[string]any{"companyId": "cmp_meta"}}
	conversation := frontConversationRef{ID: "cnv_123", InboxID: "inb_1"}

	if err := insertFrontIssueLinkTx(t.Context(), executor, install, "00000000-0000-4000-8000-000000000003", conversation, false); err != nil {
		t.Fatal(err)
	}
	if got := executor.args[6]; got != "cnv_123:00000000-0000-4000-8000-000000000003" {
		t.Fatalf("external_message_ts fallback = %#v", got)
	}
}

func TestInsertFrontCreatedIssueLinkUsesCreatedSource(t *testing.T) {
	executor := &recordingFrontLinkExecutor{}
	install := frontInstallRecord{WorkspaceID: "00000000-0000-4000-8000-000000000001", IntegrationID: "00000000-0000-4000-8000-000000000002", Metadata: map[string]any{"companyId": "cmp_meta"}}
	conversation := frontConversationRef{ID: "cnv_123", InboxID: "inb_1"}

	if err := insertFrontIssueLinkTx(t.Context(), executor, install, "00000000-0000-4000-8000-000000000003", conversation, true); err != nil {
		t.Fatal(err)
	}
	if got := executor.args[6]; got != "created:cnv_123" {
		t.Fatalf("external_message_ts fallback = %#v", got)
	}
	if got := executor.args[8]; got != "created:cnv_123" {
		t.Fatalf("source_event_id = %#v", got)
	}
}
