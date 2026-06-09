package issues

import (
	"testing"
	"time"
)

func TestCursorRoundTrip(t *testing.T) {
	createdAt := time.Date(2026, 5, 23, 18, 0, 0, 123, time.UTC).Format(time.RFC3339Nano)
	id := "00000000-0000-4000-8000-000000000001"
	decodedAt, decodedID, ok := decodeCursor(encodeCursor(createdAt, id))
	if !ok {
		t.Fatal("expected cursor to decode")
	}
	if decodedAt.Format(time.RFC3339Nano) != createdAt || decodedID != id {
		t.Fatalf("unexpected cursor: %s %s", decodedAt.Format(time.RFC3339Nano), decodedID)
	}
}

func TestClampLimit(t *testing.T) {
	if got := clampLimit(""); got != 50 {
		t.Fatalf("default limit = %d", got)
	}
	if got := clampLimit("500"); got != 100 {
		t.Fatalf("max limit = %d", got)
	}
	if got := clampLimit("2"); got != 2 {
		t.Fatalf("custom limit = %d", got)
	}
}

func TestValidPriority(t *testing.T) {
	for _, value := range []string{"none", "urgent", "high", "medium", "low"} {
		if !validPriority(value) {
			t.Fatalf("%s should be valid", value)
		}
	}
	if validPriority("p0") {
		t.Fatal("p0 should be invalid")
	}
}

func TestEscapeLike(t *testing.T) {
	if got := escapeLike(`ENG_%\`); got != `ENG\_\%\\` {
		t.Fatalf("escaped pattern = %q", got)
	}
}

func TestIsUUIDLike(t *testing.T) {
	if !isUUIDLike("00000000-0000-4000-8000-000000000001") {
		t.Fatal("valid uuid rejected")
	}
	if isUUIDLike("ENG-123") || isUUIDLike("00000000000040008000000000000001") {
		t.Fatal("invalid uuid accepted")
	}
}
