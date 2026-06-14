package demo

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEnabledRequiresFlagInProduction(t *testing.T) {
	t.Setenv("EXPONENTIAL_API_ENVIRONMENT", "production")
	t.Setenv("EXPONENTIAL_PUBLIC_DEMO_ENABLED", "")
	if Enabled() {
		t.Fatal("demo access must be disabled by default in production")
	}
	t.Setenv("EXPONENTIAL_PUBLIC_DEMO_ENABLED", "true")
	if !Enabled() {
		t.Fatal("demo access should be enabled when explicitly configured")
	}
}

func TestSettingsMarkDemo(t *testing.T) {
	if !settingsMarkDemo([]byte(`{"demo":{"enabled":true}}`)) {
		t.Fatal("expected demo settings to be detected")
	}
	if settingsMarkDemo([]byte(`{"demo":{"enabled":false}}`)) {
		t.Fatal("disabled demo settings should not be detected")
	}
}

func TestSideEffectPathBlocksHighRiskDemoSurfaces(t *testing.T) {
	blocked := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/attachments/presigned-upload"},
		{http.MethodPost, "/api/personal-access-tokens"},
		{http.MethodGet, "/api/oauth/authorize"},
		{http.MethodPost, "/api/integrations/slack/connect"},
		{http.MethodPatch, "/api/workspaces/current/billing"},
		{http.MethodPost, "/api/workspaces/current/api"},
	}
	for _, tc := range blocked {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		if !sideEffectPath(req) {
			t.Fatalf("%s %s should be guarded", tc.method, tc.path)
		}
	}

	allowed := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/integrations"},
		{http.MethodGet, "/api/personal-access-tokens"},
		{http.MethodGet, "/api/workspaces/current/billing"},
		{http.MethodPost, "/api/issues"},
	}
	for _, tc := range allowed {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		if sideEffectPath(req) {
			t.Fatalf("%s %s should remain available", tc.method, tc.path)
		}
	}
}

func TestSetBrowserSessionCookies(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "https://example.test/api/demo/session", nil)
	recorder := httptest.NewRecorder()
	expires := time.Now().UTC().Add(time.Hour)

	setBrowserSessionCookies(recorder, req, workspace{ID: "workspace-1", URLSlug: WorkspaceSlug}, "signed-token", expires)

	cookies := map[string]*http.Cookie{}
	for _, cookie := range recorder.Result().Cookies() {
		cookies[cookie.Name] = cookie
	}
	for _, name := range []string{"activeWorkspaceId", "activeWorkspaceSlug", "exponential_session"} {
		if cookies[name] == nil {
			t.Fatalf("missing cookie %s", name)
		}
		if !cookies[name].Secure || cookies[name].SameSite != http.SameSiteLaxMode || cookies[name].Path != "/" {
			t.Fatalf("cookie %s attributes = %#v", name, cookies[name])
		}
	}
	if cookies["activeWorkspaceSlug"].Value != WorkspaceSlug {
		t.Fatalf("active workspace slug = %q", cookies["activeWorkspaceSlug"].Value)
	}
}

func TestResetIsIdempotentWithDatabase(t *testing.T) {
	if os.Getenv("RUN_DB_TESTS") != "1" {
		t.Skip("set RUN_DB_TESTS=1 with a migrated Postgres to run demo reset integration test")
	}
	dsn := os.Getenv("EXPONENTIAL_API_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("EXPONENTIAL_API_DATABASE_URL or DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect database: %v", err)
	}
	defer pool.Close()

	for i := 0; i < 2; i++ {
		if _, _, err := Reset(ctx, pool); err != nil {
			t.Fatalf("reset %d failed: %v", i+1, err)
		}
	}
	var workspaces, issues int
	if err := pool.QueryRow(ctx, `select count(*) from workspace where url_slug=$1`, WorkspaceSlug).Scan(&workspaces); err != nil {
		t.Fatalf("count workspaces: %v", err)
	}
	if err := pool.QueryRow(ctx, `select count(*) from issue i join team t on t.id=i.team_id join workspace w on w.id=t.workspace_id where w.url_slug=$1`, WorkspaceSlug).Scan(&issues); err != nil {
		t.Fatalf("count issues: %v", err)
	}
	if workspaces != 1 || issues < 8 {
		t.Fatalf("seed counts workspaces=%d issues=%d", workspaces, issues)
	}
}
