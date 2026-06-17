package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SalesforceWorker struct{ DB *pgxpool.Pool }

type salesforceCredential struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	TokenType    string `json:"tokenType"`
	InstanceURL  string `json:"instanceUrl"`
	Scope        string `json:"scope"`
	OrgID        string `json:"orgId"`
	APIVersion   string `json:"apiVersion"`
}

type salesforceJob struct {
	ID            string
	WorkspaceID   string
	IntegrationID string
	Payload       map[string]any
	Attempts      int
	MaxAttempts   int
}

func (w SalesforceWorker) Start(ctx context.Context) {
	if w.DB == nil {
		return
	}
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for {
				job, err := w.claimSalesforceJob(ctx)
				if errors.Is(err, pgx.ErrNoRows) {
					break
				}
				if err != nil {
					break
				}
				if err := w.deliverSalesforceJob(ctx, job); err != nil {
					_ = w.failSalesforceJob(ctx, job, err)
					continue
				}
				_ = w.succeedSalesforceJob(ctx, job)
			}
		}
	}
}

func (w SalesforceWorker) claimSalesforceJob(ctx context.Context) (salesforceJob, error) {
	tx, err := w.DB.Begin(ctx)
	if err != nil {
		return salesforceJob{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var job salesforceJob
	var payloadRaw []byte
	err = tx.QueryRow(ctx, `
		update provider_job
		set status='running', attempts=attempts+1, started_at=now(), updated_at=now()
		where id=(
			select pj.id
			from provider_job pj
			join workspace_integration wi on wi.id=pj.workspace_integration_id
			where pj.provider='salesforce'
				and pj.kind='outbound_delivery'
				and pj.status in ('queued','failed')
				and (pj.next_run_at is null or pj.next_run_at <= now())
				and wi.status in ('connected','degraded')
			order by pj.scheduled_at asc
			limit 1
			for update skip locked
		)
		returning id::text, workspace_id::text, workspace_integration_id::text, payload, attempts, max_attempts`).Scan(&job.ID, &job.WorkspaceID, &job.IntegrationID, &payloadRaw, &job.Attempts, &job.MaxAttempts)
	if err != nil {
		return salesforceJob{}, err
	}
	if err := json.Unmarshal(payloadRaw, &job.Payload); err != nil {
		return salesforceJob{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return salesforceJob{}, err
	}
	return job, nil
}

func (w SalesforceWorker) deliverSalesforceJob(ctx context.Context, job salesforceJob) error {
	credential, err := w.activeSalesforceCredential(ctx, job.IntegrationID)
	if err != nil {
		return err
	}
	caseID := firstNonEmpty(stringValue(job.Payload["caseId"]), stringValue(job.Payload["salesforceCaseId"]))
	if caseID == "" {
		caseID, err = w.salesforceCaseIDForIssue(ctx, job.IntegrationID, stringValue(job.Payload["issueId"]))
		if err != nil {
			return err
		}
	}
	body := salesforceCasePatchBody(job.Payload)
	if len(body) == 0 {
		return nil
	}
	return patchSalesforceCase(ctx, http.DefaultClient, credential, caseID, body)
}

func (w SalesforceWorker) activeSalesforceCredential(ctx context.Context, integrationID string) (salesforceCredential, error) {
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `select encrypted_payload from provider_credential where workspace_integration_id=$1::uuid and provider='salesforce' and active limit 1`, integrationID).Scan(&payloadRaw)
	if err != nil {
		return salesforceCredential{}, err
	}
	var credential salesforceCredential
	if err := decryptProviderCredentialJSON(ctx, w.DB, integrationID, "salesforce", payloadRaw, &credential); err != nil {
		return salesforceCredential{}, err
	}
	if credential.AccessToken == "" || credential.InstanceURL == "" {
		return salesforceCredential{}, fmt.Errorf("Salesforce credential is missing access token or instance URL")
	}
	if credential.APIVersion == "" {
		credential.APIVersion = salesforceAPIVersion()
	}
	return credential, nil
}

func (w SalesforceWorker) salesforceCaseIDForIssue(ctx context.Context, integrationID string, issueID string) (string, error) {
	var caseID string
	err := w.DB.QueryRow(ctx, `
		select source_event_id
		from integration_thread_link
		where workspace_integration_id=$1::uuid and provider='salesforce' and issue_id=$2::uuid and source_event_id is not null
		order by created_at asc
		limit 1`, integrationID, issueID).Scan(&caseID)
	return caseID, err
}

func salesforceCasePatchBody(payload map[string]any) map[string]any {
	body := map[string]any{}
	if status := strings.TrimSpace(stringValue(payload["status"])); status != "" {
		body[salesforceStatusField()] = status
	}
	if priority := strings.TrimSpace(stringValue(payload["priority"])); priority != "" {
		body[salesforcePriorityField()] = priority
	}
	if issueURL := strings.TrimSpace(stringValue(payload["issueUrl"])); issueURL != "" {
		body[salesforceIssueURLField()] = issueURL
	}
	if followUp := strings.TrimSpace(stringValue(payload["followUp"])); followUp != "" {
		body[salesforceFollowUpField()] = followUp
	}
	return body
}

func salesforceStatusField() string {
	if v := strings.TrimSpace(getenvSalesforceField("SALESFORCE_STATUS_FIELD")); v != "" {
		return v
	}
	return "Exponential_Status__c"
}

func salesforcePriorityField() string {
	if v := strings.TrimSpace(getenvSalesforceField("SALESFORCE_PRIORITY_FIELD")); v != "" {
		return v
	}
	return "Exponential_Priority__c"
}

func salesforceIssueURLField() string {
	if v := strings.TrimSpace(getenvSalesforceField("SALESFORCE_ISSUE_URL_FIELD")); v != "" {
		return v
	}
	return "Exponential_Issue_URL__c"
}

func salesforceFollowUpField() string {
	if v := strings.TrimSpace(getenvSalesforceField("SALESFORCE_FOLLOW_UP_FIELD")); v != "" {
		return v
	}
	return "Exponential_Follow_Up__c"
}

func getenvSalesforceField(name string) string {
	return strings.TrimSpace(os.Getenv(name))
}

func (w SalesforceWorker) succeedSalesforceJob(ctx context.Context, job salesforceJob) error {
	return pgx.BeginFunc(ctx, w.DB, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		if _, err := tx.Exec(ctx, `update provider_job set status='succeeded', completed_at=$2, updated_at=$2, last_error=null where id=$1::uuid`, job.ID, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update workspace_integration set status='connected', last_success_at=$2, last_event_at=$2, last_failure_at=null, last_failure_message=null, updated_at=$2 where id=$1::uuid`, job.IntegrationID, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'salesforce',$3::uuid,'outbound_delivery_succeeded','info','Salesforce case sync delivered.','{}'::jsonb,$4)`, job.WorkspaceID, job.IntegrationID, job.ID, now)
		return err
	})
}

func (w SalesforceWorker) failSalesforceJob(ctx context.Context, job salesforceJob, cause error) error {
	return pgx.BeginFunc(ctx, w.DB, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		status := "failed"
		if job.Attempts >= job.MaxAttempts {
			status = "dead"
		}
		nextRun := now.Add(time.Duration(job.Attempts*job.Attempts) * time.Minute)
		if _, err := tx.Exec(ctx, `update provider_job set status=$2, last_error=$3, next_run_at=$4, completed_at=case when $2='dead' then $5 else completed_at end, updated_at=$5 where id=$1::uuid`, job.ID, status, cause.Error(), nextRun, now); err != nil {
			return err
		}
		integrationStatus := "degraded"
		if isSalesforceTokenFailure(cause) {
			integrationStatus = "error"
		}
		if _, err := tx.Exec(ctx, `update workspace_integration set status=$2, last_failure_at=$3, last_failure_message=$4, last_event_at=$3, updated_at=$3 where id=$1::uuid`, job.IntegrationID, integrationStatus, now, cause.Error()); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'salesforce',$3::uuid,'outbound_delivery_failed','error',$4,'{}'::jsonb,$5)`, job.WorkspaceID, job.IntegrationID, job.ID, cause.Error(), now)
		return err
	})
}

func isSalesforceTokenFailure(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "401") || strings.Contains(msg, "invalid_session") || strings.Contains(msg, "invalid_grant") || strings.Contains(msg, "unauthorized")
}
