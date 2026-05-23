package account

import "testing"

func TestNormalizeUsername(t *testing.T) {
	if got := normalizeUsername(" Jaeyun "); got != "jaeyun" {
		t.Fatalf("username = %q", got)
	}
}

func TestNormalizeTimezone(t *testing.T) {
	if got := normalizeTimezone("UTC"); got != "UTC" {
		t.Fatalf("timezone = %q", got)
	}
	if got := normalizeTimezone("Not/AZone"); got != "" {
		t.Fatalf("invalid timezone = %q", got)
	}
}
