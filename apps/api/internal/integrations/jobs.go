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
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxProviderRetryDelay = time.Hour

func nextProviderRetryAt(now time.Time, attempts int) time.Time {
	if attempts < 1 {
		attempts = 1
	}
	delay := time.Minute
	for i := 1; i < attempts && delay < maxProviderRetryDelay; i++ {
		delay *= 2
	}
	if delay > maxProviderRetryDelay {
		delay = maxProviderRetryDelay
	}
	return now.Add(delay)
}

func providerJobFailureStatus(attempts int, maxAttempts int) (status string, nextRunAt *time.Time) {
	if maxAttempts < 1 {
		maxAttempts = 1
	}
	if attempts >= maxAttempts {
		return "dead", nil
	}
	next := nextProviderRetryAt(time.Now().UTC(), attempts)
	return "failed", &next
}

type SlackWorker struct {
	DB       *pgxpool.Pool
	Client   *http.Client
	Interval time.Duration
}

type slackJob struct {
	ID            string
	WorkspaceID   string
	IntegrationID string
	Payload       map[string]any
	Attempts      int
	MaxAttempts   int
}

type slackCredential struct {
	BotToken string   `json:"botToken"`
	TeamID   string   `json:"teamId"`
	Scopes   []string `json:"scopes"`
}

type slackPostMessageRequest struct {
	Channel  string `json:"channel"`
	Text     string `json:"text"`
	ThreadTS string `json:"thread_ts,omitempty"`
}

type slackPostMessageResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
	TS    string `json:"ts"`
}

type slackUnfurlRequest struct {
	Channel   string                           `json:"channel"`
	MessageTS string                           `json:"ts"`
	Unfurls   map[string]slackUnfurlAttachment `json:"unfurls"`
}

func (w SlackWorker) Start(ctx context.Context) {
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

func (w SlackWorker) RunOnce(ctx context.Context) error {
	if w.DB == nil {
		return nil
	}
	job, err := w.claimSlackOutboundJob(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := w.deliverSlackJob(ctx, job); err != nil {
		_ = w.failSlackJob(ctx, job, err)
		return err
	}
	return w.succeedSlackJob(ctx, job)
}

func (w SlackWorker) claimSlackOutboundJob(ctx context.Context) (slackJob, error) {
	var job slackJob
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `
		update provider_job
		set status='running', attempts=attempts+1, started_at=now(), updated_at=now()
		where id = (
			select id
			from provider_job
			where provider='slack'
				and kind='outbound_delivery'
				and status in ('queued','failed')
				and coalesce(next_run_at, scheduled_at) <= now()
			order by scheduled_at asc
			limit 1
			for update skip locked
		)
		returning id::text, workspace_id::text, workspace_integration_id::text, payload, attempts, max_attempts`).Scan(&job.ID, &job.WorkspaceID, &job.IntegrationID, &payloadRaw, &job.Attempts, &job.MaxAttempts)
	if err != nil {
		return slackJob{}, err
	}
	job.Payload = map[string]any{}
	if err := json.Unmarshal(payloadRaw, &job.Payload); err != nil {
		return slackJob{}, err
	}
	return job, nil
}

func (w SlackWorker) deliverSlackJob(ctx context.Context, job slackJob) error {
	credential, err := w.activeSlackCredential(ctx, job.IntegrationID)
	if err != nil {
		return err
	}
	if stringValue(job.Payload["type"]) == "unfurl" {
		unfurls := map[string]slackUnfurlAttachment{}
		raw, _ := json.Marshal(job.Payload["unfurls"])
		_ = json.Unmarshal(raw, &unfurls)
		message := slackUnfurlRequest{
			Channel:   stringValue(job.Payload["channel"]),
			MessageTS: stringValue(job.Payload["message_ts"]),
			Unfurls:   unfurls,
		}
		if message.Channel == "" || message.MessageTS == "" || len(message.Unfurls) == 0 {
			return fmt.Errorf("Slack unfurl delivery requires channel, message_ts, and unfurls")
		}
		return postSlackUnfurl(ctx, w.httpClient(), credential.BotToken, message)
	}
	message := slackPostMessageRequest{
		Channel:  stringValue(job.Payload["channel"]),
		Text:     stringValue(job.Payload["text"]),
		ThreadTS: stringValue(job.Payload["thread_ts"]),
	}
	if message.Channel == "" || message.Text == "" {
		return fmt.Errorf("Slack outbound delivery requires channel and text")
	}
	return postSlackMessage(ctx, w.httpClient(), credential.BotToken, message)
}

func (w SlackWorker) activeSlackCredential(ctx context.Context, integrationID string) (slackCredential, error) {
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `
		select encrypted_payload
		from provider_credential
		where workspace_integration_id=$1::uuid and provider='slack' and active
		limit 1`, integrationID).Scan(&payloadRaw)
	if err != nil {
		return slackCredential{}, err
	}
	var credential slackCredential
	if err := json.Unmarshal(payloadRaw, &credential); err != nil {
		return slackCredential{}, err
	}
	if credential.BotToken == "" {
		return slackCredential{}, fmt.Errorf("active Slack credential is missing bot token")
	}
	return credential, nil
}

func (w SlackWorker) succeedSlackJob(ctx context.Context, job slackJob) error {
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
		values ($1::uuid, $2::uuid, 'slack', $3::uuid, 'outbound_delivery_succeeded', 'info', 'Slack message delivered.', '{}'::jsonb, $4)`, job.WorkspaceID, job.IntegrationID, job.ID, now)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w SlackWorker) failSlackJob(ctx context.Context, job slackJob, cause error) error {
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
	if isSlackTokenFailure(cause) {
		integrationStatus = "error"
	}
	if _, err := tx.Exec(ctx, `update workspace_integration set status=$2, last_failure_at=$3, last_failure_message=$4, last_event_at=$3, updated_at=$3 where id=$1::uuid`, job.IntegrationID, integrationStatus, now, cause.Error()); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at)
		values ($1::uuid, $2::uuid, 'slack', $3::uuid, 'outbound_delivery_failed', 'error', $4, '{}'::jsonb, $5)`, job.WorkspaceID, job.IntegrationID, job.ID, cause.Error(), now)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w SlackWorker) httpClient() *http.Client {
	if w.Client != nil {
		return w.Client
	}
	return &http.Client{Timeout: 10 * time.Second}
}

func postSlackMessage(ctx context.Context, client *http.Client, botToken string, message slackPostMessageRequest) error {
	body, err := json.Marshal(message)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, slackAPIBaseURL()+"/chat.postMessage", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+botToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var decoded slackPostMessageResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("Slack chat.postMessage returned HTTP %d", resp.StatusCode)
	}
	if !decoded.OK {
		if decoded.Error == "" {
			decoded.Error = "unknown_error"
		}
		return fmt.Errorf("Slack chat.postMessage failed: %s", decoded.Error)
	}
	return nil
}

func postSlackUnfurl(ctx context.Context, client *http.Client, botToken string, message slackUnfurlRequest) error {
	body, err := json.Marshal(message)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, slackAPIBaseURL()+"/chat.unfurl", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+botToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var decoded struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("Slack chat.unfurl returned HTTP %d", resp.StatusCode)
	}
	if !decoded.OK {
		if decoded.Error == "" {
			decoded.Error = "unknown_error"
		}
		return fmt.Errorf("Slack chat.unfurl failed: %s", decoded.Error)
	}
	return nil
}

func isSlackTokenFailure(err error) bool {
	message := err.Error()
	return strings.Contains(message, "invalid_auth") ||
		strings.Contains(message, "account_inactive") ||
		strings.Contains(message, "token_revoked") ||
		strings.Contains(message, "missing_scope")
}
