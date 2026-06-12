// Package webhooks implements outbound webhook event delivery with signing,
// retry, dead-letter state, and admin delivery-log visibility.
package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxAttempts is the maximum number of delivery attempts before a delivery is
// marked dead (dead-letter state).
const MaxAttempts = 5

// deliveryClient is the shared HTTP client used to POST webhook payloads.
var deliveryClient = &http.Client{Timeout: 15 * time.Second}

// Deliverer handles outbound webhook delivery and retry scheduling.
type Deliverer struct {
	DB *pgxpool.Pool
}

// EventPayload is the envelope sent to webhook endpoints.
type EventPayload struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	WorkspaceID string `json:"workspaceId"`
	CreatedAt   string `json:"createdAt"`
	Data        any    `json:"data"`
}

// EnqueueEvent creates pending webhook_delivery rows for every enabled webhook
// in the workspace that subscribes to eventType.  Call this after the
// triggering mutation has committed to avoid phantom deliveries on rollback.
func EnqueueEvent(ctx context.Context, db *pgxpool.Pool, workspaceID, eventType, sourceOperationID string, data any) error {
	// Serialise the data payload once.
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("webhook enqueue marshal: %w", err)
	}

	// Find all enabled webhooks subscribing to this event.
	rows, err := db.Query(ctx,
		`select id::text
		 from webhook
		 where workspace_id = $1::uuid
		   and coalesce(enabled, true) = true
		   and events @> $2::jsonb`,
		workspaceID, jsonArray(eventType),
	)
	if err != nil {
		return fmt.Errorf("webhook enqueue query: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}

	var sourceOpArg any
	if sourceOperationID != "" {
		sourceOpArg = sourceOperationID
	}

	for _, webhookID := range ids {
		_, err := db.Exec(ctx,
			`insert into webhook_delivery
			 (webhook_id, workspace_id, event_type, payload, status, next_attempt_at, source_operation_id)
			 values ($1::uuid, $2::uuid, $3, $4::jsonb, 'pending', now(), $5)`,
			webhookID, workspaceID, eventType, string(payload), sourceOpArg,
		)
		if err != nil {
			return fmt.Errorf("webhook enqueue insert: %w", err)
		}
	}
	return nil
}

// jsonArray returns a JSON array string containing a single string value, for
// use with the PostgreSQL @> containment operator.
func jsonArray(s string) string {
	b, _ := json.Marshal([]string{s})
	return string(b)
}

// ProcessPending picks up to batchSize pending/retrying delivery rows and
// dispatches them.  Designed to be called from a background goroutine or
// scheduled ticker.
func (d *Deliverer) ProcessPending(ctx context.Context, batchSize int) error {
	if batchSize <= 0 {
		batchSize = 50
	}

	rows, err := d.DB.Query(ctx,
		`select wd.id::text, wd.event_type, wd.payload, wd.attempts,
		        w.url, w.secret, wd.workspace_id::text
		 from webhook_delivery wd
		 join webhook w on w.id = wd.webhook_id
		 where wd.status in ('pending', 'delivering')
		   and (wd.next_attempt_at is null or wd.next_attempt_at <= now())
		 order by wd.next_attempt_at asc nulls first
		 limit $1
		 for update of wd skip locked`,
		batchSize,
	)
	if err != nil {
		return fmt.Errorf("webhook delivery fetch: %w", err)
	}

	type pendingRow struct {
		id          string
		eventType   string
		payload     []byte
		attempts    int
		url         string
		secret      *string
		workspaceID string
	}
	var pending []pendingRow
	for rows.Next() {
		var pr pendingRow
		if err := rows.Scan(&pr.id, &pr.eventType, &pr.payload, &pr.attempts, &pr.url, &pr.secret, &pr.workspaceID); err != nil {
			rows.Close()
			return err
		}
		pending = append(pending, pr)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// Mark as delivering immediately so concurrent workers skip them.
	for _, pr := range pending {
		_, _ = d.DB.Exec(ctx,
			`update webhook_delivery set status='delivering', updated_at=now()
			 where id=$1::uuid and status in ('pending','delivering')`,
			pr.id,
		)
	}

	for _, pr := range pending {
		d.attemptDelivery(ctx, pr.id, pr.eventType, pr.payload, pr.attempts, pr.url, pr.workspaceID, pr.secret)
	}
	return nil
}

func (d *Deliverer) attemptDelivery(ctx context.Context, deliveryID, eventType string, rawPayload []byte, prevAttempts int, targetURL, workspaceID string, secret *string) {
	attempts := prevAttempts + 1
	now := time.Now().UTC()

	// Build the signed envelope payload.
	env := EventPayload{
		ID:          deliveryID,
		Type:        eventType,
		WorkspaceID: workspaceID,
		CreatedAt:   now.Format(time.RFC3339Nano),
		Data:        json.RawMessage(rawPayload),
	}
	body, err := json.Marshal(env)
	if err != nil {
		d.recordFailure(ctx, deliveryID, attempts, 0, "marshal error: "+err.Error(), now)
		return
	}

	statusCode, respBody, deliveryErr := sendWebhookRequest(ctx, targetURL, body, secret)

	switch {
	case deliveryErr == nil && statusCode >= 200 && statusCode < 300:
		// Success.
		_, _ = d.DB.Exec(ctx,
			`update webhook_delivery
			 set status='delivered', attempts=$2, response_code=$3, response_body=$4,
			     last_attempted_at=$5, updated_at=now()
			 where id=$1::uuid`,
			deliveryID, attempts, statusCode, truncate(respBody, 500), now,
		)

	case deliveryErr == nil && statusCode >= 400 && statusCode < 500 && statusCode != 429:
		// Permanent client-side failure — do not retry.
		_, _ = d.DB.Exec(ctx,
			`update webhook_delivery
			 set status='failed', attempts=$2, response_code=$3, response_body=$4,
			     last_attempted_at=$5, updated_at=now()
			 where id=$1::uuid`,
			deliveryID, attempts, statusCode, truncate(respBody, 500), now,
		)

	default:
		// Transient error: network failure, 5xx, 429.
		errMsg := truncate(respBody, 500)
		if deliveryErr != nil {
			errMsg = truncate(deliveryErr.Error(), 500)
		}
		d.recordFailure(ctx, deliveryID, attempts, statusCode, errMsg, now)
	}
}

func (d *Deliverer) recordFailure(ctx context.Context, deliveryID string, attempts, statusCode int, errMsg string, now time.Time) {
	if attempts >= MaxAttempts {
		_, _ = d.DB.Exec(ctx,
			`update webhook_delivery
			 set status='dead', attempts=$2, response_code=$3, response_body=$4,
			     last_attempted_at=$5, updated_at=now()
			 where id=$1::uuid`,
			deliveryID, attempts, nilIfZero(statusCode), errMsg, now,
		)
		return
	}
	nextAttempt := now.Add(backoffDuration(attempts))
	_, _ = d.DB.Exec(ctx,
		`update webhook_delivery
		 set status='pending', attempts=$2, response_code=$3, response_body=$4,
		     last_attempted_at=$5, next_attempt_at=$6, updated_at=now()
		 where id=$1::uuid`,
		deliveryID, attempts, nilIfZero(statusCode), errMsg, now, nextAttempt,
	)
}

// backoffDuration returns the wait duration before the nth retry.
// Sequence: 30s, 5m, 30m, 2h, 6h.
func backoffDuration(attempt int) time.Duration {
	switch attempt {
	case 1:
		return 30 * time.Second
	case 2:
		return 5 * time.Minute
	case 3:
		return 30 * time.Minute
	case 4:
		return 2 * time.Hour
	default:
		return 6 * time.Hour
	}
}

// sendWebhookRequest performs the HTTP POST to the target URL.
func sendWebhookRequest(ctx context.Context, targetURL string, payload []byte, secret *string) (int, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(payload))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "exponential-webhook/1.0")
	if secret != nil && *secret != "" {
		sig := ComputeSignature(*secret, payload)
		req.Header.Set("X-Exponential-Signature", sig)
		// Also send as X-Hub-Signature-256 for broad ecosystem compatibility.
		req.Header.Set("X-Hub-Signature-256", sig)
	}

	resp, err := deliveryClient.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	return resp.StatusCode, string(body), nil
}

// ComputeSignature returns the HMAC-SHA256 hex signature for payload, prefixed
// with "sha256=" so receivers can verify it easily.
func ComputeSignature(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// VerifySignature reports whether signature matches the expected HMAC-SHA256
// signature for payload under secret.  Uses constant-time comparison.
func VerifySignature(secret string, payload []byte, signature string) bool {
	expected := ComputeSignature(secret, payload)
	return hmac.Equal([]byte(signature), []byte(expected))
}

// KnownEventTypes lists the outbound webhook events currently supported.
var KnownEventTypes = []string{
	"issue.created",
	"issue.updated",
	"issue.deleted",
	"comment.created",
	"comment.updated",
	"comment.deleted",
	"label.created",
	"label.updated",
	"label.deleted",
	"project.updated",
}

// ValidEventType returns true if e is a recognised event type.
func ValidEventType(e string) bool {
	e = strings.TrimSpace(e)
	for _, known := range KnownEventTypes {
		if known == e {
			return true
		}
	}
	return false
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

func nilIfZero(v int) any {
	if v == 0 {
		return nil
	}
	return v
}
