package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

type OperationStore interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

var (
	redisOnce   sync.Once
	redisClient *redis.Client
	redisErr    error
)

func InsertOperation(ctx context.Context, store OperationStore, workspaceID, entityType, entityID, opType string, payload any, createdBy string) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	var op Operation
	var createdAt time.Time
	err = store.QueryRow(ctx, `
		insert into operation (workspace_id, entity_type, entity_id, op_type, payload, version, created_by)
		values ($1::uuid, $2, $3, $4, $5::jsonb, nextval('operation_version_seq'), $6)
		returning id::text, workspace_id::text, entity_type, entity_id, op_type, payload, version, created_at, created_by`,
		workspaceID, entityType, entityID, opType, body, createdBy,
	).Scan(&op.ID, &op.WorkspaceID, &op.EntityType, &op.EntityID, &op.OpType, &op.Payload, &op.Version, &createdAt, &op.CreatedBy)
	if err != nil {
		return err
	}
	op.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	_ = PublishOperation(ctx, op)
	return nil
}

func PublishOperation(ctx context.Context, op Operation) error {
	client, err := getRedisClient()
	if err != nil {
		return err
	}
	payload, err := json.Marshal(replayMessage{Type: "operation", Operations: []Operation{op}})
	if err != nil {
		return err
	}
	return client.Publish(ctx, operationChannel(op.WorkspaceID), payload).Err()
}

type OperationSubscription struct {
	Operations <-chan Operation
	Close      func() error
}

func SubscribeOperations(ctx context.Context, workspaceID string) (*OperationSubscription, error) {
	client, err := getRedisClient()
	if err != nil {
		return nil, err
	}
	sub := client.Subscribe(ctx, operationChannel(workspaceID))
	if _, err := sub.Receive(ctx); err != nil {
		_ = sub.Close()
		return nil, err
	}
	out := make(chan Operation)
	go func() {
		defer close(out)
		defer sub.Close()
		for message := range sub.Channel() {
			var envelope replayMessage
			if err := json.Unmarshal([]byte(message.Payload), &envelope); err != nil {
				continue
			}
			for _, op := range envelope.Operations {
				select {
				case <-ctx.Done():
					return
				case out <- op:
				}
			}
		}
	}()
	return &OperationSubscription{Operations: out, Close: sub.Close}, nil
}

func operationChannel(workspaceID string) string {
	return fmt.Sprintf("workspace:%s:operations", workspaceID)
}

func getRedisClient() (*redis.Client, error) {
	redisOnce.Do(func() {
		redisURL := redisURLFromEnv()
		options, err := redis.ParseURL(redisURL)
		if err != nil {
			redisErr = err
			return
		}
		redisClient = redis.NewClient(options)
	})
	if redisClient == nil {
		if redisErr == nil {
			redisErr = errors.New("redis client not initialized")
		}
		return nil, redisErr
	}
	return redisClient, nil
}

func redisURLFromEnv() string {
	if redisURL := os.Getenv("EXPONENTIAL_API_REDIS_URL"); redisURL != "" {
		return redisURL
	}
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		return redisURL
	}
	return "redis://localhost:6379"
}
