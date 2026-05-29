package authproviders

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

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

// Fix 3: PKCE S256 challenge derivation (RFC 7636 §4.2).
func TestPKCES256Challenge(t *testing.T) {
	// Known vector: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	// challenge = BASE64URL(SHA256(ASCII(verifier)))
	verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	challenge := pkceS256Challenge(verifier)
	// Must be base64url without padding, non-empty, no + / = characters.
	if challenge == "" {
		t.Fatal("challenge is empty")
	}
	if strings.ContainsAny(challenge, "+/=") {
		t.Fatalf("challenge contains non-base64url characters: %q", challenge)
	}
	// Re-derive and confirm determinism.
	if got2 := pkceS256Challenge(verifier); got2 != challenge {
		t.Fatalf("pkceS256Challenge not deterministic: %q != %q", challenge, got2)
	}
}

func TestPKCES256ChallengeVariesWithVerifier(t *testing.T) {
	c1 := pkceS256Challenge("verifier-one")
	c2 := pkceS256Challenge("verifier-two")
	if c1 == c2 {
		t.Fatal("different verifiers produced the same challenge")
	}
}

func TestPostAuthCompletionURL(t *testing.T) {
	t.Setenv("PUBLIC_BASE_URL", "https://app.example")
	req := httptest.NewRequest("GET", "https://app.example/api/auth/google/callback", nil)
	got := postAuthCompletionURL(req, "/foreverbrowsing/inbox?view=list")
	want := "https://app.example/auth/complete?callbackUrl=%2Fforeverbrowsing%2Finbox%3Fview%3Dlist"
	if got != want {
		t.Fatalf("completion URL = %q, want %q", got, want)
	}

	if got := postAuthCompletionURL(req, "https://evil.example/inbox"); got != "https://app.example/auth/complete?callbackUrl=%2F" {
		t.Fatalf("unsafe completion URL = %q", got)
	}
}

func TestSecureCookieUsesConfiguredHTTPSAppURL(t *testing.T) {
	t.Setenv("PUBLIC_BASE_URL", "https://app.example")
	req := httptest.NewRequest("GET", "http://internal-alb/api/auth/google/callback", nil)
	req.Header.Set("X-Forwarded-Proto", "http")

	if !secureCookie(req) {
		t.Fatal("secureCookie() = false, want true for HTTPS public app URL")
	}
}

func TestSetSessionCookieClearsParentDomainVariants(t *testing.T) {
	t.Setenv("PUBLIC_BASE_URL", "https://exponential.namuh.co")
	req := httptest.NewRequest("GET", "http://internal-alb/api/auth/google/callback", nil)
	rec := httptest.NewRecorder()

	setSessionCookie(rec, req, "signed-token", time.Now().Add(time.Hour))

	cookies := rec.Result().Cookies()
	if len(cookies) != 4 {
		t.Fatalf("Set-Cookie count = %d, want host clear, domain clears, and new session", len(cookies))
	}
	if cookies[0].Name != "exponential_session" || cookies[0].MaxAge != -1 || cookies[0].Domain != "" {
		t.Fatalf("host-only clear cookie = %#v", cookies[0])
	}
	if cookies[1].Domain != "exponential.namuh.co" || cookies[1].MaxAge != -1 {
		t.Fatalf("host domain clear cookie = %#v", cookies[1])
	}
	if cookies[2].Domain != "namuh.co" || cookies[2].MaxAge != -1 {
		t.Fatalf("parent domain clear cookie = %#v", cookies[2])
	}
	if cookies[3].Value != "signed-token" || cookies[3].Domain != "" {
		t.Fatalf("session cookie = %#v", cookies[3])
	}
}
