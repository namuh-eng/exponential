package inbound

import "testing"

func TestParseRecipient(t *testing.T) {
	rec := parseRecipient("eng.foreverbrowsing@team.linear.app")
	if rec == nil || rec.TeamKey != "ENG" || rec.WorkspaceSlug != "foreverbrowsing" {
		t.Fatalf("recipient = %#v", rec)
	}
	if parseRecipient("bad@example.com") != nil {
		t.Fatal("bad domain should not parse")
	}
}

func TestNormalizeDescription(t *testing.T) {
	if got := normalizeDescription("hello"); got != "<p>hello</p>" {
		t.Fatalf("description = %q", got)
	}
	if got := normalizeDescription("<p>hello</p>"); got != "<p>hello</p>" {
		t.Fatalf("html description = %q", got)
	}
}
