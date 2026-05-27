package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestBearerTokenReadsAuthorization(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/issues", nil)
	req.Header.Set("Authorization", "Bearer pat_secret")
	if got := bearerToken(req); got != "pat_secret" {
		t.Fatalf("token = %q", got)
	}
}

// Fix 1: ?access_token= must only work for WebSocket upgrades.
func TestBearerTokenAccessTokenQueryIgnoredForNonWebSocket(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/issues?access_token=pat_query", nil)
	if got := bearerToken(req); got != "" {
		t.Fatalf("expected empty token for non-WS request, got %q", got)
	}
}

func TestBearerTokenAccessTokenQueryHonouredForWebSocket(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/sync/ws?access_token=pat_query", nil)
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "websocket")
	if got := bearerToken(req); got != "pat_query" {
		t.Fatalf("token = %q, want pat_query", got)
	}
}

func TestIsWebSocketUpgrade(t *testing.T) {
	ws := httptest.NewRequest("GET", "/v1/sync/ws", nil)
	ws.Header.Set("Connection", "Upgrade")
	ws.Header.Set("Upgrade", "websocket")
	if !isWebSocketUpgrade(ws) {
		t.Fatal("expected WebSocket upgrade to be detected")
	}
	plain := httptest.NewRequest("GET", "/v1/issues", nil)
	if isWebSocketUpgrade(plain) {
		t.Fatal("plain request should not be treated as WebSocket upgrade")
	}
}

// Fix 2: CSRF Origin/Referer check.
func TestCSRFDeniedMissingOrigin(t *testing.T) {
	t.Setenv("EXPONENTIAL_APP_URL", "https://app.example.com")
	req := httptest.NewRequest("POST", "/v1/issues", nil)
	denied, reason := csrfDenied(req)
	if !denied {
		t.Fatal("expected CSRF denial for missing origin")
	}
	if reason != "missing_origin" {
		t.Fatalf("reason = %q, want missing_origin", reason)
	}
}

func TestCSRFAllowedMatchingOrigin(t *testing.T) {
	t.Setenv("EXPONENTIAL_APP_URL", "https://app.example.com")
	req := httptest.NewRequest("POST", "/v1/issues", nil)
	req.Header.Set("Origin", "https://app.example.com")
	denied, _ := csrfDenied(req)
	if denied {
		t.Fatal("expected CSRF to pass for matching origin")
	}
}

func TestCSRFDeniedWrongOrigin(t *testing.T) {
	t.Setenv("EXPONENTIAL_APP_URL", "https://app.example.com")
	req := httptest.NewRequest("POST", "/v1/issues", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	denied, reason := csrfDenied(req)
	if !denied {
		t.Fatal("expected CSRF denial for wrong origin")
	}
	if reason != "origin_not_allowed" {
		t.Fatalf("reason = %q, want origin_not_allowed", reason)
	}
}

func TestCSRFAllowedFromReferer(t *testing.T) {
	t.Setenv("EXPONENTIAL_APP_URL", "https://app.example.com")
	req := httptest.NewRequest("POST", "/v1/issues", nil)
	req.Header.Set("Referer", "https://app.example.com/workspace/issues")
	denied, _ := csrfDenied(req)
	if denied {
		t.Fatal("expected CSRF to pass when Referer matches")
	}
}

func TestCSRFNoAppURLConfigured(t *testing.T) {
	t.Setenv("EXPONENTIAL_APP_URL", "")
	t.Setenv("PUBLIC_BASE_URL", "")
	req := httptest.NewRequest("POST", "/v1/issues", nil)
	// No origin configured → fail-open.
	denied, _ := csrfDenied(req)
	if denied {
		t.Fatal("expected CSRF to pass when no app URL is configured (fail-open)")
	}
}

func TestRequestedWorkspaceID(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/issues?workspace_id=query-workspace", nil)
	req.Header.Set("X-Workspace-Id", "header-workspace")
	if got := requestedWorkspaceID(req); got != "header-workspace" {
		t.Fatalf("workspace id = %q", got)
	}
}

func TestRequestedWorkspacePrefersRefererSlugOverActiveCookie(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/issues", nil)
	req.Header.Set("Referer", "http://localhost:7015/new-workspace/team/ENG/all")
	req.AddCookie(&http.Cookie{Name: "activeWorkspaceId", Value: "cookie-id"})
	req.AddCookie(&http.Cookie{Name: "activeWorkspaceSlug", Value: "old-workspace"})

	got := requestedWorkspace(req)
	if got.ID != "" || got.Slug != "new-workspace" {
		t.Fatalf("workspace = %#v", got)
	}
}

// Fix 4: clientIP trusts X-Forwarded-For only when peer is a trusted proxy.
func TestClientIPUsesPeerWhenNoTrustedProxies(t *testing.T) {
	// Reset the once so a fresh load happens with the test env.
	trustedProxyOnce = sync.Once{}
	trustedProxyNetworks = nil
	t.Setenv("EXPONENTIAL_TRUSTED_PROXIES", "")
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	req.RemoteAddr = "10.0.0.1:9999"
	got := clientIP(req)
	if got != "10.0.0.1" {
		t.Fatalf("expected RemoteAddr peer 10.0.0.1, got %q", got)
	}
	// Restore state for other tests.
	trustedProxyOnce = sync.Once{}
	trustedProxyNetworks = nil
}

func TestClientIPIgnoresTestHeaderOutsideTestMode(t *testing.T) {
	trustedProxyOnce = sync.Once{}
	trustedProxyNetworks = nil
	t.Setenv("NODE_ENV", "production")
	t.Setenv("PLAYWRIGHT_TEST", "false")
	t.Setenv("EXPONENTIAL_TRUSTED_PROXIES", "")
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Test-Client-IP", "198.51.100.10")
	req.RemoteAddr = "10.0.0.1:9999"
	got := clientIP(req)
	if got != "10.0.0.1" {
		t.Fatalf("expected RemoteAddr peer 10.0.0.1, got %q", got)
	}
	trustedProxyOnce = sync.Once{}
	trustedProxyNetworks = nil
}

func TestClientIPUsesTestHeaderInTestMode(t *testing.T) {
	trustedProxyOnce = sync.Once{}
	trustedProxyNetworks = nil
	t.Setenv("PLAYWRIGHT_TEST", "true")
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Test-Client-IP", "198.51.100.10")
	req.RemoteAddr = "10.0.0.1:9999"
	got := clientIP(req)
	if got != "198.51.100.10" {
		t.Fatalf("expected test header IP 198.51.100.10, got %q", got)
	}
	trustedProxyOnce = sync.Once{}
	trustedProxyNetworks = nil
}

func TestClientIPHonoursXFFWhenPeerIsTrusted(t *testing.T) {
	trustedProxyOnce = sync.Once{}
	trustedProxyNetworks = nil
	t.Setenv("EXPONENTIAL_TRUSTED_PROXIES", "10.0.0.0/24")
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 10.0.0.1")
	req.RemoteAddr = "10.0.0.1:9999"
	got := clientIP(req)
	if got != "1.2.3.4" {
		t.Fatalf("expected XFF client 1.2.3.4, got %q", got)
	}
	trustedProxyOnce = sync.Once{}
	trustedProxyNetworks = nil
}

func TestClientIPIgnoresXFFWhenPeerNotTrusted(t *testing.T) {
	trustedProxyOnce = sync.Once{}
	trustedProxyNetworks = nil
	t.Setenv("EXPONENTIAL_TRUSTED_PROXIES", "10.0.0.0/24")
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	req.RemoteAddr = "192.168.1.5:9999"
	got := clientIP(req)
	if got != "192.168.1.5" {
		t.Fatalf("expected RemoteAddr peer 192.168.1.5, got %q", got)
	}
	trustedProxyOnce = sync.Once{}
	trustedProxyNetworks = nil
}

func TestVerifySignedSessionToken(t *testing.T) {
	t.Setenv("EXPONENTIAL_DEV_SESSION_SECRET", "test-secret")
	raw := "session-token"
	mac := hmac.New(sha256.New, []byte("test-secret"))
	mac.Write([]byte(raw))
	signed := raw + "." + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	got, ok := VerifySignedSessionToken(signed)
	if !ok || got != raw {
		t.Fatalf("VerifySignedSessionToken() = %q, %v", got, ok)
	}
	if _, ok := VerifySignedSessionToken(raw + ".bad"); ok {
		t.Fatal("invalid signature verified")
	}
}
