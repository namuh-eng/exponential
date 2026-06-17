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

const gongDefaultLookback = 24 * time.Hour
const gongPollInterval = 5 * time.Minute

type GongWorker struct {
	DB       *pgxpool.Pool
	Client   *http.Client
	Interval time.Duration
}

type gongJob struct {
	ID            string
	WorkspaceID   string
	IntegrationID string
	Payload       map[string]any
	Attempts      int
	MaxAttempts   int
}

type gongCredential struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	TokenType    string `json:"tokenType"`
	TenantID     string `json:"tenantId"`
	Scope        string `json:"scope"`
}

type gongSyncResult struct {
	Processed        int
	Skipped          int
	NextPageCursor   string
	CompletedThrough string
}

type gongAPIError struct {
	StatusCode int
	Message    string
}

func (e gongAPIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("Gong API returned HTTP %d: %s", e.StatusCode, e.Message)
	}
	return fmt.Sprintf("Gong API returned HTTP %d", e.StatusCode)
}

func (w GongWorker) Start(ctx context.Context) {
	interval := w.Interval
	if interval <= 0 {
		interval = 30 * time.Second
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

func (w GongWorker) RunOnce(ctx context.Context) error {
	if w.DB == nil {
		return nil
	}
	if err := w.enqueueDueGongSync(ctx); err != nil {
		return err
	}
	job, err := w.claimGongSyncJob(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	result, err := w.deliverGongSyncJob(ctx, job)
	if err != nil {
		_ = w.failGongJob(ctx, job, err)
		return err
	}
	return w.succeedGongJob(ctx, job, result)
}

func (w GongWorker) enqueueDueGongSync(ctx context.Context) error {
	now := time.Now().UTC()
	from := now.Add(-gongDefaultLookback).Format(time.RFC3339)
	to := now.Format(time.RFC3339)
	_, err := w.DB.Exec(ctx, `
		insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at)
		select wi.workspace_id,
			wi.id,
			'gong',
			'sync',
			'queued',
			jsonb_build_object(
				'fromDateTime', coalesce(nullif(wi.metadata->>'pollingCursor',''), $1),
				'toDateTime', $2
			),
			now(),
			now()
		from workspace_integration wi
		where wi.provider='gong'
			and wi.status in ('connected','degraded')
			and wi.credentials_revoked_at is null
			and (wi.last_success_at is null or wi.last_success_at <= now() - interval '5 minutes')
			and exists (
				select 1 from provider_credential pc
				where pc.workspace_integration_id=wi.id and pc.provider='gong' and pc.active
			)
			and not exists (
				select 1 from provider_job pj
				where pj.workspace_integration_id=wi.id
					and pj.provider='gong'
					and pj.kind='sync'
					and pj.status in ('queued','running','failed')
			)
		order by coalesce(wi.last_success_at, timestamp 'epoch') asc
		limit 1`, from, to)
	return err
}

func (w GongWorker) claimGongSyncJob(ctx context.Context) (gongJob, error) {
	var job gongJob
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `
		update provider_job
		set status='running', attempts=attempts+1, started_at=now(), updated_at=now()
		where id = (
			select id
			from provider_job
			where provider='gong'
				and kind='sync'
				and status in ('queued','failed')
				and coalesce(next_run_at, scheduled_at) <= now()
			order by scheduled_at asc
			limit 1
			for update skip locked
		)
		returning id::text, workspace_id::text, workspace_integration_id::text, payload, attempts, max_attempts`).Scan(&job.ID, &job.WorkspaceID, &job.IntegrationID, &payloadRaw, &job.Attempts, &job.MaxAttempts)
	if err != nil {
		return gongJob{}, err
	}
	job.Payload = map[string]any{}
	if err := json.Unmarshal(payloadRaw, &job.Payload); err != nil {
		return gongJob{}, err
	}
	return job, nil
}

func (w GongWorker) deliverGongSyncJob(ctx context.Context, job gongJob) (gongSyncResult, error) {
	credential, err := w.activeGongCredential(ctx, job.IntegrationID)
	if err != nil {
		return gongSyncResult{}, err
	}
	install, err := w.gongInstallForJob(ctx, job)
	if err != nil {
		return gongSyncResult{}, err
	}
	from := firstNonEmpty(stringValue(job.Payload["fromDateTime"]), time.Now().UTC().Add(-gongDefaultLookback).Format(time.RFC3339))
	to := firstNonEmpty(stringValue(job.Payload["toDateTime"]), time.Now().UTC().Format(time.RFC3339))
	pageCursor := stringValue(job.Payload["pageCursor"])
	calls, nextCursor, err := retrieveGongCalls(ctx, w.httpClient(), credential, gongCallsRequest{FromDateTime: from, ToDateTime: to, Cursor: pageCursor})
	if err != nil {
		return gongSyncResult{}, err
	}
	ids := make([]string, 0, len(calls))
	for _, call := range calls {
		if call.MetaData.ID != "" {
			ids = append(ids, call.MetaData.ID)
		}
	}
	transcripts := map[string]gongAPICallTranscript{}
	if len(ids) > 0 {
		transcripts, err = retrieveGongTranscripts(ctx, w.httpClient(), credential, gongTranscriptRequest{FromDateTime: from, ToDateTime: to, CallIDs: ids})
		if err != nil {
			return gongSyncResult{}, err
		}
	}
	result := gongSyncResult{NextPageCursor: nextCursor, CompletedThrough: to}
	handler := Handler{DB: w.DB}
	for _, apiCall := range calls {
		call := gongCallFromAPI(apiCall, transcripts[apiCall.MetaData.ID])
		ingested, err := handler.ingestGongCall(ctx, install, call)
		if err != nil {
			return gongSyncResult{}, err
		}
		if ingested.Skipped {
			result.Skipped++
		} else {
			result.Processed += len(ingested.Findings)
		}
	}
	return result, nil
}

func (w GongWorker) activeGongCredential(ctx context.Context, integrationID string) (gongCredential, error) {
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `select encrypted_payload from provider_credential where workspace_integration_id=$1::uuid and provider='gong' and active limit 1`, integrationID).Scan(&payloadRaw)
	if err != nil {
		return gongCredential{}, err
	}
	var credential gongCredential
	if err := json.Unmarshal(payloadRaw, &credential); err != nil {
		return gongCredential{}, err
	}
	if credential.AccessToken == "" {
		return gongCredential{}, fmt.Errorf("active Gong credential is missing access token")
	}
	return credential, nil
}

func (w GongWorker) gongInstallForJob(ctx context.Context, job gongJob) (gongInstallRecord, error) {
	var install gongInstallRecord
	var metadataRaw []byte
	err := w.DB.QueryRow(ctx, `select workspace_id::text, id::text, coalesce(connected_by_user_id,''), coalesce(metadata,'{}'::jsonb) from workspace_integration where id=$1::uuid and workspace_id=$2::uuid and provider='gong' and status in ('connected','degraded') limit 1`, job.IntegrationID, job.WorkspaceID).Scan(&install.WorkspaceID, &install.IntegrationID, &install.ConnectedBy, &metadataRaw)
	if err != nil {
		return gongInstallRecord{}, err
	}
	install.Metadata = readJSONRecord(metadataRaw)
	return install, nil
}

func (w GongWorker) succeedGongJob(ctx context.Context, job gongJob, result gongSyncResult) error {
	now := time.Now().UTC()
	payload := map[string]any{"processed": result.Processed, "skipped": result.Skipped}
	if result.NextPageCursor != "" {
		payload["nextPageCursor"] = result.NextPageCursor
	}
	payloadRaw, _ := json.Marshal(payload)
	return withSentryJobTx(ctx, w.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update provider_job set status='succeeded', completed_at=$2, last_error=null, updated_at=$2 where id=$1::uuid`, job.ID, now); err != nil {
			return err
		}
		if result.NextPageCursor != "" {
			nextPayload, _ := json.Marshal(map[string]any{"fromDateTime": stringValue(job.Payload["fromDateTime"]), "toDateTime": stringValue(job.Payload["toDateTime"]), "pageCursor": result.NextPageCursor})
			if _, err := tx.Exec(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at) values ($1::uuid,$2::uuid,'gong','sync','queued',$3::jsonb,now(),now())`, job.WorkspaceID, job.IntegrationID, nextPayload); err != nil {
				return err
			}
		} else {
			metadataPatch, _ := json.Marshal(map[string]any{"pollingCursor": result.CompletedThrough})
			if _, err := tx.Exec(ctx, `update workspace_integration set metadata=coalesce(metadata,'{}'::jsonb) || $2::jsonb where id=$1::uuid`, job.IntegrationID, metadataPatch); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `update workspace_integration set status='connected', last_success_at=$2, last_event_at=$2, last_failure_at=null, last_failure_message=null, updated_at=$2 where id=$1::uuid`, job.IntegrationID, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'gong',$3::uuid,'sync_succeeded','info','Gong call sync completed.',$4::jsonb,$5)`, job.WorkspaceID, job.IntegrationID, job.ID, payloadRaw, now)
		return err
	})
}

func (w GongWorker) failGongJob(ctx context.Context, job gongJob, cause error) error {
	now := time.Now().UTC()
	status, nextRunAt := providerJobFailureStatus(job.Attempts, job.MaxAttempts)
	return withSentryJobTx(ctx, w.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update provider_job set status=$2, last_error=$3, next_run_at=$4, completed_at=case when $2='dead' then $5 else completed_at end, updated_at=$5 where id=$1::uuid`, job.ID, status, cause.Error(), nextRunAt, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update workspace_integration set status='degraded', last_failure_at=$2, last_failure_message=$3, last_event_at=$2, updated_at=$2 where id=$1::uuid`, job.IntegrationID, now, cause.Error()); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid,$2::uuid,'gong',$3::uuid,'sync_failed','error',$4,'{}'::jsonb,$5)`, job.WorkspaceID, job.IntegrationID, job.ID, cause.Error(), now)
		return err
	})
}

func (w GongWorker) httpClient() *http.Client {
	if w.Client != nil {
		return w.Client
	}
	return &http.Client{Timeout: 20 * time.Second}
}

type gongCallsRequest struct {
	FromDateTime string
	ToDateTime   string
	Cursor       string
}

type gongTranscriptRequest struct {
	FromDateTime string
	ToDateTime   string
	CallIDs      []string
}

type gongExtensiveResponse struct {
	Records struct {
		Cursor string `json:"cursor"`
	} `json:"records"`
	Calls []gongAPICall `json:"calls"`
}

type gongAPICall struct {
	MetaData struct {
		ID             string `json:"id"`
		URL            string `json:"url"`
		Title          string `json:"title"`
		Started        string `json:"started"`
		Duration       int    `json:"duration"`
		Direction      string `json:"direction"`
		Scope          string `json:"scope"`
		IsPrivate      bool   `json:"isPrivate"`
		WorkspaceID    string `json:"workspaceId"`
		ClientUniqueID string `json:"clientUniqueId"`
	} `json:"metaData"`
	Context []gongAPIContext `json:"context"`
	Parties []gongAPIParty   `json:"parties"`
}

type gongAPIContext struct {
	System  string              `json:"system"`
	Objects []gongAPIContextObj `json:"objects"`
}

type gongAPIContextObj struct {
	ObjectType string              `json:"objectType"`
	ObjectID   string              `json:"objectId"`
	Fields     []gongAPIFieldValue `json:"fields"`
}

type gongAPIFieldValue struct {
	Name  string `json:"name"`
	Value any    `json:"value"`
}

type gongAPIParty struct {
	ID           string           `json:"id"`
	SpeakerID    string           `json:"speakerId"`
	EmailAddress string           `json:"emailAddress"`
	Name         string           `json:"name"`
	Affiliation  string           `json:"affiliation"`
	Context      []gongAPIContext `json:"context"`
}

type gongTranscriptResponse struct {
	Records struct {
		Cursor string `json:"cursor"`
	} `json:"records"`
	CallTranscripts []gongAPICallTranscript `json:"callTranscripts"`
}

type gongAPICallTranscript struct {
	CallID     string             `json:"callId"`
	Transcript []gongAPIMonologue `json:"transcript"`
}

type gongAPIMonologue struct {
	SpeakerID string            `json:"speakerId"`
	Sentences []gongAPISentence `json:"sentences"`
}

type gongAPISentence struct {
	Start int    `json:"start"`
	Text  string `json:"text"`
}

func retrieveGongCalls(ctx context.Context, client *http.Client, credential gongCredential, request gongCallsRequest) ([]gongAPICall, string, error) {
	body := map[string]any{
		"filter": map[string]any{"fromDateTime": request.FromDateTime, "toDateTime": request.ToDateTime},
		"contentSelector": map[string]any{
			"context":       "Extended",
			"exposedFields": map[string]any{"parties": true},
		},
	}
	if request.Cursor != "" {
		body["cursor"] = request.Cursor
	}
	var decoded gongExtensiveResponse
	if err := postGongJSON(ctx, client, credential, "/v2/calls/extensive", body, &decoded); err != nil {
		var apiErr gongAPIError
		if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusNotFound {
			return []gongAPICall{}, "", nil
		}
		return nil, "", err
	}
	return decoded.Calls, decoded.Records.Cursor, nil
}

func retrieveGongTranscripts(ctx context.Context, client *http.Client, credential gongCredential, request gongTranscriptRequest) (map[string]gongAPICallTranscript, error) {
	body := map[string]any{"filter": map[string]any{"fromDateTime": request.FromDateTime, "toDateTime": request.ToDateTime, "callIds": request.CallIDs}}
	var decoded gongTranscriptResponse
	if err := postGongJSON(ctx, client, credential, "/v2/calls/transcript", body, &decoded); err != nil {
		var apiErr gongAPIError
		if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusNotFound {
			return map[string]gongAPICallTranscript{}, nil
		}
		return nil, err
	}
	out := make(map[string]gongAPICallTranscript, len(decoded.CallTranscripts))
	for _, transcript := range decoded.CallTranscripts {
		out[transcript.CallID] = transcript
	}
	return out, nil
}

func postGongJSON(ctx context.Context, client *http.Client, credential gongCredential, path string, payload map[string]any, out any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gongAPIBaseURL()+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	tokenType := firstNonEmpty(credential.TokenType, "Bearer")
	req.Header.Set("Authorization", strings.TrimSpace(tokenType+" "+credential.AccessToken))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var problem struct {
			Errors []string `json:"errors"`
			Error  string   `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&problem)
		message := problem.Error
		if message == "" && len(problem.Errors) > 0 {
			message = strings.Join(problem.Errors, "; ")
		}
		return gongAPIError{StatusCode: resp.StatusCode, Message: message}
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func gongCallFromAPI(apiCall gongAPICall, transcript gongAPICallTranscript) gongCall {
	partyBySpeaker := map[string]gongAPIParty{}
	participants := make([]gongParticipant, 0, len(apiCall.Parties))
	for _, party := range apiCall.Parties {
		external := strings.EqualFold(party.Affiliation, "External")
		participants = append(participants, gongParticipant{Name: party.Name, Email: strings.ToLower(strings.TrimSpace(party.EmailAddress)), Role: strings.ToLower(party.Affiliation), External: external})
		if party.SpeakerID != "" {
			partyBySpeaker[party.SpeakerID] = party
		}
	}
	lines := []gongTranscriptLine{}
	for _, monologue := range transcript.Transcript {
		party := partyBySpeaker[monologue.SpeakerID]
		for _, sentence := range monologue.Sentences {
			lines = append(lines, gongTranscriptLine{Speaker: party.Name, SpeakerEmail: strings.ToLower(strings.TrimSpace(party.EmailAddress)), SpeakerExternal: strings.EqualFold(party.Affiliation, "External"), StartMs: sentence.Start, Text: sentence.Text})
		}
	}
	account := gongAccountFromAPI(apiCall)
	privacy := strings.ToLower(apiCall.MetaData.Scope)
	if apiCall.MetaData.IsPrivate {
		privacy = "private"
	}
	return gongCall{ID: apiCall.MetaData.ID, Title: apiCall.MetaData.Title, URL: apiCall.MetaData.URL, DurationSeconds: apiCall.MetaData.Duration, Privacy: privacy, Direction: apiCall.MetaData.Direction, StartedAt: apiCall.MetaData.Started, Account: account, Participants: participants, Transcript: lines}
}

func gongAccountFromAPI(apiCall gongAPICall) gongAccount {
	for _, context := range apiCall.Context {
		for _, object := range context.Objects {
			if !strings.EqualFold(object.ObjectType, "Account") {
				continue
			}
			account := gongAccount{ID: object.ObjectID}
			for _, field := range object.Fields {
				name := strings.ToLower(strings.TrimSpace(field.Name))
				value := strings.TrimSpace(fmt.Sprint(field.Value))
				switch name {
				case "name", "account name", "company":
					account.Name = firstNonEmpty(account.Name, value)
				case "website", "domain":
					account.Domain = firstNonEmpty(account.Domain, domainFromWebsite(value))
				}
			}
			if account.Name != "" || account.Domain != "" || account.ID != "" {
				return account
			}
		}
	}
	for _, party := range apiCall.Parties {
		if strings.EqualFold(party.Affiliation, "External") {
			domain := domainFromEmail(party.EmailAddress)
			if domain != "" {
				return gongAccount{ID: domain, Name: domain, Domain: domain}
			}
		}
	}
	return gongAccount{ID: firstNonEmpty(apiCall.MetaData.WorkspaceID, apiCall.MetaData.ClientUniqueID, apiCall.MetaData.ID), Name: "Unknown customer"}
}

func domainFromWebsite(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	value = strings.TrimPrefix(value, "https://")
	value = strings.TrimPrefix(value, "http://")
	value = strings.TrimPrefix(value, "www.")
	if slash := strings.Index(value, "/"); slash >= 0 {
		value = value[:slash]
	}
	return value
}

func isGongPermissionFailure(err error) bool {
	var apiErr gongAPIError
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "401") || strings.Contains(message, "403") || strings.Contains(message, "unauthorized") || strings.Contains(message, "forbidden")
}
