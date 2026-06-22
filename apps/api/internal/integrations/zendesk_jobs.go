package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ZendeskWorker struct {
	DB       *pgxpool.Pool
	Client   *http.Client
	Interval time.Duration
}

type zendeskJob struct {
	ID            string
	WorkspaceID   string
	IntegrationID string
	Payload       map[string]any
	Attempts      int
	MaxAttempts   int
}

func (w ZendeskWorker) Start(ctx context.Context) {
	interval := w.Interval
	if interval <= 0 {
		interval = 5 * time.Second
	}
	for {
		_ = w.RunOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

func (w ZendeskWorker) RunOnce(ctx context.Context) error {
	if w.DB == nil {
		return nil
	}
	job, err := w.claimZendeskOutboundJob(ctx)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return err
	}
	if err := w.deliverZendeskJob(ctx, job); err != nil {
		return w.failZendeskJob(ctx, job, err)
	}
	return w.succeedZendeskJob(ctx, job)
}

func (w ZendeskWorker) claimZendeskOutboundJob(ctx context.Context) (zendeskJob, error) {
	var job zendeskJob
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `
		update provider_job
		set status='running', attempts=attempts+1, started_at=now(), updated_at=now()
		where id = (
			select id
			from provider_job
			where provider='zendesk'
				and kind='outbound_delivery'
				and status in ('queued','failed')
				and (next_run_at is null or next_run_at <= now())
			order by scheduled_at asc
			for update skip locked
			limit 1
		)
		returning id::text, workspace_id::text, workspace_integration_id::text, payload, attempts, max_attempts`).Scan(&job.ID, &job.WorkspaceID, &job.IntegrationID, &payloadRaw, &job.Attempts, &job.MaxAttempts)
	if err != nil {
		return zendeskJob{}, err
	}
	job.Payload = map[string]any{}
	if err := json.Unmarshal(payloadRaw, &job.Payload); err != nil {
		return zendeskJob{}, err
	}
	return job, nil
}

func (w ZendeskWorker) deliverZendeskJob(ctx context.Context, job zendeskJob) error {
	credential, err := w.activeZendeskCredential(ctx, job.IntegrationID)
	if err != nil {
		return err
	}
	if stringValue(job.Payload["type"]) != "ticket_followup" {
		return fmt.Errorf("unsupported Zendesk outbound job type %q", stringValue(job.Payload["type"]))
	}
	ticketID := stringValue(job.Payload["ticketId"])
	identifier := stringValue(job.Payload["identifier"])
	category := stringValue(job.Payload["category"])
	if ticketID == "" || identifier == "" {
		return fmt.Errorf("Zendesk follow-up job requires ticketId and identifier")
	}
	note := strings.TrimSpace(stringValue(job.Payload["note"]))
	if note == "" {
		note = strings.TrimSpace(credential.CloseNoteBody)
	}
	if note == "" {
		note = "Linked Exponential issue " + identifier + " reached " + category + "."
	}
	return updateZendeskTicket(ctx, w.httpClient(), credential, ticketID, note)
}

func (w ZendeskWorker) activeZendeskCredential(ctx context.Context, integrationID string) (zendeskCredential, error) {
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `select encrypted_payload from provider_credential where workspace_integration_id=$1::uuid and provider='zendesk' and active limit 1`, integrationID).Scan(&payloadRaw)
	if err != nil {
		return zendeskCredential{}, err
	}
	var credential zendeskCredential
	if err := decryptProviderCredentialJSON(ctx, w.DB, integrationID, "zendesk", payloadRaw, &credential); err != nil {
		return zendeskCredential{}, err
	}
	return credential, nil
}

func updateZendeskTicket(ctx context.Context, client *http.Client, credential zendeskCredential, ticketID string, note string) error {
	if client == nil {
		client = http.DefaultClient
	}
	body := map[string]any{
		"ticket": map[string]any{
			"comment": map[string]any{"body": note, "public": false},
			"status":  "open",
		},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	endpoint := zendeskAPIURL(credential.Subdomain, credential.AccountURL, "/api/v2/tickets/"+ticketID+".json")
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.SetBasicAuth(credential.Email+"/token", credential.APIToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("Zendesk rejected outbound credentials")
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("Zendesk ticket update returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func (w ZendeskWorker) succeedZendeskJob(ctx context.Context, job zendeskJob) error {
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
	_, err = tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'zendesk',$3::uuid,'outbound_delivery_succeeded','info','Zendesk ticket follow-up delivered.','{}'::jsonb,$4)`, job.WorkspaceID, job.IntegrationID, job.ID, now)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w ZendeskWorker) failZendeskJob(ctx context.Context, job zendeskJob, cause error) error {
	now := time.Now().UTC()
	status, nextRunAt := providerJobFailureStatus(job.Attempts, job.MaxAttempts)
	tx, err := w.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `update provider_job set status=$2, last_error=$3, next_run_at=$4, completed_at=case when $2='dead' then $5 else completed_at end, updated_at=$5 where id=$1::uuid`, job.ID, status, cause.Error(), nextRunAt, now); err != nil {
		return err
	}
	integrationStatus := "degraded"
	if status == "dead" {
		integrationStatus = "error"
	}
	if _, err := tx.Exec(ctx, `update workspace_integration set status=$2, last_failure_at=$3, last_failure_message=$4, last_event_at=$3, updated_at=$3 where id=$1::uuid`, job.IntegrationID, integrationStatus, now, cause.Error()); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'zendesk',$3::uuid,'outbound_delivery_failed','error',$4,'{}'::jsonb,$5)`, job.WorkspaceID, job.IntegrationID, job.ID, cause.Error(), now)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w ZendeskWorker) httpClient() *http.Client {
	if w.Client != nil {
		return w.Client
	}
	return http.DefaultClient
}
