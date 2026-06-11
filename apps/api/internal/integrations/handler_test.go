package integrations

import (
	"encoding/json"
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

func TestIntegrationJSONOmitsCredentialFields(t *testing.T) {
	payload, err := json.Marshal(Integration{
		CatalogItem: CatalogItem{Provider: "slack", Name: "Slack", Description: "Slack"},
		Status:      "connected",
		Actions:     integrationActions(true, true, "connected", nil),
		Health:      Health{},
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
