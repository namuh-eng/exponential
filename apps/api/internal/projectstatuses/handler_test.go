package projectstatuses

import (
	"encoding/json"
	"testing"
)

func TestReadStatusesMergesPersistedCustomStatusesWithDefaults(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"projectStatuses": []map[string]any{
			{
				"id":          "started",
				"key":         "started",
				"name":        "Building",
				"description": "Being built",
				"color":       "#123456",
				"icon":        "▶",
				"position":    1,
			},
			{
				"id":          "blocked",
				"key":         "blocked",
				"name":        "Blocked",
				"description": "Waiting on dependency",
				"color":       "#654321",
				"icon":        "!",
				"position":    5,
			},
		},
	})

	statuses := readStatuses(raw)
	byKey := map[string]ProjectStatus{}
	for _, status := range statuses {
		byKey[status.Key] = status
	}

	if len(statuses) != 6 {
		t.Fatalf("expected defaults plus custom status, got %d", len(statuses))
	}
	if byKey["started"].Name != "Building" || byKey["started"].Color != "#123456" {
		t.Fatalf("persisted default override not applied: %#v", byKey["started"])
	}
	if byKey["blocked"].Description != "Waiting on dependency" || byKey["blocked"].Icon != "!" {
		t.Fatalf("custom status not preserved: %#v", byKey["blocked"])
	}
}

func TestValidateRejectsRemovingDefaultStatuses(t *testing.T) {
	statuses := defaultStatuses()[:4]

	_, msg := validate(statuses, map[string]int32{})

	if msg != "Default project statuses cannot be removed." {
		t.Fatalf("validation message = %q", msg)
	}
}

func TestValidateRejectsRemovingStatusesInUse(t *testing.T) {
	statuses := defaultStatuses()

	_, msg := validate(statuses, map[string]int32{"blocked": 1})

	if msg != "Project statuses with assigned projects cannot be removed." {
		t.Fatalf("validation message = %q", msg)
	}
}

func TestValidateNormalizesCustomStatus(t *testing.T) {
	statuses := append(defaultStatuses(), ProjectStatus{
		ID:          "Blocked Status",
		Key:         "",
		Name:        "Blocked Status",
		Description: "Waiting",
		Color:       "#abcdef",
		Icon:        "!",
	})

	validated, msg := validate(statuses, map[string]int32{})

	if msg != "" {
		t.Fatalf("unexpected validation error: %s", msg)
	}
	custom := validated[len(validated)-1]
	if custom.ID != "blocked_status" || custom.Key != "blocked_status" || custom.Position != len(validated)-1 {
		t.Fatalf("custom status not normalized: %#v", custom)
	}
}
