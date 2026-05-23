package authproviders

import "testing"

func TestWorkspaceSlugFromCallbackURL(t *testing.T) {
	got := workspaceSlugFromCallbackURL("/foreverbrowsing/settings/security", "http://localhost:3015")
	if got != "foreverbrowsing" {
		t.Fatalf("slug = %q", got)
	}
	if got := workspaceSlugFromCallbackURL("https://evil.example/foreverbrowsing/inbox", "http://localhost:3015"); got != "" {
		t.Fatalf("cross-origin slug = %q", got)
	}
}

func TestReadAuthSettings(t *testing.T) {
	settings := []byte(`{"security":{"authentication":{"google":false,"emailPasskey":false}}}`)
	got := readAuthSettings(settings)
	if got.Google || got.EmailPasskey {
		t.Fatalf("settings = %#v", got)
	}
	defaults := readAuthSettings([]byte(`{}`))
	if !defaults.Google || !defaults.EmailPasskey {
		t.Fatalf("defaults = %#v", defaults)
	}
}

func TestAccountProviderCapability(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	got := accountProviderCapability(false, "GitHub")
	if got.Configured || got.DevLinking || got.UnavailableReason == nil {
		t.Fatalf("capability = %#v", got)
	}
}
