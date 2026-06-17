package mcp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/namuh-eng/exponential/apps/api/internal/auth"
)

func TestToolListMatchesRemoteContract(t *testing.T) {
	names := toolNames()
	mustContain := []string{
		"exponential_search_issues",
		"exponential_get_issue",
		"exponential_create_issue",
		"exponential_update_issue",
		"exponential_list_projects",
		"exponential_get_project",
		"exponential_create_project",
		"exponential_update_project",
		"exponential_list_teams",
		"exponential_get_team_context",
		"exponential_list_team_issues",
		"exponential_list_team_cycles",
		"exponential_list_views",
		"exponential_get_view",
		"exponential_create_view",
		"exponential_update_view",
		"exponential_create_comment",
		"exponential_update_comment",
		"exponential_delete_comment",
	}
	for _, name := range mustContain {
		if !contains(names, name) {
			t.Fatalf("tool %s missing from %#v", name, names)
		}
	}
	for _, forbidden := range []string{"exponential_list_customers", "exponential_list_comments"} {
		if contains(names, forbidden) {
			t.Fatalf("tool %s should not be registered", forbidden)
		}
	}
}

func TestCallToolEnforcesReadWriteScopes(t *testing.T) {
	h := Handler{}
	noRead := auth.Principal{UserID: "user-1", WorkspaceID: "workspace-1", APIKeyID: "token-1", Scopes: []string{"write"}, IsPersonalAccessToken: true}
	readResult := h.callTool(context.Background(), mcpContext{Principal: noRead}, "exponential_search_issues", map[string]any{"query": "mcp"})
	if !readResult.IsError || !strings.Contains(readResult.Content[0]["text"], "read scope") {
		t.Fatalf("write-only PAT should be blocked for read tools: %#v", readResult)
	}
	readOnly := auth.Principal{UserID: "user-1", WorkspaceID: "workspace-1", APIKeyID: "token-1", Scopes: []string{"read"}, IsPersonalAccessToken: true}
	writeResult := h.callTool(context.Background(), mcpContext{Principal: readOnly}, "exponential_create_issue", map[string]any{"title": "MCP"})
	if !writeResult.IsError || !strings.Contains(writeResult.Content[0]["text"], "write scope") {
		t.Fatalf("read-only PAT should be blocked for write tools: %#v", writeResult)
	}
}

func TestRequirePATRejectsBrowserSessions(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/mcp", nil)
	req = req.WithContext(auth.WithPrincipal(req.Context(), auth.Principal{UserID: "user-1", WorkspaceID: "workspace-1", Scopes: nil}))
	rec := httptest.NewRecorder()
	_, ok := requirePAT(rec, req)
	if ok {
		t.Fatal("browser sessions must not authenticate remote MCP")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestRequirePATRejectsLegacyAPIKeys(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/mcp", nil)
	req = req.WithContext(auth.WithPrincipal(req.Context(), auth.Principal{UserID: "user-1", WorkspaceID: "workspace-1", APIKeyID: "lin_api_1"}))
	rec := httptest.NewRecorder()
	_, ok := requirePAT(rec, req)
	if ok {
		t.Fatal("legacy workspace API keys must not authenticate remote MCP")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestRedactArgsOmitsSecretsAndRawContent(t *testing.T) {
	got := redactArgs(map[string]any{"authorization": "Bearer pat_secret", "body": "raw comment", "query": "mcp"})
	if _, ok := got["authorization"]; ok {
		t.Fatal("authorization leaked into audit metadata")
	}
	if got["body"] == "raw comment" {
		t.Fatal("raw body leaked into audit metadata")
	}
	if got["query"] != "mcp" {
		t.Fatalf("query metadata lost: %#v", got)
	}
}

func contains(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}
