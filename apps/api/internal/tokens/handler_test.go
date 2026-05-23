package tokens

import (
	"strings"
	"testing"
)

func TestNormalizeScopes(t *testing.T) {
	got := normalizeScopes([]string{"Read", "", "read", "write"})
	if len(got) != 2 || got[0] != "read" || got[1] != "write" {
		t.Fatalf("scopes = %#v", got)
	}
}

func TestNewPATSecret(t *testing.T) {
	secret, err := newPATSecret()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(secret, "pat_") || len(secret) < 40 {
		t.Fatalf("unexpected secret shape: %q", secret)
	}
}
