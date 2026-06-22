package scim

import "testing"

func TestParseUserFilterSupported(t *testing.T) {
	cases := []struct {
		input    string
		userName string
		email    string
	}{
		{input: `userName eq "Ada@Example.COM"`, userName: "ada@example.com"},
		{input: `emails[primary eq true].value eq "Ada@Example.COM"`, email: "ada@example.com"},
		{input: `emails[primary eq true and value eq "Ada@Example.COM"]`, email: "ada@example.com"},
		{input: `emails eq "Ada@Example.COM"`, email: "ada@example.com"},
		{input: `emails[primary eq true]`},
		{input: ``},
	}
	for _, tc := range cases {
		got, err := parseUserFilter(tc.input)
		if err != nil {
			t.Fatalf("parseUserFilter(%q) error = %v", tc.input, err)
		}
		if got.userName != tc.userName || got.email != tc.email {
			t.Fatalf("parseUserFilter(%q) = %#v", tc.input, got)
		}
	}
}

func TestParseUserFilterUnsupported(t *testing.T) {
	if _, err := parseUserFilter(`userName co "ada"`); err == nil {
		t.Fatal("unsupported filter should return an error")
	}
}

func TestSCIMTokenHashMatchesSettingsTokenHash(t *testing.T) {
	secret := "scim_test_secret"
	if got := hashSCIMToken(secret); got != "db17209a5741326c1f0a1bd747a5ce306b4eb234ec59ea4567553e0efeb66930" {
		t.Fatalf("hashSCIMToken() = %q", got)
	}
}

func TestNormalizeRole(t *testing.T) {
	for _, role := range []string{"admin", "member", "guest"} {
		got, err := normalizeRole(role)
		if err != nil || got != role {
			t.Fatalf("normalizeRole(%q) = %q, %v", role, got, err)
		}
	}
	if _, err := normalizeRole("owner"); err == nil {
		t.Fatal("owner must not be a SCIM-managed role group")
	}
}
