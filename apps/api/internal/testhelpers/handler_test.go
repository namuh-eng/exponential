package testhelpers

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSetBrowserSessionCookies(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "https://example.test/v1/test/create-session", nil)
	response := httptest.NewRecorder()
	expires := time.Now().UTC().Add(time.Hour)

	setBrowserSessionCookies(response, request, publicWorkspace{ID: "workspace-1", URLSlug: "foreverbrowsing"}, "signed-token", expires)

	cookies := map[string]*http.Cookie{}
	for _, cookie := range response.Result().Cookies() {
		cookies[cookie.Name] = cookie
	}
	for _, name := range []string{"activeWorkspaceId", "activeWorkspaceSlug", "exponential_session"} {
		if cookies[name] == nil {
			t.Fatalf("missing cookie %s in %#v", name, cookies)
		}
		if !cookies[name].Secure || cookies[name].SameSite != http.SameSiteLaxMode || cookies[name].Path != "/" {
			t.Fatalf("cookie %s attributes = %#v", name, cookies[name])
		}
	}
	if got := cookies["activeWorkspaceSlug"].Value; got != "foreverbrowsing" {
		t.Fatalf("active workspace slug = %q", got)
	}
	if got := cookies["exponential_session"].Value; got != "signed-token" {
		t.Fatalf("session cookie = %q", got)
	}
}

func TestAllowedDisabledInProduction(t *testing.T) {
	t.Setenv("EXPONENTIAL_API_ENVIRONMENT", "production")
	t.Setenv("PLAYWRIGHT_TEST", "true")
	if allowed() {
		t.Fatal("test helpers must be disabled in production even when PLAYWRIGHT_TEST is true")
	}
}

func TestAllowedInPlaywrightOutsideProduction(t *testing.T) {
	t.Setenv("EXPONENTIAL_API_ENVIRONMENT", "staging")
	t.Setenv("PLAYWRIGHT_TEST", "true")
	if !allowed() {
		t.Fatal("test helpers should remain available for non-production playwright runs")
	}
}
