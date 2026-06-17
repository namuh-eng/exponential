package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SentryWorker struct {
	DB       *pgxpool.Pool
	Client   *http.Client
	Interval time.Duration
}

type sentryJob struct {
	ID            string
	WorkspaceID   string
	IntegrationID string
	Payload       map[string]any
	Attempts      int
	MaxAttempts   int
}

type sentryCredential struct {
	AccessToken string `json:"accessToken"`
	TokenType   string `json:"tokenType"`
	OrgSlug     string `json:"orgSlug"`
}

func (w SentryWorker) Start(ctx context.Context) {
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

func (w SentryWorker) RunOnce(ctx context.Context) error {
	if w.DB == nil {
		return nil
	}
	job, err := w.claimSentryOutboundJob(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := w.deliverSentryJob(ctx, job); err != nil {
		_ = w.failSentryJob(ctx, job, err)
		return err
	}
	return w.succeedSentryJob(ctx, job)
}

func (w SentryWorker) claimSentryOutboundJob(ctx context.Context) (sentryJob, error) {
	var job sentryJob
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `
		update provider_job
		set status='running', attempts=attempts+1, started_at=now(), updated_at=now()
		where id = (
			select id
			from provider_job
			where provider='sentry'
				and kind='outbound_delivery'
				and status in ('queued','failed')
				and coalesce(next_run_at, scheduled_at) <= now()
			order by scheduled_at asc
			limit 1
			for update skip locked
		)
		returning id::text, workspace_id::text, workspace_integration_id::text, payload, attempts, max_attempts`).Scan(&job.ID, &job.WorkspaceID, &job.IntegrationID, &payloadRaw, &job.Attempts, &job.MaxAttempts)
	if err != nil {
		return sentryJob{}, err
	}
	job.Payload = map[string]any{}
	if err := json.Unmarshal(payloadRaw, &job.Payload); err != nil {
		return sentryJob{}, err
	}
	return job, nil
}

func (w SentryWorker) deliverSentryJob(ctx context.Context, job sentryJob) error {
	credential, err := w.activeSentryCredential(ctx, job.IntegrationID)
	if err != nil {
		return err
	}
	switch stringValue(job.Payload["type"]) {
	case "resolve":
		issueID := stringValue(job.Payload["sentryIssueId"])
		if issueID == "" {
			return fmt.Errorf("Sentry resolve job requires sentryIssueId")
		}
		return putSentryIssue(ctx, w.httpClient(), credential.AccessToken, issueID, map[string]any{"status": "resolved"})
	case "assign":
		issueID := stringValue(job.Payload["sentryIssueId"])
		assigneeID := stringValue(job.Payload["sentryUserId"])
		if issueID == "" || assigneeID == "" {
			return fmt.Errorf("Sentry assign job requires sentryIssueId and sentryUserId")
		}
		return putSentryIssue(ctx, w.httpClient(), credential.AccessToken, issueID, map[string]any{"assignedTo": assigneeID})
	default:
		return fmt.Errorf("unsupported Sentry outbound job type %q", stringValue(job.Payload["type"]))
	}
}

func (w SentryWorker) activeSentryCredential(ctx context.Context, integrationID string) (sentryCredential, error) {
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `select encrypted_payload from provider_credential where workspace_integration_id=$1::uuid and provider='sentry' and active limit 1`, integrationID).Scan(&payloadRaw)
	if err != nil {
		return sentryCredential{}, err
	}
	var credential sentryCredential
	if err := decryptProviderCredentialJSON(ctx, w.DB, integrationID, "sentry", payloadRaw, &credential); err != nil {
		return sentryCredential{}, err
	}
	if credential.AccessToken == "" {
		return sentryCredential{}, fmt.Errorf("active Sentry credential is missing access token")
	}
	return credential, nil
}

func (w SentryWorker) succeedSentryJob(ctx context.Context, job sentryJob) error {
	now := time.Now().UTC()
	return withSentryJobTx(ctx, w.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update provider_job set status='succeeded', completed_at=$2, last_error=null, updated_at=$2 where id=$1::uuid`, job.ID, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update workspace_integration set status='connected', last_success_at=$2, last_event_at=$2, last_failure_at=null, last_failure_message=null, updated_at=$2 where id=$1::uuid`, job.IntegrationID, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'sentry',$3::uuid,'outbound_delivery_succeeded','info','Sentry outbound automation delivered.','{}'::jsonb,$4)`, job.WorkspaceID, job.IntegrationID, job.ID, now)
		return err
	})
}

func (w SentryWorker) failSentryJob(ctx context.Context, job sentryJob, cause error) error {
	now := time.Now().UTC()
	status, nextRunAt := providerJobFailureStatus(job.Attempts, job.MaxAttempts)
	return withSentryJobTx(ctx, w.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update provider_job set status=$2, last_error=$3, next_run_at=$4, completed_at=case when $2='dead' then $5 else completed_at end, updated_at=$5 where id=$1::uuid`, job.ID, status, cause.Error(), nextRunAt, now); err != nil {
			return err
		}
		integrationStatus := "degraded"
		if isSentryTokenFailure(cause) {
			integrationStatus = "error"
		}
		if _, err := tx.Exec(ctx, `update workspace_integration set status=$2, last_failure_at=$3, last_failure_message=$4, last_event_at=$3, updated_at=$3 where id=$1::uuid`, job.IntegrationID, integrationStatus, now, cause.Error()); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'sentry',$3::uuid,'outbound_delivery_failed','error',$4,'{}'::jsonb,$5)`, job.WorkspaceID, job.IntegrationID, job.ID, cause.Error(), now)
		return err
	})
}

func withSentryJobTx(ctx context.Context, db *pgxpool.Pool, fn func(pgx.Tx) error) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w SentryWorker) httpClient() *http.Client {
	if w.Client != nil {
		return w.Client
	}
	return &http.Client{Timeout: 10 * time.Second}
}

func putSentryIssue(ctx context.Context, client *http.Client, accessToken string, issueID string, payload map[string]any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, sentryBaseURL()+"/api/0/issues/"+urlPathEscape(issueID)+"/", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("Sentry issue update returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func urlPathEscape(value string) string {
	value = strings.ReplaceAll(value, "/", "%2F")
	value = strings.ReplaceAll(value, " ", "%20")
	return value
}

func isSentryTokenFailure(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "401") || strings.Contains(message, "403") || strings.Contains(message, "invalid token") || strings.Contains(message, "unauthorized")
}

var _ interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
} = (*pgxpool.Pool)(nil)
