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
