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

func TestLeaveWorkspaceRedirect(t *testing.T) {
	if got := leaveWorkspaceRedirect(nil); got != "/create-workspace" {
		t.Fatalf("nil workspace redirect = %q", got)
	}
	workspaceID := "14000000-0000-0000-0000-000000000002"
	if got := leaveWorkspaceRedirect(&workspaceID); got != "/" {
		t.Fatalf("next workspace redirect = %q", got)
	}
}
