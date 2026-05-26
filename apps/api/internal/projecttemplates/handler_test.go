package projecttemplates

import "testing"

func TestNormalizeSettingsFiltersInvalidEnumsAndDedupesLists(t *testing.T) {
	status := "invalid"
	priority := "urgent"
	settings := normalizeSettings(Settings{Status: &status, Priority: &priority, LabelIDs: []string{" label-1 ", "label-1", ""}, Milestones: []string{"M1", " M1 ", "M2"}})

	if settings.Status != nil {
		t.Fatalf("invalid status should normalize to nil, got %#v", *settings.Status)
	}
	if settings.Priority == nil || *settings.Priority != "urgent" {
		t.Fatalf("priority not preserved: %#v", settings.Priority)
	}
	if len(settings.LabelIDs) != 1 || settings.LabelIDs[0] != "label-1" {
		t.Fatalf("label ids not deduped: %#v", settings.LabelIDs)
	}
	if len(settings.Milestones) != 2 || settings.Milestones[0] != "M1" || settings.Milestones[1] != "M2" {
		t.Fatalf("milestones not deduped: %#v", settings.Milestones)
	}
}

func TestNormalizeDescriptionTreatsBlankAsNil(t *testing.T) {
	if normalizeDescription("  ") != nil {
		t.Fatal("blank descriptions should become nil")
	}
	got := normalizeDescription("  hello  ")
	if got == nil || *got != "hello" {
		t.Fatalf("description = %#v", got)
	}
}

func TestNormalizeNameTrimsStringsAndIgnoresNonStrings(t *testing.T) {
	if got := normalizeName("  Launch plan  "); got != "Launch plan" {
		t.Fatalf("name = %q", got)
	}
	if got := normalizeName(123); got != "" {
		t.Fatalf("non-string name = %q", got)
	}
}
