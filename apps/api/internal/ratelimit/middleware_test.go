package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/namuh-eng/exponential/apps/api/internal/auth"
)

func requestWithPrincipal(tokenID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/v1/issues", nil)
	ctx := auth.WithPrincipal(req.Context(), auth.Principal{UserID: "user-1", WorkspaceID: "workspace-1", APIKeyID: tokenID})
	return req.WithContext(ctx)
}

func TestMiddlewareSetsRateLimitHeadersAndLimitsPerToken(t *testing.T) {
	now := time.Date(2026, 5, 25, 12, 34, 10, 0, time.UTC)
	limiter := New(2, func() time.Time { return now })
	handler := limiter.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	first := httptest.NewRecorder()
	handler.ServeHTTP(first, requestWithPrincipal("pat-1"))
	if first.Code != http.StatusNoContent {
		t.Fatalf("first status = %d", first.Code)
	}
	if first.Header().Get("X-RateLimit-Limit") != "2" || first.Header().Get("X-RateLimit-Remaining") != "1" || first.Header().Get("X-RateLimit-Reset") != "1779712500" {
		t.Fatalf("first headers = %#v", first.Header())
	}

	second := httptest.NewRecorder()
	handler.ServeHTTP(second, requestWithPrincipal("pat-1"))
	if second.Code != http.StatusNoContent || second.Header().Get("X-RateLimit-Remaining") != "0" {
		t.Fatalf("second status/headers = %d %#v", second.Code, second.Header())
	}

	third := httptest.NewRecorder()
	handler.ServeHTTP(third, requestWithPrincipal("pat-1"))
	if third.Code != http.StatusTooManyRequests || third.Header().Get("X-RateLimit-Remaining") != "0" {
		t.Fatalf("third status/headers = %d %#v", third.Code, third.Header())
	}

	otherToken := httptest.NewRecorder()
	handler.ServeHTTP(otherToken, requestWithPrincipal("pat-2"))
	if otherToken.Code != http.StatusNoContent || otherToken.Header().Get("X-RateLimit-Remaining") != "1" {
		t.Fatalf("other token status/headers = %d %#v", otherToken.Code, otherToken.Header())
	}
}

func TestPublicMiddlewareLimitsByClientIP(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("PLAYWRIGHT_TEST", "false")
	now := time.Date(2026, 5, 25, 12, 34, 10, 0, time.UTC)
	limiter := New(1, func() time.Time { return now })
	handler := limiter.PublicHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	firstReq := httptest.NewRequest(http.MethodGet, "/v1/workspaces/invite-preview?token=inv_test", nil)
	firstReq.RemoteAddr = "198.51.100.20:4321"
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, firstReq)
	if first.Code != http.StatusNoContent {
		t.Fatalf("first status = %d", first.Code)
	}

	secondReq := httptest.NewRequest(http.MethodGet, "/v1/workspaces/invite-preview?token=inv_test", nil)
	secondReq.RemoteAddr = "198.51.100.20:4322"
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, secondReq)
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second status = %d", second.Code)
	}

	otherReq := httptest.NewRequest(http.MethodGet, "/v1/workspaces/invite-preview?token=inv_test", nil)
	otherReq.RemoteAddr = "198.51.100.21:4321"
	other := httptest.NewRecorder()
	handler.ServeHTTP(other, otherReq)
	if other.Code != http.StatusNoContent {
		t.Fatalf("other status = %d", other.Code)
	}
}
