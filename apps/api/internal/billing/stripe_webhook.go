package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	"github.com/stripe/stripe-go/v82"
	"go.uber.org/zap"
)

const maxStripeWebhookBytes int64 = 1 << 20

type StripeWebhookHandler struct {
	DB        *pgxpool.Pool
	Logger    *zap.Logger
	SecretEnv string
	Processor EventProcessor
}

type EventProcessor interface {
	ProcessStripeEvent(ctx context.Context, event stripe.Event) (ProcessResult, error)
}

type ProcessResult struct {
	Outcome   string `json:"outcome"`
	Duplicate bool   `json:"duplicate,omitempty"`
}

type eventProcessor struct {
	db *pgxpool.Pool
}

type stripeObject struct {
	ID           string              `json:"id"`
	Customer     string              `json:"customer"`
	Subscription string              `json:"subscription"`
	Status       string              `json:"status"`
	Metadata     map[string]string   `json:"metadata"`
	Lines        *stripeInvoiceLines `json:"lines"`
	raw          map[string]any      `json:"-"`
}

type stripeInvoiceLines struct {
	Data []stripeObject `json:"data"`
}

type workspaceMutation struct {
	WorkspaceID        string
	Plan               string
	CustomerID         string
	SubscriptionID     string
	SubscriptionStatus string
	InvoiceStatus      string
	LastEventID        string
	LastEventType      string
	LastEventAt        string
}

func NewStripeWebhookHandler(db *pgxpool.Pool, logger *zap.Logger) StripeWebhookHandler {
	return StripeWebhookHandler{
		DB:        db,
		Logger:    logger,
		SecretEnv: "STRIPE_WEBHOOK_SIGNING_SECRET",
		Processor: eventProcessor{
			db: db,
		},
	}
}

func (h StripeWebhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	secret := strings.TrimSpace(os.Getenv(h.secretEnv()))
	if secret == "" {
		h.log("missing_config", zap.String("reason", "missing_webhook_signing_secret"))
		problem.Write(w, http.StatusBadRequest, "Stripe webhook is not configured", "")
		return
	}
	if strings.TrimSpace(r.Header.Get("Stripe-Signature")) == "" {
		h.log("invalid_signature", zap.String("reason", "missing_signature"))
		problem.Write(w, http.StatusBadRequest, "Missing Stripe signature", "")
		return
	}
	payload, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxStripeWebhookBytes))
	if err != nil {
		h.log("invalid_payload", zap.Error(err))
		problem.Write(w, http.StatusBadRequest, "Invalid Stripe payload", "")
		return
	}
	event, err := stripe.ConstructEvent(payload, r.Header.Get("Stripe-Signature"), secret, stripe.WithIgnoreAPIVersionMismatch())
	if err != nil {
		h.log("invalid_signature", zap.Error(err))
		problem.Write(w, http.StatusBadRequest, "Invalid Stripe signature", "")
		return
	}
	processor := h.Processor
	if processor == nil {
		processor = eventProcessor{db: h.DB}
	}
	result, err := processor.ProcessStripeEvent(r.Context(), event)
	if err != nil {
		h.log("processing_error", zap.String("event_id", event.ID), zap.String("event_type", string(event.Type)), zap.Error(err))
		problem.Write(w, http.StatusInternalServerError, "Process Stripe webhook failed", "")
		return
	}
	h.log(result.Outcome, zap.String("event_id", event.ID), zap.String("event_type", string(event.Type)), zap.Bool("duplicate", result.Duplicate))
	problem.JSON(w, http.StatusOK, map[string]any{"received": true, "duplicate": result.Duplicate, "outcome": result.Outcome})
}

func (h StripeWebhookHandler) secretEnv() string {
	if strings.TrimSpace(h.SecretEnv) != "" {
		return h.SecretEnv
	}
	return "STRIPE_WEBHOOK_SIGNING_SECRET"
}

func (h StripeWebhookHandler) log(outcome string, fields ...zap.Field) {
	logger := h.Logger
	if logger == nil {
		logger = zap.NewNop()
	}
	logger.Info("stripe webhook", append([]zap.Field{zap.String("outcome", outcome)}, fields...)...)
}

func (p eventProcessor) ProcessStripeEvent(ctx context.Context, event stripe.Event) (ProcessResult, error) {
	if p.db == nil {
		return ProcessResult{}, errors.New("stripe webhook database is not configured")
	}
	tx, err := p.db.Begin(ctx)
	if err != nil {
		return ProcessResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `insert into stripe_webhook_event (id,type,livemode) values ($1,$2,$3) on conflict do nothing`, event.ID, string(event.Type), event.Livemode)
	if err != nil {
		return ProcessResult{}, err
	}
	if tag.RowsAffected() == 0 {
		if err := tx.Commit(ctx); err != nil {
			return ProcessResult{}, err
		}
		return ProcessResult{Outcome: "duplicate", Duplicate: true}, nil
	}

	outcome, err := processVerifiedEvent(ctx, tx, event)
	if err != nil {
		return ProcessResult{}, err
	}
	if _, err := tx.Exec(ctx, `update stripe_webhook_event set outcome=$2, processed_at=now() where id=$1`, event.ID, outcome); err != nil {
		return ProcessResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ProcessResult{}, err
	}
	return ProcessResult{Outcome: outcome}, nil
}

func processVerifiedEvent(ctx context.Context, tx pgx.Tx, event stripe.Event) (string, error) {
	mutation, outcome, err := mutationForEvent(ctx, tx, event)
	if err != nil || mutation == nil {
		return outcome, err
	}
	if err := applyWorkspaceBillingMutation(ctx, tx, *mutation); err != nil {
		return "", err
	}
	if mutation.Plan != "" {
		return "processed", nil
	}
	return "processed_no_plan_change", nil
}

func mutationForEvent(ctx context.Context, tx pgx.Tx, event stripe.Event) (*workspaceMutation, string, error) {
	switch event.Type {
	case "checkout.session.completed":
		obj, err := decodeStripeObject(event)
		if err != nil {
			return nil, "", err
		}
		return mutationFromObject(ctx, tx, event, obj, true, false, "", true)
	case "customer.subscription.created", "customer.subscription.updated":
		obj, err := decodeStripeObject(event)
		if err != nil {
			return nil, "", err
		}
		return mutationFromObject(ctx, tx, event, obj, true, false, "", true)
	case "customer.subscription.deleted":
		obj, err := decodeStripeObject(event)
		if err != nil {
			return nil, "", err
		}
		return mutationFromObject(ctx, tx, event, obj, false, true, "", true)
	case "invoice.payment_succeeded":
		obj, err := decodeStripeObject(event)
		if err != nil {
			return nil, "", err
		}
		return mutationFromObject(ctx, tx, event, obj, false, false, "paid", false)
	case "invoice.payment_failed":
		obj, err := decodeStripeObject(event)
		if err != nil {
			return nil, "", err
		}
		return mutationFromObject(ctx, tx, event, obj, false, false, "failed", false)
	default:
		return nil, "ignored", nil
	}
}

func mutationFromObject(ctx context.Context, tx pgx.Tx, event stripe.Event, obj stripeObject, allowPlan bool, forceFree bool, invoiceStatus string, includeSubscriptionStatus bool) (*workspaceMutation, string, error) {
	customerID := obj.Customer
	subscriptionID := obj.Subscription
	if subscriptionID == "" && strings.HasPrefix(obj.ID, "sub_") {
		subscriptionID = obj.ID
	}
	if customerID == "" {
		customerID = stringFromRaw(obj.raw, "customer")
	}
	if subscriptionID == "" {
		subscriptionID = stringFromRaw(obj.raw, "subscription")
	}

	workspaceID, err := resolveWorkspace(ctx, tx, obj.Metadata["workspace_id"], customerID, subscriptionID)
	if err != nil {
		return nil, "", err
	}
	if workspaceID == "" {
		return nil, "no_op_unmapped", nil
	}

	plan := ""
	if forceFree {
		plan = "free"
	} else if allowPlan {
		plan = validBillingPlan(obj.Metadata["plan"])
	}
	mutation := workspaceMutation{
		WorkspaceID:    workspaceID,
		Plan:           plan,
		CustomerID:     customerID,
		SubscriptionID: subscriptionID,
		InvoiceStatus:  invoiceStatus,
		LastEventID:    event.ID,
		LastEventType:  string(event.Type),
		LastEventAt:    time.Unix(event.Created, 0).UTC().Format(time.RFC3339),
	}
	if includeSubscriptionStatus {
		mutation.SubscriptionStatus = obj.Status
	}
	return &mutation, "", nil
}

func decodeStripeObject(event stripe.Event) (stripeObject, error) {
	var obj stripeObject
	if len(event.Data.Raw) == 0 {
		return obj, errors.New("stripe event missing object")
	}
	if err := json.Unmarshal(event.Data.Raw, &obj); err != nil {
		return obj, fmt.Errorf("decode stripe object: %w", err)
	}
	_ = json.Unmarshal(event.Data.Raw, &obj.raw)
	return obj, nil
}

func resolveWorkspace(ctx context.Context, tx pgx.Tx, metadataWorkspaceID string, customerID string, subscriptionID string) (string, error) {
	if metadataWorkspaceID != "" {
		if _, err := uuid.Parse(metadataWorkspaceID); err != nil {
			return "", fmt.Errorf("invalid stripe workspace_id metadata: %w", err)
		}
		var id string
		err := tx.QueryRow(ctx, `select id::text from workspace where id=$1::uuid limit 1`, metadataWorkspaceID).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		return "", fmt.Errorf("stripe workspace_id metadata does not match an existing workspace: %s", metadataWorkspaceID)
	}
	if customerID == "" && subscriptionID == "" {
		return "", nil
	}
	var id string
	err := tx.QueryRow(ctx, `
		select id::text
		from workspace
		where ($1 <> '' and settings->'billing'->>'stripeCustomerId'=$1)
		   or ($2 <> '' and settings->'billing'->>'stripeSubscriptionId'=$2)
		order by created_at asc
		limit 1`, customerID, subscriptionID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func applyWorkspaceBillingMutation(ctx context.Context, tx pgx.Tx, mutation workspaceMutation) error {
	var raw []byte
	if err := tx.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid for update`, mutation.WorkspaceID).Scan(&raw); err != nil {
		return err
	}
	settings := mapFromJSON(raw)
	billing := recordFromAny(settings["billing"])
	if mutation.Plan != "" {
		settings["plan"] = mutation.Plan
		billing["plan"] = mutation.Plan
	}
	setIfNotEmpty(billing, "stripeCustomerId", mutation.CustomerID)
	setIfNotEmpty(billing, "stripeSubscriptionId", mutation.SubscriptionID)
	setIfNotEmpty(billing, "stripeSubscriptionStatus", mutation.SubscriptionStatus)
	setIfNotEmpty(billing, "latestInvoiceStatus", mutation.InvoiceStatus)
	setIfNotEmpty(billing, "stripeLastEventId", mutation.LastEventID)
	setIfNotEmpty(billing, "stripeLastEventType", mutation.LastEventType)
	setIfNotEmpty(billing, "stripeLastEventAt", mutation.LastEventAt)
	settings["billing"] = billing
	body, _ := json.Marshal(settings)
	_, err := tx.Exec(ctx, `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, body, mutation.WorkspaceID)
	return err
}

func validBillingPlan(value string) string {
	switch value {
	case "free", "basic", "business", "enterprise":
		return value
	default:
		return ""
	}
}

func setIfNotEmpty(record map[string]any, key string, value string) {
	if value != "" {
		record[key] = value
	}
}

func mapFromJSON(raw []byte) map[string]any {
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func recordFromAny(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func stringFromRaw(raw map[string]any, key string) string {
	if value, ok := raw[key].(string); ok {
		return value
	}
	return ""
}
