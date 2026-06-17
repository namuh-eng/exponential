package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type IntercomWorker struct {
	DB       *pgxpool.Pool
	Client   *http.Client
	Interval time.Duration
}

type intercomJob struct {
	ID            string
	WorkspaceID   string
	IntegrationID string
	Payload       map[string]any
	Attempts      int
	MaxAttempts   int
}

func (w IntercomWorker) Start(ctx context.Context) {
	interval := w.Interval
	if interval <= 0 {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = w.RunOnce(ctx)
		}
	}
}

func (w IntercomWorker) RunOnce(ctx context.Context) error {
	if w.DB == nil {
		return nil
	}
	job, err := w.claimIntercomOutboundJob(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := w.deliverIntercomJob(ctx, job); err != nil {
		_ = w.failIntercomJob(ctx, job, err)
		return err
	}
	return w.succeedIntercomJob(ctx, job)
}

func (w IntercomWorker) claimIntercomOutboundJob(ctx context.Context) (intercomJob, error) {
	var job intercomJob
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `
		update provider_job
		set status='running', attempts=attempts+1, started_at=now(), updated_at=now()
		where id = (
			select id
			from provider_job
			where provider='intercom'
				and kind='outbound_delivery'
				and status in ('queued','failed')
				and (next_run_at is null or next_run_at <= now())
			order by scheduled_at asc, created_at asc
			limit 1
			for update skip locked
		)
		returning id::text, workspace_id::text, workspace_integration_id::text, payload, attempts, max_attempts`).Scan(&job.ID, &job.WorkspaceID, &job.IntegrationID, &payloadRaw, &job.Attempts, &job.MaxAttempts)
	if err != nil {
		return job, err
	}
	job.Payload = map[string]any{}
	_ = json.Unmarshal(payloadRaw, &job.Payload)
	return job, nil
}

func (w IntercomWorker) deliverIntercomJob(ctx context.Context, job intercomJob) error {
	credential, err := w.activeIntercomCredential(ctx, job.IntegrationID)
	if err != nil {
		return err
	}
	switch stringValue(job.Payload["type"]) {
	case "conversation_note":
		conversationID := stringValue(job.Payload["conversationId"])
		body := stringValue(job.Payload["body"])
		if conversationID == "" || body == "" {
			return fmt.Errorf("Intercom note delivery requires conversationId and body")
		}
		return postIntercomConversationNote(ctx, w.httpClient(), credential, conversationID, body)
	default:
		return fmt.Errorf("unsupported Intercom outbound job type %q", stringValue(job.Payload["type"]))
	}
}

func (w IntercomWorker) activeIntercomCredential(ctx context.Context, integrationID string) (intercomCredential, error) {
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `select encrypted_payload from provider_credential where workspace_integration_id=$1::uuid and provider='intercom' and active limit 1`, integrationID).Scan(&payloadRaw)
	if err != nil {
		return intercomCredential{}, err
	}
	var credential intercomCredential
	if err := decryptProviderCredentialJSON(ctx, w.DB, integrationID, "intercom", payloadRaw, &credential); err != nil {
		return intercomCredential{}, err
	}
	if credential.AccessToken == "" {
		return intercomCredential{}, fmt.Errorf("active Intercom credential is missing access token")
	}
	if credential.AdminID == "" {
		credential.AdminID = strings.TrimSpace(os.Getenv("INTERCOM_ADMIN_ID"))
	}
	return credential, nil
}

func (w IntercomWorker) succeedIntercomJob(ctx context.Context, job intercomJob) error {
	now := time.Now().UTC()
	tx, err := w.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `update provider_job set status='succeeded', completed_at=$2, last_error=null, updated_at=$2 where id=$1::uuid`, job.ID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update workspace_integration set status='connected', last_success_at=$2, last_event_at=$2, last_failure_at=null, last_failure_message=null, updated_at=$2 where id=$1::uuid`, job.IntegrationID, now); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'intercom',$3::uuid,'outbound_delivery_succeeded','info','Intercom update delivered.','{}'::jsonb,$4)`, job.WorkspaceID, job.IntegrationID, job.ID, now)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w IntercomWorker) failIntercomJob(ctx context.Context, job intercomJob, cause error) error {
	now := time.Now().UTC()
	status, nextRunAt := providerJobFailureStatus(job.Attempts, job.MaxAttempts)
	tx, err := w.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `update provider_job set status=$2, last_error=$3, next_run_at=$4, completed_at=case when $2='dead' then $5 else completed_at end, updated_at=$5 where id=$1::uuid`, job.ID, status, safeIntercomError(cause), nextRunAt, now); err != nil {
		return err
	}
	integrationStatus := "degraded"
	if isIntercomAuthFailure(cause) {
		integrationStatus = "error"
	}
	if _, err := tx.Exec(ctx, `update workspace_integration set status=$2, last_failure_at=$3, last_failure_message=$4, last_event_at=$3, updated_at=$3 where id=$1::uuid`, job.IntegrationID, integrationStatus, now, safeIntercomError(cause)); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'intercom',$3::uuid,'outbound_delivery_failed','error',$4,'{}'::jsonb,$5)`, job.WorkspaceID, job.IntegrationID, job.ID, safeIntercomError(cause), now)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w IntercomWorker) httpClient() *http.Client {
	if w.Client != nil {
		return w.Client
	}
	return http.DefaultClient
}

func postIntercomConversationNote(ctx context.Context, client *http.Client, credential intercomCredential, conversationID string, body string) error {
	if credential.AdminID == "" {
		return fmt.Errorf("Intercom note delivery requires an admin id")
	}
	payload, _ := json.Marshal(map[string]string{"message_type": "note", "type": "admin", "admin_id": credential.AdminID, "body": body})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, intercomAPIBaseURL()+"/conversations/"+conversationID+"/reply", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+credential.AccessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("Intercom reply returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func isIntercomAuthFailure(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "http 401") || strings.Contains(message, "http 403") || strings.Contains(message, "unauthorized") || strings.Contains(message, "forbidden")
}
