package initiatives

import "testing"

func TestInitiativeValidationHelpers(t *testing.T) {
	if !validStatus("planned") || !validStatus("active") || !validStatus("completed") {
		t.Fatal("expected canonical statuses to be valid")
	}
	if validStatus("canceled") {
		t.Fatal("unexpected canceled initiative status")
	}
	if !validHealth("unknown") || !validHealth("onTrack") || !validHealth("atRisk") || !validHealth("offTrack") {
		t.Fatal("expected canonical health values to be valid")
	}
}

func TestParentLinkRejectsCycles(t *testing.T) {
	root := "root"
	nodes := []miniInitiative{
		{ID: root, Name: "Root"},
		{ID: "child", Name: "Child", ParentInitiativeID: &root},
	}
	parent := "child"
	if validParentLink(nodes, root, &parent) {
		t.Fatal("expected cycle to be rejected")
	}
	if !validParentLink(nodes, "child", nil) {
		t.Fatal("clearing parent should be valid")
	}
}

func TestSettingsMutationCapsArrays(t *testing.T) {
	settings := map[string]any{}
	for i := 0; i < 55; i++ {
		addActivity(settings, "property_change", "changed", "Ada", nil)
	}
	_, activity, _ := settingsArrays(settings)
	if len(activity) != 50 {
		t.Fatalf("activity length = %d", len(activity))
	}
	for i := 0; i < 30; i++ {
		addUpdate(settings, "onTrack", "update", "Ada", nil)
	}
	updates, _, _ := settingsArrays(settings)
	if len(updates) != 25 {
		t.Fatalf("updates length = %d", len(updates))
	}
}
