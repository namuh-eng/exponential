package integrations

import (
	"context"
	"time"
)

// LifecycleState enumerates the valid lifecycle states for an integration.
type LifecycleState string

const (
	LifecycleStateConfigurationRequired LifecycleState = "configuration_required"
	LifecycleStateInstalling            LifecycleState = "installing"
	LifecycleStateConnected             LifecycleState = "connected"
	LifecycleStateDegraded              LifecycleState = "degraded"
	LifecycleStateRevoked               LifecycleState = "revoked"
	LifecycleStateError                 LifecycleState = "error"
	LifecycleStateNotConnected          LifecycleState = "not_connected"
)

// JobStatus enumerates states for integration_job rows.
type JobStatus string

const (
	JobStatusPending   JobStatus = "pending"
	JobStatusRunning   JobStatus = "running"
	JobStatusSucceeded JobStatus = "succeeded"
	JobStatusFailed    JobStatus = "failed"
	JobStatusTerminal  JobStatus = "terminal"
)

// JobType enumerates recognized job types.
type JobType string

const (
	JobTypeWebhookIngest    JobType = "webhook_ingest"
	JobTypeOutboundDelivery JobType = "outbound_delivery"
	JobTypeBackfill         JobType = "backfill"
	JobTypeSync             JobType = "sync"
)

// BackoffDuration returns the next backoff interval for a given retry count
// using a simple exponential strategy (base 30 seconds, capped at 2 hours).
func BackoffDuration(retryCount int) time.Duration {
	base := 30 * time.Second
	const cap = 2 * time.Hour
	d := base
	for i := 0; i < retryCount; i++ {
		d *= 2
		if d > cap {
			return cap
		}
	}
	return d
}

// NextRunAt returns the absolute time for the next retry attempt.
func NextRunAt(now time.Time, retryCount int) time.Time {
	return now.Add(BackoffDuration(retryCount))
}

// IsTerminal returns true when retryCount has exceeded maxRetries.
func IsTerminal(retryCount, maxRetries int) bool {
	return retryCount >= maxRetries
}

// TransitionJobStatus returns the new JobStatus after an execution attempt.
// If terminal, returns JobStatusTerminal; otherwise JobStatusFailed.
func TransitionJobStatus(succeeded bool, retryCount, maxRetries int) JobStatus {
	if succeeded {
		return JobStatusSucceeded
	}
	if IsTerminal(retryCount, maxRetries) {
		return JobStatusTerminal
	}
	return JobStatusFailed
}

// healthRow mirrors the new lifecycle columns in workspace_integration.
type healthRow struct {
	LifecycleState     string
	LastEventAt        *time.Time
	LastSuccessAt      *time.Time
	LastFailureAt      *time.Time
	LastFailureMessage *string
	DisconnectedAt     *time.Time
	HealthSummary      *string
}

// readHealth fetches the health/lifecycle columns for one integration row.
func (h Handler) readHealth(ctx context.Context, integrationID string) (healthRow, error) {
	var hr healthRow
	err := h.DB.QueryRow(ctx, `
		SELECT lifecycle_state, last_event_at, last_success_at,
		       last_failure_at, last_failure_message, disconnected_at, health_summary
		FROM workspace_integration WHERE id=$1::uuid`, integrationID).
		Scan(&hr.LifecycleState, &hr.LastEventAt, &hr.LastSuccessAt,
			&hr.LastFailureAt, &hr.LastFailureMessage, &hr.DisconnectedAt, &hr.HealthSummary)
	return hr, err
}

// setDisconnected marks an integration as revoked/disconnected by a user.
func (h Handler) setDisconnected(ctx context.Context, integrationID, userID string) error {
	_, err := h.DB.Exec(ctx, `
		UPDATE workspace_integration
		SET lifecycle_state='revoked',
		    disconnected_at=now(),
		    disconnected_by_user_id=$2,
		    updated_at=now()
		WHERE id=$1::uuid`, integrationID, userID)
	return err
}

// enqueueJob inserts a new integration_job row with pending status.
func (h Handler) enqueueJob(ctx context.Context, workspaceIntegrationID, provider, jobType string, payload []byte) error {
	_, err := h.DB.Exec(ctx, `
		INSERT INTO integration_job
		  (workspace_integration_id, provider, job_type, status, payload, retry_count, max_retries, next_run_at)
		VALUES ($1::uuid, $2, $3, 'pending', $4::jsonb, 0, 5, now())`,
		workspaceIntegrationID, provider, jobType, string(payload))
	return err
}
