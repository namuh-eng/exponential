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

type GoogleSheetsWorker struct {
	DB       *pgxpool.Pool
	Client   *http.Client
	Interval time.Duration
}

type googleSheetsJob struct {
	ID            string
	WorkspaceID   string
	IntegrationID string
	Attempts      int
	MaxAttempts   int
	Metadata      googleSheetsMetadata
}

type sheetTeam struct {
	ID        string
	Key       string
	Name      string
	IsPrivate bool
}

func (w GoogleSheetsWorker) Start(ctx context.Context) {
	interval := w.Interval
	if interval <= 0 {
		interval = time.Minute
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

func (w GoogleSheetsWorker) RunOnce(ctx context.Context) error {
	if w.DB == nil {
		return nil
	}
	job, err := w.claimGoogleSheetsSyncJob(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	rows, err := w.collectGoogleSheetsRows(ctx, job.WorkspaceID, job.Metadata.googleSheetsSettings)
	if err != nil {
		_ = w.failGoogleSheetsJob(ctx, job, err)
		return err
	}
	result, credential, err := w.writeGoogleSpreadsheet(ctx, job, rows)
	if err != nil {
		_ = w.failGoogleSheetsJob(ctx, job, err)
		return err
	}
	return w.succeedGoogleSheetsJob(ctx, job, rows, result, credential)
}

func (w GoogleSheetsWorker) claimGoogleSheetsSyncJob(ctx context.Context) (googleSheetsJob, error) {
	var job googleSheetsJob
	var metadataRaw []byte
	err := w.DB.QueryRow(ctx, `
		update provider_job
		set status='running', attempts=attempts+1, started_at=now(), updated_at=now()
		where id = (
			select pj.id
			from provider_job pj
			join workspace_integration wi on wi.id=pj.workspace_integration_id
			where pj.provider='google_sheets'
				and pj.kind='sync'
				and pj.status in ('queued','failed')
				and coalesce(pj.next_run_at, pj.scheduled_at) <= now()
				and wi.status in ('connected','degraded')
			order by coalesce(pj.next_run_at, pj.scheduled_at) asc
			limit 1
			for update skip locked
		)
		returning id::text, workspace_id::text, workspace_integration_id::text, attempts, max_attempts,
			(select metadata from workspace_integration where id=provider_job.workspace_integration_id)`).Scan(&job.ID, &job.WorkspaceID, &job.IntegrationID, &job.Attempts, &job.MaxAttempts, &metadataRaw)
	if err != nil {
		return googleSheetsJob{}, err
	}
	job.Metadata = normalizeGoogleSheetsMetadata(metadataRaw)
	if !hasGoogleSheetsScope(job.Metadata.googleSheetsSettings) || !job.Metadata.Enabled {
		return googleSheetsJob{}, fmt.Errorf("Google Sheets sync is disabled or has no selected scopes")
	}
	return job, nil
}

func (w GoogleSheetsWorker) collectGoogleSheetsRows(ctx context.Context, workspaceID string, settings googleSheetsSettings) (googleSheetsRows, error) {
	teams, err := w.googleSheetsTeams(ctx, workspaceID, settings.IncludePrivateTeams)
	if err != nil {
		return nil, err
	}
	visibleTeamIDs := []string{}
	visibleTeamByID := map[string]sheetTeam{}
	for _, team := range teams {
		visibleTeamIDs = append(visibleTeamIDs, team.ID)
		visibleTeamByID[team.ID] = team
	}
	out := googleSheetsRows{"issues": [][]string{}, "projects": [][]string{}, "initiatives": [][]string{}}
	projectRows, projectTeams, err := w.googleSheetsProjectRows(ctx, workspaceID, settings, visibleTeamByID)
	if err != nil {
		return nil, err
	}
	visibleProjects := map[string]bool{}
	projectSlug := map[string]string{}
	for _, row := range projectRows {
		visibleProjects[row.ID] = true
		projectSlug[row.ID] = row.Slug
		if settings.Scopes["projects"] {
			out["projects"] = append(out["projects"], row.Values)
		}
	}
	if settings.Scopes["issues"] && len(visibleTeamIDs) > 0 {
		issueRows, err := w.googleSheetsIssueRows(ctx, visibleTeamIDs, visibleProjects)
		if err != nil {
			return nil, err
		}
		out["issues"] = issueRows
	}
	if settings.Scopes["initiatives"] {
		initiativeRows, err := w.googleSheetsInitiativeRows(ctx, workspaceID, settings, visibleTeamByID, projectTeams, projectSlug)
		if err != nil {
			return nil, err
		}
		out["initiatives"] = initiativeRows
	}
	return out, nil
}

func (w GoogleSheetsWorker) googleSheetsTeams(ctx context.Context, workspaceID string, includePrivate bool) ([]sheetTeam, error) {
	wherePrivate := "and coalesce(is_private,false)=false"
	if includePrivate {
		wherePrivate = ""
	}
	rows, err := w.DB.Query(ctx, `select id::text,key,name,coalesce(is_private,false) from team where workspace_id=$1::uuid and deleted_at is null and retired_at is null `+wherePrivate+` order by key`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	teams := []sheetTeam{}
	for rows.Next() {
		var team sheetTeam
		if err := rows.Scan(&team.ID, &team.Key, &team.Name, &team.IsPrivate); err != nil {
			return nil, err
		}
		teams = append(teams, team)
	}
	return teams, rows.Err()
}

type googleProjectExportRow struct {
	ID     string
	Slug   string
	Values []string
}

func (w GoogleSheetsWorker) googleSheetsProjectRows(ctx context.Context, workspaceID string, settings googleSheetsSettings, visibleTeamByID map[string]sheetTeam) ([]googleProjectExportRow, map[string][]sheetTeam, error) {
	projects, err := w.DB.Query(ctx, `
		select id::text,name,slug,status::text,priority::text,coalesce(lead_id,''),start_date,target_date,completed_at,canceled_at,created_at,updated_at
		from project where workspace_id=$1::uuid order by name`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	defer projects.Close()
	type projectRecord struct {
		ID, Name, Slug, Status, Priority, LeadID string
		StartDate, TargetDate, CompletedAt, CanceledAt, CreatedAt, UpdatedAt *time.Time
	}
	records := []projectRecord{}
	for projects.Next() {
		var record projectRecord
		if err := projects.Scan(&record.ID, &record.Name, &record.Slug, &record.Status, &record.Priority, &record.LeadID, &record.StartDate, &record.TargetDate, &record.CompletedAt, &record.CanceledAt, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return nil, nil, err
		}
		records = append(records, record)
	}
	if err := projects.Err(); err != nil {
		return nil, nil, err
	}
	links, err := w.DB.Query(ctx, `
		select pt.project_id::text,t.id::text,t.key,coalesce(t.is_private,false)
		from project_team pt join team t on t.id=pt.team_id
		where t.workspace_id=$1::uuid and t.deleted_at is null and t.retired_at is null`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	defer links.Close()
	projectTeams := map[string][]sheetTeam{}
	for links.Next() {
		var projectID string
		var team sheetTeam
		if err := links.Scan(&projectID, &team.ID, &team.Key, &team.IsPrivate); err != nil {
			return nil, nil, err
		}
		projectTeams[projectID] = append(projectTeams[projectID], team)
	}
	if err := links.Err(); err != nil {
		return nil, nil, err
	}
	out := []googleProjectExportRow{}
	for _, record := range records {
		links := projectTeams[record.ID]
		visible := settings.IncludePrivateTeams || len(links) == 0
		teamKeys := []string{}
		for _, link := range links {
			if settings.IncludePrivateTeams || visibleTeamByID[link.ID].ID != "" {
				visible = true
				teamKeys = append(teamKeys, link.Key)
			}
		}
		if !visible {
			continue
		}
		out = append(out, googleProjectExportRow{ID: record.ID, Slug: record.Slug, Values: []string{
			record.ID, record.Name, record.Slug, record.Status, record.Priority, strings.Join(sortedUnique(teamKeys), ", "), record.LeadID,
			formatSheetCell(record.StartDate), formatSheetCell(record.TargetDate), formatSheetCell(record.CompletedAt), formatSheetCell(record.CanceledAt), formatSheetCell(record.CreatedAt), formatSheetCell(record.UpdatedAt),
		}})
	}
	return out, projectTeams, nil
}

func (w GoogleSheetsWorker) googleSheetsIssueRows(ctx context.Context, visibleTeamIDs []string, visibleProjects map[string]bool) ([][]string, error) {
	rows, err := w.DB.Query(ctx, `
		select i.id::text,i.identifier,i.title,i.team_id::text,t.key,t.name,ws.name,ws.category::text,i.priority::text,i.estimate,
			coalesce(i.project_id::text,''),coalesce(p.name,''),coalesce(i.assignee_id,''),i.created_at,i.updated_at,i.completed_at,i.canceled_at,i.archived_at
		from issue i
		join team t on t.id=i.team_id
		join workflow_state ws on ws.id=i.state_id
		left join project p on p.id=i.project_id
		where i.team_id = any($1::uuid[])
		order by t.key,i.number`, visibleTeamIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := [][]string{}
	for rows.Next() {
		var id, identifier, title, teamID, teamKey, teamName, stateName, stateCategory, priority, projectID, projectName, assigneeID string
		var estimate *float64
		var createdAt, updatedAt time.Time
		var completedAt, canceledAt, archivedAt *time.Time
		if err := rows.Scan(&id, &identifier, &title, &teamID, &teamKey, &teamName, &stateName, &stateCategory, &priority, &estimate, &projectID, &projectName, &assigneeID, &createdAt, &updatedAt, &completedAt, &canceledAt, &archivedAt); err != nil {
			return nil, err
		}
		if projectID != "" && !visibleProjects[projectID] {
			projectID = ""
			projectName = ""
		}
		out = append(out, []string{id, identifier, title, teamKey, teamName, stateName, stateCategory, priority, formatSheetCell(estimate), projectID, projectName, assigneeID, formatSheetCell(createdAt), formatSheetCell(updatedAt), formatSheetCell(completedAt), formatSheetCell(canceledAt), formatSheetCell(archivedAt)})
	}
	return out, rows.Err()
}

func (w GoogleSheetsWorker) googleSheetsInitiativeRows(ctx context.Context, workspaceID string, settings googleSheetsSettings, visibleTeamByID map[string]sheetTeam, _ map[string][]sheetTeam, projectSlug map[string]string) ([][]string, error) {
	rows, err := w.DB.Query(ctx, `select id::text,name,status::text,health,coalesce(owner_id,''),start_date,target_date,coalesce(timeframe,''),created_at,updated_at from initiative where workspace_id=$1::uuid order by name`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type initiativeRecord struct {
		ID, Name, Status, Health, OwnerID, Timeframe string
		StartDate, TargetDate, CreatedAt, UpdatedAt *time.Time
	}
	records := []initiativeRecord{}
	for rows.Next() {
		var record initiativeRecord
		if err := rows.Scan(&record.ID, &record.Name, &record.Status, &record.Health, &record.OwnerID, &record.StartDate, &record.TargetDate, &record.Timeframe, &record.CreatedAt, &record.UpdatedAt); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	teamRows, err := w.DB.Query(ctx, `select it.initiative_id::text,t.id::text,t.key,coalesce(t.is_private,false) from initiative_team it join team t on t.id=it.team_id where t.workspace_id=$1::uuid`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer teamRows.Close()
	initiativeTeams := map[string][]sheetTeam{}
	for teamRows.Next() {
		var initiativeID string
		var team sheetTeam
		if err := teamRows.Scan(&initiativeID, &team.ID, &team.Key, &team.IsPrivate); err != nil {
			return nil, err
		}
		initiativeTeams[initiativeID] = append(initiativeTeams[initiativeID], team)
	}
	if err := teamRows.Err(); err != nil {
		return nil, err
	}
	projectRows, err := w.DB.Query(ctx, `select ip.initiative_id::text,ip.project_id::text from initiative_project ip join project p on p.id=ip.project_id where p.workspace_id=$1::uuid`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer projectRows.Close()
	initiativeProjects := map[string][]string{}
	for projectRows.Next() {
		var initiativeID, projectID string
		if err := projectRows.Scan(&initiativeID, &projectID); err != nil {
			return nil, err
		}
		if slug := projectSlug[projectID]; slug != "" {
			initiativeProjects[initiativeID] = append(initiativeProjects[initiativeID], slug)
		}
	}
	if err := projectRows.Err(); err != nil {
		return nil, err
	}
	out := [][]string{}
	for _, record := range records {
		links := initiativeTeams[record.ID]
		visible := settings.IncludePrivateTeams || len(links) == 0
		teamKeys := []string{}
		for _, link := range links {
			if settings.IncludePrivateTeams || visibleTeamByID[link.ID].ID != "" {
				visible = true
				teamKeys = append(teamKeys, link.Key)
			}
		}
		if !visible {
			continue
		}
		out = append(out, []string{record.ID, record.Name, record.Status, record.Health, strings.Join(sortedUnique(teamKeys), ", "), strings.Join(sortedUnique(initiativeProjects[record.ID]), ", "), record.OwnerID, formatSheetCell(record.StartDate), formatSheetCell(record.TargetDate), record.Timeframe, formatSheetCell(record.CreatedAt), formatSheetCell(record.UpdatedAt)})
	}
	return out, nil
}

func (w GoogleSheetsWorker) writeGoogleSpreadsheet(ctx context.Context, job googleSheetsJob, rows googleSheetsRows) (googleSheetsWriteResult, googleSheetsCredential, error) {
	credential, err := w.activeGoogleSheetsCredential(ctx, job.IntegrationID)
	if err != nil {
		return googleSheetsWriteResult{}, googleSheetsCredential{}, err
	}
	credential, err = w.refreshGoogleSheetsAccessTokenIfNeeded(ctx, credential)
	if err != nil {
		return googleSheetsWriteResult{}, googleSheetsCredential{}, err
	}
	metadata := job.Metadata
	spreadsheetID := metadata.SpreadsheetID
	spreadsheetURL := metadata.SpreadsheetURL
	spreadsheetTitle := metadata.SpreadsheetTitle
	if strings.TrimSpace(spreadsheetTitle) == "" {
		spreadsheetTitle = "Workspace analytics"
	}
	if !metadata.GoogleSpreadsheetCreated || spreadsheetID == "" {
		createdID, createdURL, err := w.createGoogleSpreadsheet(ctx, credential.AccessToken, spreadsheetTitle, enabledGoogleSheetsScopes(metadata.googleSheetsSettings))
		if err != nil {
			return googleSheetsWriteResult{}, credential, err
		}
		spreadsheetID = createdID
		spreadsheetURL = createdURL
	}
	if err := w.updateGoogleSpreadsheet(ctx, credential.AccessToken, spreadsheetID, metadata.googleSheetsSettings, rows); err != nil {
		return googleSheetsWriteResult{}, credential, err
	}
	return googleSheetsWriteResult{SpreadsheetID: spreadsheetID, SpreadsheetURL: spreadsheetURL, SpreadsheetTitle: spreadsheetTitle, RowCounts: map[string]int{"issues": len(rows["issues"]), "projects": len(rows["projects"]), "initiatives": len(rows["initiatives"])}}, credential, nil
}

func (w GoogleSheetsWorker) activeGoogleSheetsCredential(ctx context.Context, integrationID string) (googleSheetsCredential, error) {
	var payloadRaw []byte
	err := w.DB.QueryRow(ctx, `select encrypted_payload from provider_credential where workspace_integration_id=$1::uuid and provider='google_sheets' and active limit 1`, integrationID).Scan(&payloadRaw)
	if err != nil {
		return googleSheetsCredential{}, err
	}
	var credential googleSheetsCredential
	if err := json.Unmarshal(payloadRaw, &credential); err != nil {
		return googleSheetsCredential{}, err
	}
	if credential.AccessToken == "" && credential.RefreshToken == "" {
		return googleSheetsCredential{}, fmt.Errorf("active Google Sheets credential is missing tokens")
	}
	return credential, nil
}

func (w GoogleSheetsWorker) refreshGoogleSheetsAccessTokenIfNeeded(ctx context.Context, credential googleSheetsCredential) (googleSheetsCredential, error) {
	expiresAt, _ := time.Parse(time.RFC3339, credential.AccessTokenExpiresAt)
	if credential.AccessToken != "" && (expiresAt.IsZero() || time.Until(expiresAt) > time.Minute) {
		return credential, nil
	}
	if credential.RefreshToken == "" {
		if credential.AccessToken != "" {
			return credential, nil
		}
		return credential, fmt.Errorf("Google Sheets refresh token is missing")
	}
	clientID, clientSecret, ok := googleOAuthConfig()
	if !ok {
		return credential, fmt.Errorf("Google OAuth is not configured")
	}
	values := "client_id=" + url.QueryEscape(clientID) + "&client_secret=" + url.QueryEscape(clientSecret) + "&grant_type=refresh_token&refresh_token=" + url.QueryEscape(credential.RefreshToken)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, googleOAuthTokenURL(), strings.NewReader(values))
	if err != nil {
		return credential, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := w.httpClient().Do(req)
	if err != nil {
		return credential, err
	}
	defer resp.Body.Close()
	var token googleSheetsTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&token); err != nil {
		return credential, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 || token.AccessToken == "" {
		return credential, fmt.Errorf("Google access token refresh failed")
	}
	expiresIn := token.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	credential.AccessToken = token.AccessToken
	credential.AccessTokenExpiresAt = time.Now().UTC().Add(time.Duration(expiresIn) * time.Second).Format(time.RFC3339)
	if token.Scope != "" {
		credential.Scopes = splitOAuthScopes(token.Scope)
	}
	return credential, nil
}

func (w GoogleSheetsWorker) createGoogleSpreadsheet(ctx context.Context, accessToken, title string, scopes []string) (string, string, error) {
	sheets := []map[string]any{}
	for _, scope := range scopes {
		sheets = append(sheets, map[string]any{"properties": map[string]any{"title": googleSheetTitles[scope]}})
	}
	body := map[string]any{"properties": map[string]any{"title": title}, "sheets": sheets}
	var created struct {
		SpreadsheetID  string `json:"spreadsheetId"`
		SpreadsheetURL string `json:"spreadsheetUrl"`
	}
	if err := w.googleSheetsJSON(ctx, http.MethodPost, googleSheetsAPIBaseURL(), accessToken, body, &created); err != nil {
		return "", "", err
	}
	if created.SpreadsheetID == "" {
		return "", "", fmt.Errorf("Google Sheets API did not return a spreadsheet id")
	}
	if created.SpreadsheetURL == "" {
		created.SpreadsheetURL = "https://docs.google.com/spreadsheets/d/" + created.SpreadsheetID + "/edit"
	}
	return created.SpreadsheetID, created.SpreadsheetURL, nil
}

func (w GoogleSheetsWorker) updateGoogleSpreadsheet(ctx context.Context, accessToken, spreadsheetID string, settings googleSheetsSettings, rows googleSheetsRows) error {
	var spreadsheet struct {
		Sheets []struct {
			Properties struct {
				Title string `json:"title"`
			} `json:"properties"`
		} `json:"sheets"`
	}
	if err := w.googleSheetsJSON(ctx, http.MethodGet, googleSheetsAPIBaseURL()+"/"+urlPathEscape(spreadsheetID)+"?fields=sheets.properties.title", accessToken, nil, &spreadsheet); err != nil {
		return err
	}
	existing := map[string]bool{}
	for _, sheet := range spreadsheet.Sheets {
		existing[sheet.Properties.Title] = true
	}
	missing := []map[string]any{}
	for _, scope := range enabledGoogleSheetsScopes(settings) {
		title := googleSheetTitles[scope]
		if !existing[title] {
			missing = append(missing, map[string]any{"addSheet": map[string]any{"properties": map[string]any{"title": title}}})
		}
	}
	if len(missing) > 0 {
		if err := w.googleSheetsJSON(ctx, http.MethodPost, googleSheetsAPIBaseURL()+"/"+urlPathEscape(spreadsheetID)+":batchUpdate", accessToken, map[string]any{"requests": missing}, nil); err != nil {
			return err
		}
	}
	ranges := []string{}
	data := []map[string]any{}
	for _, scope := range enabledGoogleSheetsScopes(settings) {
		title := googleSheetTitles[scope]
		ranges = append(ranges, "'"+title+"'!A:ZZZ")
		data = append(data, map[string]any{"range": "'" + title + "'!A1", "majorDimension": "ROWS", "values": append([][]string{googleSheetSchemas[scope]}, rows[scope]...)})
	}
	if len(ranges) > 0 {
		if err := w.googleSheetsJSON(ctx, http.MethodPost, googleSheetsAPIBaseURL()+"/"+urlPathEscape(spreadsheetID)+"/values:batchClear", accessToken, map[string]any{"ranges": ranges}, nil); err != nil {
			return err
		}
	}
	return w.googleSheetsJSON(ctx, http.MethodPost, googleSheetsAPIBaseURL()+"/"+urlPathEscape(spreadsheetID)+"/values:batchUpdate", accessToken, map[string]any{"valueInputOption": "RAW", "data": data}, nil)
}

func (w GoogleSheetsWorker) googleSheetsJSON(ctx context.Context, method, endpoint, accessToken string, body any, target any) error {
	var payload []byte
	var err error
	if body != nil {
		payload, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := w.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("Google Sheets API request failed: %d %s", resp.StatusCode, readBody(resp))
	}
	if target != nil {
		return json.NewDecoder(resp.Body).Decode(target)
	}
	return nil
}

func (w GoogleSheetsWorker) succeedGoogleSheetsJob(ctx context.Context, job googleSheetsJob, rows googleSheetsRows, result googleSheetsWriteResult, credential googleSheetsCredential) error {
	now := time.Now().UTC()
	nextRunAt := now.Add(googleSheetsRefreshHour)
	metadata := job.Metadata
	metadata.SpreadsheetID = result.SpreadsheetID
	metadata.SpreadsheetURL = result.SpreadsheetURL
	metadata.SpreadsheetTitle = result.SpreadsheetTitle
	metadata.GoogleSpreadsheetCreated = true
	metadata.RowCounts = result.RowCounts
	metadata.SheetSchemas = googleSheetSchemas
	metadata.NextRunAt = nextRunAt.Format(time.RFC3339)
	metadataRaw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	credentialRaw, err := json.Marshal(credential)
	if err != nil {
		return err
	}
	tx, err := w.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `update provider_job set status='succeeded', completed_at=$2, last_error=null, updated_at=$2 where id=$1::uuid`, job.ID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_credential set encrypted_payload=$2, updated_at=$3 where workspace_integration_id=$1::uuid and provider='google_sheets' and active`, job.IntegrationID, credentialRaw, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update workspace_integration set status='connected', external_id=$2, display_name=$3, metadata=$4::jsonb, last_success_at=$5, last_event_at=$5, last_failure_at=null, last_failure_message=null, token_expires_at=$6::timestamp, updated_at=$5 where id=$1::uuid`, job.IntegrationID, result.SpreadsheetID, result.SpreadsheetTitle, metadataRaw, now, credential.AccessTokenExpiresAt); err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]any{"rowCounts": result.RowCounts, "spreadsheetId": result.SpreadsheetID})
	if _, err := tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid, $2::uuid, 'google_sheets', $3::uuid, 'sync_succeeded', 'info', 'Google Sheets analytics sync completed.', $4::jsonb, $5)`, job.WorkspaceID, job.IntegrationID, job.ID, payload, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update provider_job set status='canceled', completed_at=$2, updated_at=$2 where workspace_integration_id=$1::uuid and provider='google_sheets' and kind='sync' and status in ('queued','failed') and id<>$3::uuid`, job.IntegrationID, now, job.ID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, next_run_at, updated_at) values ($1::uuid, $2::uuid, 'google_sheets', 'sync', 'queued', '{}'::jsonb, $3, $3, $4)`, job.WorkspaceID, job.IntegrationID, nextRunAt, now); err != nil {
		return err
	}
	_ = rows
	return tx.Commit(ctx)
}

func (w GoogleSheetsWorker) failGoogleSheetsJob(ctx context.Context, job googleSheetsJob, cause error) error {
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
	if _, err := tx.Exec(ctx, `update workspace_integration set status='degraded', last_failure_at=$2, last_failure_message=$3, last_event_at=$2, updated_at=$2 where id=$1::uuid`, job.IntegrationID, now, cause.Error()); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `insert into provider_event (workspace_id, workspace_integration_id, provider, job_id, event_type, severity, message, payload, created_at) values ($1::uuid, $2::uuid, 'google_sheets', $3::uuid, 'sync_failed', 'error', $4, '{}'::jsonb, $5)`, job.WorkspaceID, job.IntegrationID, job.ID, cause.Error(), now)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w GoogleSheetsWorker) httpClient() *http.Client {
	if w.Client != nil {
		return w.Client
	}
	return http.DefaultClient
}

func enabledGoogleSheetsScopes(settings googleSheetsSettings) []string {
	out := []string{}
	for _, scope := range []string{"issues", "projects", "initiatives"} {
		if settings.Scopes[scope] {
			out = append(out, scope)
		}
	}
	return out
}
