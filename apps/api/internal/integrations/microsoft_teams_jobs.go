package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MicrosoftTeamsWorker struct {
	DB       *pgxpool.Pool
	Client   *http.Client
	Interval time.Duration
}

type microsoftTeamsJob struct {
	ID            string
	WorkspaceID   string
	IntegrationID string
	Payload       map[string]any
	Attempts      int
	MaxAttempts   int
}

type microsoftTeamsCredential struct {
	BotToken   string `json:"botToken"`
	ServiceURL string `json:"serviceUrl"`
	WebhookURL string `json:"webhookUrl"`
	TenantID   string `json:"tenantId"`
}

type microsoftTeamsOutboundMessage struct {
	ChannelID  string `json:"channel_id"`
	Text       string `json:"text"`
	WebhookURL string `json:"webhook_url,omitempty"`
}

func (w MicrosoftTeamsWorker) Start(ctx context.Context) {
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

func (w MicrosoftTeamsWorker) RunOnce(ctx context.Context) error {
	if w.DB == nil {
		return nil
	}
	job, err := w.claimMicrosoftTeamsOutboundJob(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := w.deliverMicrosoftTeamsJob(ctx, job); err != nil {
		_ = w.failMicrosoftTeamsJob(ctx, job, err)
		return err
	}
	return w.succeedMicrosoftTeamsJob(ctx, job)
}

func (w MicrosoftTeamsWorker) claimMicrosoftTeamsOutboundJob(ctx context.Context) (microsoftTeamsJob, error) {
	var job microsoftTeamsJob
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `
		update provider_job
		set status='running', attempts=attempts+1, started_at=now(), updated_at=now()
		where id = (
			select id
			from provider_job
			where provider='microsoft_teams'
				and kind='outbound_delivery'
				and status in ('queued','failed')
				and coalesce(next_run_at, scheduled_at) <= now()
			order by scheduled_at asc
			limit 1
			for update skip locked
		)
		returning id::text, workspace_id::text, workspace_integration_id::text, payload, attempts, max_attempts`).Scan(&job.ID, &job.WorkspaceID, &job.IntegrationID, &payloadRaw, &job.Attempts, &job.MaxAttempts)
	if err != nil {
		return microsoftTeamsJob{}, err
	}
	job.Payload = map[string]any{}
	if err := json.Unmarshal(payloadRaw, &job.Payload); err != nil {
		return microsoftTeamsJob{}, err
	}
	return job, nil
}

func (w MicrosoftTeamsWorker) deliverMicrosoftTeamsJob(ctx context.Context, job microsoftTeamsJob) error {
	credential, err := w.activeMicrosoftTeamsCredential(ctx, job.IntegrationID)
	if err != nil {
		return err
	}
	message := microsoftTeamsOutboundMessage{
		ChannelID:  stringValue(job.Payload["channel_id"]),
		Text:       stringValue(job.Payload["text"]),
		WebhookURL: stringValue(job.Payload["webhook_url"]),
	}
	if message.ChannelID == "" || message.Text == "" {
		return fmt.Errorf("Microsoft Teams outbound delivery requires channel_id and text")
	}
	return postMicrosoftTeamsMessage(ctx, w.httpClient(), credential, message)
}

func (w MicrosoftTeamsWorker) activeMicrosoftTeamsCredential(ctx context.Context, integrationID string) (microsoftTeamsCredential, error) {
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `
		select encrypted_payload
		from provider_credential
		where workspace_integration_id=$1::uuid and provider='microsoft_teams' and active
		limit 1`, integrationID).Scan(&payloadRaw)
	if err != nil {
		return microsoftTeamsCredential{}, err
	}
	var credential microsoftTeamsCredential
	if err := decryptProviderCredentialJSON(ctx, w.DB, integrationID, "microsoft_teams", payloadRaw, &credential); err != nil {
		return microsoftTeamsCredential{}, err
	}
	if credential.WebhookURL == "" && (credential.ServiceURL == "" || credential.BotToken == "") {
		return microsoftTeamsCredential{}, fmt.Errorf("active Microsoft Teams credential is missing webhook URL or bot service credentials")
	}
	return credential, nil
}

func (w MicrosoftTeamsWorker) succeedMicrosoftTeamsJob(ctx context.Context, job microsoftTeamsJob) error {
	now := time.Now().UTC()
	tx, err := w.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	if _, err := tx.Exec(ctx, `update provider_job set status='succeeded', completed_at=$2, last_error=null, updated_at=$2 where id=$1::uuid`, job.ID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update workspace_integration set status='connected', last_success_at=$2, last_event_at=$2, last_failure_at=null, last_failure_message=null, updated_at=$2 where id=$1::uuid`, job.IntegrationID, now); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at)
		values ($1::uuid, $2::uuid, 'microsoft_teams', $3::uuid, 'outbound_delivery_succeeded', 'info', 'Microsoft Teams message delivered.', '{}'::jsonb, $4)`, job.WorkspaceID, job.IntegrationID, job.ID, now)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w MicrosoftTeamsWorker) failMicrosoftTeamsJob(ctx context.Context, job microsoftTeamsJob, cause error) error {
	now := time.Now().UTC()
	status, nextRunAt := providerJobFailureStatus(job.Attempts, job.MaxAttempts)
	tx, err := w.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	if _, err := tx.Exec(ctx, `update provider_job set status=$2, last_error=$3, next_run_at=$4, completed_at=case when $2='dead' then $5 else completed_at end, updated_at=$5 where id=$1::uuid`, job.ID, status, cause.Error(), nextRunAt, now); err != nil {
		return err
	}
	integrationStatus := "degraded"
	if isMicrosoftTeamsAuthFailure(cause) {
		integrationStatus = "error"
	}
	if _, err := tx.Exec(ctx, `update workspace_integration set status=$2, last_failure_at=$3, last_failure_message=$4, last_event_at=$3, updated_at=$3 where id=$1::uuid`, job.IntegrationID, integrationStatus, now, cause.Error()); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at)
		values ($1::uuid, $2::uuid, 'microsoft_teams', $3::uuid, 'outbound_delivery_failed', 'error', $4, '{}'::jsonb, $5)`, job.WorkspaceID, job.IntegrationID, job.ID, cause.Error(), now)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w MicrosoftTeamsWorker) httpClient() *http.Client {
	if w.Client != nil {
		return w.Client
	}
	return &http.Client{Timeout: 10 * time.Second}
}

func postMicrosoftTeamsMessage(ctx context.Context, client *http.Client, credential microsoftTeamsCredential, message microsoftTeamsOutboundMessage) error {
	endpoint := strings.TrimSpace(message.WebhookURL)
	if endpoint == "" {
		endpoint = strings.TrimRight(credential.WebhookURL, "/")
	}
	if endpoint == "" {
		base := strings.TrimRight(credential.ServiceURL, "/")
		endpoint = base + "/v3/conversations/" + url.PathEscape(message.ChannelID) + "/activities"
	}
	body, err := json.Marshal(map[string]string{"type": "message", "text": message.Text})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if message.WebhookURL == "" && credential.WebhookURL == "" && credential.BotToken != "" {
		req.Header.Set("Authorization", "Bearer "+credential.BotToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("Microsoft Teams message delivery returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func isMicrosoftTeamsAuthFailure(err error) bool {
	message := err.Error()
	return strings.Contains(message, "HTTP 401") || strings.Contains(message, "HTTP 403") || strings.Contains(message, "invalid_grant") || strings.Contains(message, "unauthorized")
}
