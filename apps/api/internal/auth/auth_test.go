package auth

import (
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
