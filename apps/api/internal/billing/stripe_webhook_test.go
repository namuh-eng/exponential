package billing

import (
	"context"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stripe/stripe-go/v82"
)

type fakeProcessor struct {
	calls  int
	result ProcessResult
	err    error
}

func (p *fakeProcessor) ProcessStripeEvent(_ context.Context, _ stripe.Event) (ProcessResult, error) {
	p.calls++
	return p.result, p.err
}

func TestStripeWebhookRejectsMissingConfig(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SIGNING_SECRET", "")
	handler := StripeWebhookHandler{Processor: &fakeProcessor{}}
	req := httptest.NewRequest(http.MethodPost, "/api/stripe/webhook", strings.NewReader(`{}`))
	req.Header.Set("Stripe-Signature", "t=1,v1=bad")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
}

func TestStripeWebhookRejectsMissingSignature(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SIGNING_SECRET", "whsec_test")
	handler := StripeWebhookHandler{Processor: &fakeProcessor{}}
	req := httptest.NewRequest(http.MethodPost, "/api/stripe/webhook", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
}

func TestStripeWebhookRejectsInvalidSignature(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SIGNING_SECRET", "whsec_test")
	handler := StripeWebhookHandler{Processor: &fakeProcessor{}}
	req := httptest.NewRequest(http.MethodPost, "/api/stripe/webhook", strings.NewReader(`{"id":"evt_bad"}`))
	req.Header.Set("Stripe-Signature", "t=1,v1=bad")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
}

func TestStripeWebhookAcceptsValidSignedEvent(t *testing.T) {
	secret := "whsec_test"
	t.Setenv("STRIPE_WEBHOOK_SIGNING_SECRET", secret)
	payload := `{"id":"evt_test","object":"event","type":"customer.subscription.updated","livemode":true,"created":1780920000,"data":{"object":{"id":"sub_test","object":"subscription","status":"active","metadata":{"workspace_id":"00000000-0000-0000-0000-000000000001","plan":"business"}}}}`
	processor := &fakeProcessor{result: ProcessResult{Outcome: "processed"}}
	handler := StripeWebhookHandler{Processor: processor}
	req := httptest.NewRequest(http.MethodPost, "/api/stripe/webhook", strings.NewReader(payload))
	req.Header.Set("Stripe-Signature", signedStripeHeader(payload, secret))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", rec.Code, rec.Body.String())
	}
	if processor.calls != 1 {
		t.Fatalf("processor calls = %d", processor.calls)
	}
	if !strings.Contains(rec.Body.String(), `"outcome":"processed"`) {
		t.Fatalf("body = %s", rec.Body.String())
	}
}

type mutationRecorderTx struct {
	rows              map[string][]byte
	customerRows      map[string]string
	subscriptionRows  map[string]string
	insertedEvents    map[string]bool
	lastMutation      workspaceMutation
	duplicateEventIDs map[string]bool
}

func (tx *mutationRecorderTx) Begin(_ context.Context) (pgx.Tx, error) { return tx, nil }

func TestMutationFromInvoiceDoesNotSetSubscriptionStatus(t *testing.T) {
	workspaceID := "00000000-0000-0000-0000-000000000001"
	tx := &mutationRecorderTx{rows: map[string][]byte{
		workspaceID: []byte(`{"billing":{"stripeCustomerId":"cus_test","stripeSubscriptionStatus":"active"}}`),
	}}
	event := stripe.Event{
		ID:      "evt_invoice",
		Type:    "invoice.payment_failed",
		Created: time.Now().Unix(),
	}
	obj := stripeObject{
		ID:           "in_test",
		Customer:     "cus_test",
		Subscription: "sub_test",
		Status:       "open",
		Metadata:     map[string]string{"workspace_id": workspaceID},
	}

	mutation, outcome, err := mutationFromObject(context.Background(), tx, event, obj, false, false, "failed", false)

	if err != nil || outcome != "" {
		t.Fatalf("outcome=%q err=%v", outcome, err)
	}
	if mutation.SubscriptionStatus != "" {
		t.Fatalf("invoice event must not set subscription status: %#v", mutation)
	}
	if mutation.InvoiceStatus != "failed" {
		t.Fatalf("invoice status = %q", mutation.InvoiceStatus)
	}
}

func TestResolveWorkspaceRejectsInvalidMetadataWorkspaceID(t *testing.T) {
	tx := &mutationRecorderTx{}
	_, err := resolveWorkspace(context.Background(), tx, "not-a-uuid", "", "")
	if err == nil {
		t.Fatal("expected invalid workspace id metadata to fail")
	}
}

func TestResolveWorkspaceRejectsUnknownMetadataWorkspaceIDWithoutFallback(t *testing.T) {
	metadataWorkspaceID := "00000000-0000-0000-0000-000000000099"
	matchedWorkspaceID := "00000000-0000-0000-0000-000000000001"
	tx := &mutationRecorderTx{
		rows:         map[string][]byte{matchedWorkspaceID: []byte(`{"billing":{"stripeCustomerId":"cus_test"}}`)},
		customerRows: map[string]string{"cus_test": matchedWorkspaceID},
	}

	_, err := resolveWorkspace(context.Background(), tx, metadataWorkspaceID, "cus_test", "")

	if err == nil {
		t.Fatal("expected unknown metadata workspace id to fail instead of falling back")
	}
}

func signedStripeHeader(payload string, secret string) string {
	ts := time.Now()
	signature := stripe.ComputeSignature(ts, []byte(payload), secret)
	return fmt.Sprintf("t=%d,v1=%s", ts.Unix(), hex.EncodeToString(signature))
}

func (tx *mutationRecorderTx) Commit(_ context.Context) error   { return nil }
func (tx *mutationRecorderTx) Rollback(_ context.Context) error { return nil }
func (tx *mutationRecorderTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	return 0, nil
}
func (tx *mutationRecorderTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults {
	return nil
}
func (tx *mutationRecorderTx) LargeObjects() pgx.LargeObjects {
	return pgx.LargeObjects{}
}
func (tx *mutationRecorderTx) Conn() *pgx.Conn { return nil }
func (tx *mutationRecorderTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	return nil, nil
}
func (tx *mutationRecorderTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	return pgconn.NewCommandTag("UPDATE 1"), nil
}
func (tx *mutationRecorderTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, nil
}
func (tx *mutationRecorderTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	if strings.Contains(query, "where id=$1::uuid") {
		workspaceID := ""
		if len(args) > 0 {
			workspaceID, _ = args[0].(string)
		}
		return mutationRecorderRow{workspaceID: workspaceID, rows: tx.rows}
	}
	if strings.Contains(query, "stripeCustomerId") || strings.Contains(query, "stripeSubscriptionId") {
		customerID := ""
		subscriptionID := ""
		if len(args) > 0 {
			customerID, _ = args[0].(string)
		}
		if len(args) > 1 {
			subscriptionID, _ = args[1].(string)
		}
		if workspaceID, ok := tx.customerRows[customerID]; ok {
			return mutationRecorderRow{workspaceID: workspaceID, rows: tx.rows}
		}
		if workspaceID, ok := tx.subscriptionRows[subscriptionID]; ok {
			return mutationRecorderRow{workspaceID: workspaceID, rows: tx.rows}
		}
	}
	return mutationRecorderRow{rows: tx.rows}
}

type mutationRecorderRow struct {
	workspaceID string
	rows        map[string][]byte
}

func (row mutationRecorderRow) Scan(dest ...any) error {
	if raw, ok := row.rows[row.workspaceID]; ok {
		switch target := dest[0].(type) {
		case *string:
			*target = row.workspaceID
		case *[]byte:
			*target = raw
		}
		return nil
	}
	return pgx.ErrNoRows
}
