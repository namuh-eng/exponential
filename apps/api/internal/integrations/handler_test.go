package integrations

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
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

func TestSlackTeamID(t *testing.T) {
	if got := slackTeamID(map[string]any{"team_id": "T123"}); got != "T123" {
		t.Fatalf("top-level team id = %q", got)
	}
	if got := slackTeamID(map[string]any{"team": map[string]any{"id": "T456"}}); got != "T456" {
		t.Fatalf("nested team id = %q", got)
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
