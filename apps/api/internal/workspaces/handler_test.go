package workspaces

import "testing"

func TestSanitizeSlug(t *testing.T) {
	if got := sanitizeSlug(" My Great Workspace! "); got != "my-great-workspace" {
		t.Fatalf("slug = %q", got)
	}
}

func TestValidateSlug(t *testing.T) {
	if err := validateSlug("ok-slug"); err != nil {
		t.Fatalf("expected valid slug: %v", err)
	}
	if err := validateSlug("Bad Slug"); err == nil {
		t.Fatal("expected uppercase/space slug to fail")
	}
	if err := validateSlug("x"); err == nil {
		t.Fatal("expected short slug to fail")
	}
}

func TestTeamKeyBase(t *testing.T) {
	cases := map[string]string{
		"Exponential": "EXP",
		"Linear Clone": "LCX",
		"1 2": "WRK",
	}
	for input, want := range cases {
		if got := teamKeyBase(input); got != want {
			t.Fatalf("teamKeyBase(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestRoles(t *testing.T) {
	if !isManager("owner") || !isManager("admin") || isManager("member") {
		t.Fatal("manager role logic drifted")
	}
	if !validRole("guest") || validInviteRole("owner") {
		t.Fatal("role validation drifted")
	}
}
