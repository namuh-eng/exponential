package sync

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

type fakeOperationStore struct {
	query string
	args  []any
	row   fakeOperationRow
}

func (s *fakeOperationStore) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	s.query = query
	s.args = args
	return s.row
}

type fakeOperationRow struct {
	err error
}

func (r fakeOperationRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	*(dest[0].(*string)) = "operation-1"
	*(dest[1].(*string)) = "workspace-1"
	*(dest[2].(*string)) = "label"
	*(dest[3].(*string)) = "label-1"
	*(dest[4].(*string)) = "updated"
	*(dest[5].(*json.RawMessage)) = json.RawMessage(`{"id":"label-1"}`)
	*(dest[6].(*int64)) = 42
	*(dest[7].(*time.Time)) = time.Date(2026, 6, 17, 1, 2, 3, 4, time.UTC)
	*(dest[8].(**string)) = stringPtr("user-1")
	return nil
}

func TestInsertOperationUsesCanonicalInsertAndReturnsOperation(t *testing.T) {
	store := &fakeOperationStore{}

	op, err := InsertOperation(context.Background(), store, "workspace-1", "label", "label-1", "updated", map[string]string{"id": "label-1"}, "user-1")
	if err != nil {
		t.Fatalf("InsertOperation returned error: %v", err)
	}
	if !strings.Contains(store.query, "nextval('operation_version_seq')") || !strings.Contains(store.query, "returning id::text") {
		t.Fatalf("insert query did not allocate and return operation fields: %s", store.query)
	}
	if len(store.args) != 6 || store.args[0] != "workspace-1" || store.args[1] != "label" || store.args[2] != "label-1" || store.args[3] != "updated" || store.args[5] != "user-1" {
		t.Fatalf("unexpected insert args: %#v", store.args)
	}
	body, ok := store.args[4].([]byte)
	if !ok || string(body) != `{"id":"label-1"}` {
		t.Fatalf("payload arg = %#v", store.args[4])
	}
	if op.ID != "operation-1" || op.WorkspaceID != "workspace-1" || op.EntityType != "label" || op.EntityID != "label-1" || op.OpType != "updated" || op.Version != 42 {
		t.Fatalf("unexpected operation: %#v", op)
	}
	if op.CreatedAt != "2026-06-17T01:02:03.000000004Z" || op.CreatedBy == nil || *op.CreatedBy != "user-1" {
		t.Fatalf("unexpected operation metadata: %#v", op)
	}
}

func TestInsertOperationReturnsStoreErrorsBeforePublish(t *testing.T) {
	store := &fakeOperationStore{row: fakeOperationRow{err: errors.New("insert failed")}}

	if _, err := InsertOperation(context.Background(), store, "workspace-1", "label", "label-1", "updated", map[string]string{"id": "label-1"}, "user-1"); err == nil {
		t.Fatal("InsertOperation returned nil error")
	}
}

func stringPtr(value string) *string {
	return &value
}
func TestRedisURLFromEnvPrefersAPIConfig(t *testing.T) {
	t.Setenv("EXPONENTIAL_API_REDIS_URL", "redis://api-redis:6379")
	t.Setenv("REDIS_URL", "redis://legacy-redis:6379")

	if got := redisURLFromEnv(); got != "redis://api-redis:6379" {
		t.Fatalf("redisURLFromEnv() = %q", got)
	}
}

func TestRedisURLFromEnvFallsBackToLegacyAndDefault(t *testing.T) {
	t.Setenv("EXPONENTIAL_API_REDIS_URL", "")
	t.Setenv("REDIS_URL", "redis://legacy-redis:6379")
	if got := redisURLFromEnv(); got != "redis://legacy-redis:6379" {
		t.Fatalf("legacy redis URL = %q", got)
	}

	t.Setenv("REDIS_URL", "")
	if got := redisURLFromEnv(); got != "redis://localhost:6379" {
		t.Fatalf("default redis URL = %q", got)
	}
}
