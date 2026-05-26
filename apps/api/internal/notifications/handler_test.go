package notifications

import (
	"encoding/json"
	"testing"
	"time"
)

func TestFormatTime(t *testing.T) {
	if formatTime(nil) != nil {
		t.Fatal("nil time should stay nil")
	}
	now := time.Date(2026, 5, 24, 1, 2, 3, 0, time.UTC)
	got := formatTime(&now)
	if got == nil || *got != "2026-05-24T01:02:03Z" {
		t.Fatalf("time = %#v", got)
	}
}

func TestSnoozeRequestJSON(t *testing.T) {
	raw := `{"snoozedUntilAt":"2026-05-24T01:02:03Z"}`
	var input snoozeRequest
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	if input.SnoozedUntilAt == nil || *input.SnoozedUntilAt != "2026-05-24T01:02:03Z" {
		t.Fatalf("snooze = %#v", input.SnoozedUntilAt)
	}
}
