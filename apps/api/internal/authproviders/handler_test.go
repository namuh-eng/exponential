package authproviders

import "testing"

func TestWorkspaceSlugFromCallbackURL(t *testing.T) {
	got := workspaceSlugFromCallbackURL("/foreverbrowsing/settings/security", "http://localhost:7015")
	if got != "foreverbrowsing" {
		t.Fatalf("slug = %q", got)
	}
	if got := workspaceSlugFromCallbackURL("https://evil.example/foreverbrowsing/inbox", "http://localhost:7015"); got != "" {
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

func TestExtractEmailDomain(t *testing.T) {
	if got := extractEmailDomain("Person@Example.com"); got != "example.com" {
		t.Fatalf("domain = %q", got)
	}
	if got := extractEmailDomain("not-an-email"); got != "" {
		t.Fatalf("invalid domain = %q", got)
	}
}

func TestReadSAMLDiscoverySettings(t *testing.T) {
	settings := readSAMLDiscoverySettings([]byte(`{"saml":{"enabled":true,"domains":["Example.com"],"ssoUrl":"https://idp.example.com/saml"}}`))
	if !settings.enabled || settings.url != "https://idp.example.com/saml" || len(settings.domains) != 1 || settings.domains[0] != "example.com" {
		t.Fatalf("settings = %#v", settings)
	}
}
