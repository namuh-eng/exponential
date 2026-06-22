package airbyte

import (
	"testing"
	"time"
)

func TestCatalogStreamsDeclareSupportedSlice(t *testing.T) {
	catalog := catalogStreams()
	if len(catalog) != 5 {
		t.Fatalf("stream count = %d", len(catalog))
	}
	want := []string{"issues", "projects", "comments", "cycles", "initiatives"}
	for i, name := range want {
		stream := catalog[i]
		if stream.Name != name {
			t.Fatalf("stream[%d] = %q, want %q", i, stream.Name, name)
		}
		if stream.PrimaryKey != "id" || stream.CursorField != "updated_at" {
			t.Fatalf("stream metadata = %#v", stream)
		}
		if len(stream.SyncModes) != 2 || stream.SyncModes[0] != "full_refresh" || stream.SyncModes[1] != "incremental" {
			t.Fatalf("sync modes = %#v", stream.SyncModes)
		}
		if stream.Schema["type"] != "object" || stream.Schema["properties"] == nil {
			t.Fatalf("schema missing object metadata: %#v", stream.Schema)
		}
	}
	if _, ok := streams["customers"]; ok {
		t.Fatal("customers stream must wait for first-class customer/customer request APIs")
	}
}

func TestCursorLimitAndSyncModeHelpers(t *testing.T) {
	if got := readLimit(""); got != 100 {
		t.Fatalf("default limit = %d", got)
	}
	if got := readLimit("5000"); got != 1000 {
		t.Fatalf("capped limit = %d", got)
	}
	if got := readLimit("12"); got != 12 {
		t.Fatalf("explicit limit = %d", got)
	}
	if cursor, err := parseCursor("not-a-date"); err == nil || cursor != nil {
		t.Fatalf("malformed cursor = %v, %v", cursor, err)
	}
	cursor, err := parseCursor("2026-04-08T10:00:00Z")
	if err != nil {
		t.Fatalf("parse cursor: %v", err)
	}
	if cursor == nil || !cursor.Equal(time.Date(2026, 4, 8, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("cursor = %v", cursor)
	}
	if got := syncMode(nil); got != "full_refresh" {
		t.Fatalf("nil sync mode = %q", got)
	}
	if got := syncMode(cursor); got != "incremental" {
		t.Fatalf("cursor sync mode = %q", got)
	}
}
