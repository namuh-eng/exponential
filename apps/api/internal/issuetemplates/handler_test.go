package issuetemplates

import "testing"

func TestNormalizeSettingsTrimsFieldsAndPriority(t *testing.T) {
	settings, err := normalizeSettings(map[string]any{
		"title":             "  Bug report  ",
		"body":              " Details ",
		"defaultPriority":   " HIGH ",
		"defaultStatusName": " Todo ",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if settings.Title != "Bug report" || settings.Body != "Details" || settings.DefaultPriority != "high" || settings.DefaultStatusName != "Todo" {
		t.Fatalf("settings not normalized: %#v", settings)
	}
}

func TestNormalizeSettingsRejectsInvalidPriority(t *testing.T) {
	_, err := normalizeSettings(map[string]any{"defaultPriority": "p0"})
	if err == nil || err.Error() != "Invalid default priority" {
		t.Fatalf("error = %v", err)
	}
}

func TestFirstValuePrefersExplicitInput(t *testing.T) {
	if got := firstValue("input", "fallback"); got != "input" {
		t.Fatalf("got %#v", got)
	}
	if got := firstValue(nil, "fallback"); got != "fallback" {
		t.Fatalf("got %#v", got)
	}
}
