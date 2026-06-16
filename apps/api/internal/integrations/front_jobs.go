package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type FrontWorker struct {
	DB       *pgxpool.Pool
	Client   *http.Client
	Interval time.Duration
}

type frontJob struct {
	ID            string
	WorkspaceID   string
	IntegrationID string
	Payload       map[string]any
	Attempts      int
	MaxAttempts   int
}

func (w FrontWorker) Start(ctx context.Context) {
	interval := w.Interval
	if interval <= 0 {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		_ = w.RunOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w FrontWorker) RunOnce(ctx context.Context) error {
	if w.DB == nil {
		return nil
	}
	job, err := w.claimFrontOutboundJob(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := w.deliverFrontJob(ctx, job); err != nil {
		_ = w.failFrontJob(ctx, job, err)
		return err
	}
	return w.succeedFrontJob(ctx, job)
}

func (w FrontWorker) claimFrontOutboundJob(ctx context.Context) (frontJob, error) {
	var job frontJob
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `
		update provider_job
		set status='running', attempts=attempts+1, started_at=now(), updated_at=now()
		where id = (
			select id
			from provider_job
			where provider='front'
				and kind='outbound_delivery'
				and status in ('queued','failed')
				and coalesce(next_run_at, scheduled_at) <= now()
			order by scheduled_at asc
			limit 1
			for update skip locked
		)
		returning id::text, workspace_id::text, workspace_integration_id::text, payload, attempts, max_attempts`).Scan(&job.ID, &job.WorkspaceID, &job.IntegrationID, &payloadRaw, &job.Attempts, &job.MaxAttempts)
	if err != nil {
		return frontJob{}, err
	}
	job.Payload = map[string]any{}
	if err := json.Unmarshal(payloadRaw, &job.Payload); err != nil {
		return frontJob{}, err
	}
	return job, nil
}

func (w FrontWorker) deliverFrontJob(ctx context.Context, job frontJob) error {
	credential, err := w.activeFrontCredential(ctx, job.IntegrationID)
	if err != nil {
		return err
	}
	switch stringValue(job.Payload["type"]) {
	case "reopen_conversation":
		conversationID := stringValue(job.Payload["conversationId"])
		if conversationID == "" {
			return fmt.Errorf("Front reopen job requires conversationId")
		}
		body := frontReopenCommentBody(job.Payload)
		if err := postFrontJSON(ctx, w.httpClient(), credential, http.MethodPost, "/conversations/"+urlPathEscape(conversationID)+"/comments", map[string]any{"body": body}); err != nil {
			return err
		}
		return postFrontJSON(ctx, w.httpClient(), credential, http.MethodPatch, "/conversations/"+urlPathEscape(conversationID), map[string]any{"status": "open"})
	default:
		return fmt.Errorf("unsupported Front outbound job type %q", stringValue(job.Payload["type"]))
	}
}

func (w FrontWorker) activeFrontCredential(ctx context.Context, integrationID string) (frontCredential, error) {
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `select encrypted_payload from provider_credential where workspace_integration_id=$1::uuid and provider='front' and active limit 1`, integrationID).Scan(&payloadRaw)
	if err != nil {
		return frontCredential{}, err
	}
	var credential frontCredential
	if err := json.Unmarshal(payloadRaw, &credential); err != nil {
		return frontCredential{}, err
	}
	if credential.APIToken == "" {
		return frontCredential{}, fmt.Errorf("active Front credential is missing API token")
	}
	return credential, nil
}

func (w FrontWorker) succeedFrontJob(ctx context.Context, job frontJob) error {
	now := time.Now().UTC()
	return withSentryJobTx(ctx, w.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update provider_job set status='succeeded', completed_at=$2, last_error=null, updated_at=$2 where id=$1::uuid`, job.ID, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update workspace_integration set status='connected', last_success_at=$2, last_event_at=$2, last_failure_at=null, last_failure_message=null, updated_at=$2 where id=$1::uuid`, job.IntegrationID, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'front',$3::uuid,'outbound_delivery_succeeded','info','Front conversation reopened.','{}'::jsonb,$4)`, job.WorkspaceID, job.IntegrationID, job.ID, now)
		return err
	})
}

func (w FrontWorker) failFrontJob(ctx context.Context, job frontJob, cause error) error {
	now := time.Now().UTC()
	status, nextRunAt := providerJobFailureStatus(job.Attempts, job.MaxAttempts)
	return withSentryJobTx(ctx, w.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update provider_job set status=$2, last_error=$3, next_run_at=$4, completed_at=case when $2='dead' then $5 else completed_at end, updated_at=$5 where id=$1::uuid`, job.ID, status, cause.Error(), nextRunAt, now); err != nil {
			return err
		}
		integrationStatus := "degraded"
		if isFrontPermissionFailure(cause) {
			integrationStatus = "error"
		}
		if _, err := tx.Exec(ctx, `update workspace_integration set status=$2, last_failure_at=$3, last_failure_message=$4, last_event_at=$3, updated_at=$3 where id=$1::uuid`, job.IntegrationID, integrationStatus, now, cause.Error()); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'front',$3::uuid,'outbound_delivery_failed','error',$4,'{}'::jsonb,$5)`, job.WorkspaceID, job.IntegrationID, job.ID, cause.Error(), now)
		return err
	})
}

func (w FrontWorker) httpClient() *http.Client {
	if w.Client != nil {
		return w.Client
	}
	return &http.Client{Timeout: 10 * time.Second}
}

func frontReopenCommentBody(payload map[string]any) string {
	identifier := strings.TrimSpace(stringValue(payload["identifier"]))
	title := strings.TrimSpace(stringValue(payload["title"]))
	category := strings.TrimSpace(stringValue(payload["category"]))
	issueURL := strings.TrimSpace(stringValue(payload["issueUrl"]))
	state := "completed"
	if category == "canceled" {
		state = "canceled"
	}
	label := strings.TrimSpace(identifier + " " + title)
	if label == "" {
		label = "A linked Exponential issue"
	}
	if issueURL != "" {
		return fmt.Sprintf("%s was %s in Exponential: %s", label, state, issueURL)
	}
	return fmt.Sprintf("%s was %s in Exponential.", label, state)
}

func isFrontPermissionFailure(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "401") || strings.Contains(message, "403") || strings.Contains(message, "permission") || strings.Contains(message, "private")
}
