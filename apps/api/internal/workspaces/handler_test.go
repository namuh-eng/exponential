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
		"Exponential":  "EXP",
		"Linear Clone": "LCX",
		"1 2":          "WRK",
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

func TestParseImportCSV(t *testing.T) {
	rows := parseImportCSV("Title,Status\nFix bug,Todo\n,Done")
	if len(rows) != 2 {
		t.Fatalf("rows = %#v", rows)
	}
	if rows[0].row != 2 || rows[0].get("Title") != "Fix bug" || rows[0].get("Status") != "Todo" {
		t.Fatalf("first row = %#v", rows[0])
	}
}

func TestBillingStateDefaultsAndNormalization(t *testing.T) {
	state := readBillingState(map[string]any{"billing": map[string]any{"plan": "standard", "issuesUsed": float64(99)}})
	if state.plan != "business" || state.issuesUsed != 99 || state.usageLimit != 250 {
		t.Fatalf("state = %#v", state)
	}
	if len(state.paymentMethods) != 1 || len(state.invoices) != 1 {
		t.Fatalf("defaults missing = %#v", state)
	}
}

func TestNormalizeWorkspaceDocuments(t *testing.T) {
	settings := map[string]any{"documents": map[string]any{"defaultVisibility": "private", "autoLinkProjectDocuments": false, "templates": []any{map[string]any{"id": "tpl_1", "name": "Spec", "description": "Template"}, map[string]any{"id": "bad"}}}}
	got := normalizeWorkspaceDocuments(settings)
	if got.DefaultVisibility != "private" || got.AutoLinkProjectDocuments || len(got.Templates) != 1 {
		t.Fatalf("documents = %#v", got)
	}
}
