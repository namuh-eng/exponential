package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBearerTokenReadsAuthorization(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/issues", nil)
	req.Header.Set("Authorization", "Bearer pat_secret")
	if got := bearerToken(req); got != "pat_secret" {
		t.Fatalf("token = %q", got)
	}
}

func TestBearerTokenReadsAccessTokenQuery(t *testing.T) {
	req := httptest.NewRequest("GET", "/v1/sync/ws?access_token=pat_query", nil)
	if got := bearerToken(req); got != "pat_query" {
		t.Fatalf("token = %q", got)
	}
}

func TestKratosWhoamiEmail(t *testing.T) {
	payload := kratosWhoami{}
	payload.Identity.Traits = map[string]any{"email": " user@example.com "}
	if got := payload.Email(); got != "user@example.com" {
		t.Fatalf("email = %q", got)
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
	req.Header.Set("Referer", "http://localhost:3015/new-workspace/team/ENG/all")
	req.AddCookie(&http.Cookie{Name: "activeWorkspaceId", Value: "cookie-id"})
	req.AddCookie(&http.Cookie{Name: "activeWorkspaceSlug", Value: "old-workspace"})

	got := requestedWorkspace(req)
	if got.ID != "" || got.Slug != "new-workspace" {
		t.Fatalf("workspace = %#v", got)
	}
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
