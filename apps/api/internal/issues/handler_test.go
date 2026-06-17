package issues

import (
	"net/http/httptest"
	"strings"
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

func TestApplyCustomerIssueFilters(t *testing.T) {
	req := httptest.NewRequest(
		"GET",
		"/issues?customer_count=2&customer=Acme_%25&customer_tier=enterprise&customer_status=active&important_customer_requests=true",
		nil,
	)
	where := "where i.workspace_id=$1"
	args := []any{"workspace-1"}

	if !customerFilterRequested(req) {
		t.Fatal("customer filters should be detected")
	}
	applyCustomerIssueFilters(req, &where, &args)

	if len(args) != 5 {
		t.Fatalf("args len = %d, args = %#v", len(args), args)
	}
	if args[1] != 2 || args[2] != `%Acme\_\%%` ||
		args[3] != "enterprise" || args[4] != "active" {
		t.Fatalf("unexpected args: %#v", args)
	}
	for _, snippet := range []string{
		"count(distinct cr.customer_id)",
		"c.name ilike $3",
		"c.tier=$4",
		"c.status=$5",
		"cr.important=true",
	} {
		if !strings.Contains(where, snippet) {
			t.Fatalf("where clause missing %q: %s", snippet, where)
		}
	}
}
