package inbound

import "testing"

func TestParseRecipient(t *testing.T) {
	rec := parseRecipient("eng.foreverbrowsing@team.exponential.app")
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
	got := normalizeDescription(`<p onclick="alert(1)">hi<script>alert(1)</script><a href="javascript:alert(1)">bad</a></p>`)
	if got != `<p>hibad</p>` {
		t.Fatalf("sanitized description = %q", got)
	}
}
