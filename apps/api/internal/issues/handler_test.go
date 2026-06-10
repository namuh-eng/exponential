package issues

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
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

func TestNullableID(t *testing.T) {
	if got := nullableID(nil); got != nil {
		t.Fatalf("nil id = %#v, want nil", got)
	}
	blank := "  "
	if got := nullableID(&blank); got != nil {
		t.Fatalf("blank id = %#v, want nil", got)
	}
	value := " 00000000-0000-4000-8000-000000000001 "
	got := nullableID(&value)
	if got == nil || *got != "00000000-0000-4000-8000-000000000001" {
		t.Fatalf("trimmed id = %#v", got)
	}
}

func TestAssertIssueRelationshipsAllowsEmptyRelationships(t *testing.T) {
	q := fakeQueryer{t: t, query: func(string, ...any) pgx.Row {
		t.Fatal("empty relationships should not query")
		return fakeRow{}
	}}

	if err := assertIssueRelationships(context.Background(), q, "workspace-1", "team-1", nil, nil, nil, nil, nil); err != nil {
		t.Fatalf("empty relationships error = %v", err)
	}
}

func TestAssertIssueRelationshipsRejectsParentOutsideTeam(t *testing.T) {
	parentID := "00000000-0000-4000-8000-000000000010"
	q := fakeQueryer{t: t, query: func(sql string, args ...any) pgx.Row {
		if !strings.Contains(sql, "from issue") {
			t.Fatalf("unexpected query: %s", sql)
		}
		if args[0] != parentID || args[1] != "team-1" {
			t.Fatalf("unexpected args: %#v", args)
		}
		return fakeRow{err: pgx.ErrNoRows}
	}}

	err := assertIssueRelationships(context.Background(), q, "workspace-1", "team-1", nil, &parentID, nil, nil, nil)
	if err == nil {
		t.Fatal("expected parent validation error")
	}
	if !errors.Is(err, pgx.ErrNoRows) || err.title != "Parent issue not found" {
		t.Fatalf("unexpected error = %#v", err)
	}
}

type fakeQueryer struct {
	t     *testing.T
	query func(string, ...any) pgx.Row
}

func (q fakeQueryer) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	q.t.Helper()
	return q.query(sql, args...)
}

type fakeRow struct {
	err error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) > 0 {
		switch v := dest[0].(type) {
		case *string:
			*v = "found"
		case *int:
			*v = 1
		}
	}
	return nil
}
