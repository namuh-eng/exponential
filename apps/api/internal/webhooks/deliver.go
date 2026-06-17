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
	"net"
	"net/http"
	"net/url"
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
	// skipSSRFCheck disables SSRF URL validation. Must only be set to true in
	// tests; never in production code.
	skipSSRFCheck bool
}

// DelivererOption configures a Deliverer.
type DelivererOption func(*Deliverer)

// WithSSRFCheckDisabled returns a DelivererOption that disables SSRF URL
// validation. Use only in tests.
func WithSSRFCheckDisabled() DelivererOption {
	return func(d *Deliverer) { d.skipSSRFCheck = true }
}

// NewDeliverer constructs a Deliverer with the given options.
func NewDeliverer(db *pgxpool.Pool, opts ...DelivererOption) *Deliverer {
	d := &Deliverer{DB: db}
	for _, o := range opts {
		o(d)
	}
	return d
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
//
// The SELECT … FOR UPDATE SKIP LOCKED and the status transition to 'delivering'
// are performed inside a single explicit transaction so that row locks are held
// across both statements.  Without the transaction the implicit per-statement
// transaction in pgx commits and releases locks before the UPDATE runs, making
// the skip-locked protection completely ineffective.
func (d *Deliverer) ProcessPending(ctx context.Context, batchSize int) error {
	if batchSize <= 0 {
		batchSize = 50
	}

	tx, err := d.DB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("webhook delivery begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx,
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

	// Mark as delivering while we still hold the row locks inside the transaction.
	for _, pr := range pending {
		if _, err := tx.Exec(ctx,
			`update webhook_delivery set status='delivering', updated_at=now()
			 where id=$1::uuid and status in ('pending','delivering')`,
			pr.id,
		); err != nil {
			return fmt.Errorf("webhook delivery mark delivering: %w", err)
		}
	}

	// Commit before dispatching HTTP requests so the status update is durable
	// and the row locks are released even if delivery takes a while.
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("webhook delivery commit: %w", err)
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

	statusCode, respBody, deliveryErr := sendWebhookRequest(ctx, targetURL, body, secret, d.skipSSRFCheck)

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

// privateRanges lists CIDRs that must not be reachable from outbound webhooks.
var privateRanges []*net.IPNet

func init() {
	for _, cidr := range []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"127.0.0.0/8",
		"::1/128",
		"fc00::/7",
		"169.254.0.0/16", // link-local / AWS IMDS
		"fe80::/10",      // IPv6 link-local
		"0.0.0.0/8",
		"100.64.0.0/10", // shared address space (RFC 6598)
	} {
		_, network, err := net.ParseCIDR(cidr)
		if err == nil {
			privateRanges = append(privateRanges, network)
		}
	}
}

// validateWebhookURL returns an error if targetURL targets a private/loopback/
// link-local address, preventing SSRF attacks against internal infrastructure.
func validateWebhookURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid webhook URL: %w", err)
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return fmt.Errorf("webhook URL must use http or https scheme")
	}
	hostname := u.Hostname()
	ips, err := net.LookupHost(hostname)
	if err != nil {
		// If DNS resolution fails we reject rather than allow blindly.
		return fmt.Errorf("webhook URL hostname cannot be resolved: %w", err)
	}
	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return fmt.Errorf("webhook URL resolves to a disallowed address: %s", ipStr)
		}
		for _, block := range privateRanges {
			if block.Contains(ip) {
				return fmt.Errorf("webhook URL resolves to a private/reserved address: %s", ipStr)
			}
		}
	}
	return nil
}

// sendWebhookRequest performs the HTTP POST to the target URL.
// skipSSRFCheck disables SSRF validation; set to true only in tests.
func sendWebhookRequest(ctx context.Context, targetURL string, payload []byte, secret *string, skipSSRFCheck bool) (int, string, error) {
	if !skipSSRFCheck {
		if err := validateWebhookURL(targetURL); err != nil {
			return 0, "", err
		}
	}
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
