package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/figma"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	"github.com/namuh-eng/exponential/apps/api/internal/sanitizehtml"
	syncapi "github.com/namuh-eng/exponential/apps/api/internal/sync"
)

type figmaPluginTeam struct {
	ID   string `json:"id"`
	Key  string `json:"key"`
	Name string `json:"name"`
}

type figmaPluginStatus struct {
	ID        string `json:"id"`
	TeamID    string `json:"teamId"`
	Name      string `json:"name"`
	Category  string `json:"category"`
	Color     string `json:"color"`
	IsDefault *bool  `json:"isDefault"`
}

type figmaPluginProject struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Icon *string `json:"icon"`
}

type figmaPluginMetadataResponse struct {
	Teams    []figmaPluginTeam    `json:"teams"`
	Statuses []figmaPluginStatus  `json:"statuses"`
	Projects []figmaPluginProject `json:"projects"`
}

type figmaPluginSourceInput struct {
	URL          string         `json:"url"`
	Name         *string        `json:"name"`
	ThumbnailURL *string        `json:"thumbnailUrl"`
	Selection    map[string]any `json:"selection"`
}

type figmaPluginIssueRequest struct {
	Title       string                 `json:"title"`
	Description *string                `json:"description"`
	TeamID      string                 `json:"teamId"`
	TeamKey     string                 `json:"teamKey"`
	StatusID    *string                `json:"statusId"`
	ProjectID   *string                `json:"projectId"`
	Priority    *string                `json:"priority"`
	Source      figmaPluginSourceInput `json:"source"`
}

type figmaPluginLinkRequest struct {
	IssueID    string                 `json:"issueId"`
	Identifier string                 `json:"identifier"`
	SourceID   string                 `json:"sourceId"`
	Source     figmaPluginSourceInput `json:"source"`
}

type figmaPluginIssueSummary struct {
	ID         string  `json:"id"`
	Identifier string  `json:"identifier"`
	Title      string  `json:"title"`
	TeamID     string  `json:"teamId"`
	TeamKey    string  `json:"teamKey"`
	StateID    string  `json:"stateId"`
	Priority   string  `json:"priority"`
	ProjectID  *string `json:"projectId"`
	Path       string  `json:"path"`
}

type figmaPluginIssueResponse struct {
	Issue  figmaPluginIssueSummary `json:"issue"`
	Source figma.Source            `json:"source"`
}

type normalizedFigmaPluginSource struct {
	Link         figma.Link
	Name         *string
	ThumbnailURL *string
	Snapshot     map[string]any
}

func (h Handler) FigmaPluginMetadata(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	teams, err := h.figmaPluginTeams(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load Figma plugin metadata failed", err.Error())
		return
	}
	statuses, err := h.figmaPluginStatuses(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load Figma plugin metadata failed", err.Error())
		return
	}
	projects, err := h.figmaPluginProjects(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Load Figma plugin metadata failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, figmaPluginMetadataResponse{Teams: teams, Statuses: statuses, Projects: projects})
}

func (h Handler) FigmaPluginCreateIssue(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input figmaPluginIssueRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" {
		problem.Write(w, http.StatusBadRequest, "Invalid issue", "title is required")
		return
	}
	source, err := normalizeFigmaPluginSource(input.Source)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid Figma source", err.Error())
		return
	}
	priority := "none"
	if input.Priority != nil && strings.TrimSpace(*input.Priority) != "" {
		priority = strings.TrimSpace(*input.Priority)
	}
	if !validFigmaPluginPriority(priority) {
		problem.Write(w, http.StatusBadRequest, "Invalid priority", "priority must be one of none, urgent, high, medium, or low")
		return
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Figma issue failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	team, err := h.figmaPluginTeamForCreate(r.Context(), tx, p.WorkspaceID, input.TeamID, input.TeamKey)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Figma issue failed", err.Error())
		return
	}
	stateID := valueFromPointer(input.StatusID)
	if stateID == "" {
		stateID, err = h.defaultFigmaPluginState(r.Context(), tx, team.ID)
	} else {
		err = h.assertFigmaPluginState(r.Context(), tx, team.ID, stateID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Workflow status not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Figma issue failed", err.Error())
		return
	}
	projectID := valueFromPointer(input.ProjectID)
	if projectID != "" {
		if err := h.assertFigmaPluginProject(r.Context(), tx, p.WorkspaceID, projectID); errors.Is(err, pgx.ErrNoRows) {
			problem.Write(w, http.StatusNotFound, "Project not found", "")
			return
		} else if err != nil {
			problem.Write(w, http.StatusInternalServerError, "Create Figma issue failed", err.Error())
			return
		}
	}
	issue, err := h.insertFigmaPluginIssue(r.Context(), tx, p.WorkspaceID, p.UserID, team, stateID, projectID, priority, input, source)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Figma issue failed", err.Error())
		return
	}
	storedSource, err := h.upsertFigmaPluginSource(r.Context(), tx, p.WorkspaceID, issue.ID, source)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Figma issue failed", err.Error())
		return
	}
	if _, err := syncapi.InsertOperation(r.Context(), tx, p.WorkspaceID, "issue", issue.ID, "created", issue, p.UserID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Figma issue failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create Figma issue failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusCreated, figmaPluginIssueResponse{Issue: issue, Source: storedSource})
}

func (h Handler) FigmaPluginLinkIssue(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input figmaPluginLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	source, err := normalizeFigmaPluginSource(input.Source)
	if err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid Figma source", err.Error())
		return
	}
	issue, err := h.findFigmaPluginIssue(r.Context(), p.WorkspaceID, input.IssueID, input.Identifier)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Figma source failed", err.Error())
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Figma source failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	storedSource, err := h.upsertFigmaPluginSource(r.Context(), tx, p.WorkspaceID, issue.ID, source)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Figma source failed", err.Error())
		return
	}
	if _, err := syncapi.InsertOperation(r.Context(), tx, p.WorkspaceID, "issue", issue.ID, "updated", map[string]any{"figmaSourceLinked": storedSource}, p.UserID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Figma source failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Link Figma source failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, figmaPluginIssueResponse{Issue: issue, Source: storedSource})
}

func (h Handler) FigmaPluginUnlinkIssue(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input figmaPluginLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}
	issue, err := h.findFigmaPluginIssue(r.Context(), p.WorkspaceID, input.IssueID, input.Identifier)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, http.StatusNotFound, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Unlink Figma source failed", err.Error())
		return
	}
	if strings.TrimSpace(input.SourceID) == "" && strings.TrimSpace(input.Source.URL) == "" {
		problem.Write(w, http.StatusBadRequest, "Invalid Figma source", "sourceId or source.url is required")
		return
	}
	var normalizedURL string
	if strings.TrimSpace(input.Source.URL) != "" {
		source, err := normalizeFigmaPluginSource(input.Source)
		if err != nil {
			problem.Write(w, http.StatusBadRequest, "Invalid Figma source", err.Error())
			return
		}
		normalizedURL = source.Link.NormalizedURL
	}
	result, err := h.DB.Exec(r.Context(), `
		delete from figma_source
		where workspace_id=$1::uuid and issue_id=$2::uuid and container_type='plugin'
			and (($3 <> '' and id=$3::uuid) or ($4 <> '' and normalized_url=$4))`, p.WorkspaceID, issue.ID, strings.TrimSpace(input.SourceID), normalizedURL)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Unlink Figma source failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]any{"success": true, "unlinked": result.RowsAffected() > 0})
}

func (h Handler) figmaPluginTeams(ctx context.Context, workspaceID string) ([]figmaPluginTeam, error) {
	rows, err := h.DB.Query(ctx, `select id::text,key,name from team where workspace_id=$1::uuid and deleted_at is null and retired_at is null order by key asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	teams := []figmaPluginTeam{}
	for rows.Next() {
		var team figmaPluginTeam
		if err := rows.Scan(&team.ID, &team.Key, &team.Name); err != nil {
			return nil, err
		}
		teams = append(teams, team)
	}
	return teams, rows.Err()
}

func (h Handler) figmaPluginStatuses(ctx context.Context, workspaceID string) ([]figmaPluginStatus, error) {
	rows, err := h.DB.Query(ctx, `
		select ws.id::text, ws.team_id::text, ws.name, ws.category::text, ws.color, ws.is_default
		from workflow_state ws
		join team t on t.id=ws.team_id
		where t.workspace_id=$1::uuid and t.deleted_at is null and t.retired_at is null
		order by t.key asc, ws.position asc, ws.name asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	statuses := []figmaPluginStatus{}
	for rows.Next() {
		var status figmaPluginStatus
		if err := rows.Scan(&status.ID, &status.TeamID, &status.Name, &status.Category, &status.Color, &status.IsDefault); err != nil {
			return nil, err
		}
		statuses = append(statuses, status)
	}
	return statuses, rows.Err()
}

func (h Handler) figmaPluginProjects(ctx context.Context, workspaceID string) ([]figmaPluginProject, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,icon from project where workspace_id=$1::uuid order by name asc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := []figmaPluginProject{}
	for rows.Next() {
		var project figmaPluginProject
		if err := rows.Scan(&project.ID, &project.Name, &project.Icon); err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (h Handler) figmaPluginTeamForCreate(ctx context.Context, q interface{ QueryRow(context.Context, string, ...any) pgx.Row }, workspaceID, teamID, teamKey string) (figmaPluginTeam, error) {
	var team figmaPluginTeam
	teamID = strings.TrimSpace(teamID)
	teamKey = strings.TrimSpace(teamKey)
	if teamID != "" {
		err := q.QueryRow(ctx, `select id::text,key,name from team where id=$1::uuid and workspace_id=$2::uuid and deleted_at is null and retired_at is null`, teamID, workspaceID).Scan(&team.ID, &team.Key, &team.Name)
		return team, err
	}
	return team, q.QueryRow(ctx, `select id::text,key,name from team where key=$1 and workspace_id=$2::uuid and deleted_at is null and retired_at is null`, teamKey, workspaceID).Scan(&team.ID, &team.Key, &team.Name)
}

func (h Handler) defaultFigmaPluginState(ctx context.Context, q interface{ QueryRow(context.Context, string, ...any) pgx.Row }, teamID string) (string, error) {
	var stateID string
	err := q.QueryRow(ctx, `select id::text from workflow_state where team_id=$1::uuid and category='backlog' order by coalesce(is_default,false) desc, position asc, name asc, id asc limit 1`, teamID).Scan(&stateID)
	return stateID, err
}

func (h Handler) assertFigmaPluginState(ctx context.Context, q interface{ QueryRow(context.Context, string, ...any) pgx.Row }, teamID, stateID string) error {
	var id string
	return q.QueryRow(ctx, `select id::text from workflow_state where id=$1::uuid and team_id=$2::uuid`, stateID, teamID).Scan(&id)
}

func (h Handler) assertFigmaPluginProject(ctx context.Context, q interface{ QueryRow(context.Context, string, ...any) pgx.Row }, workspaceID, projectID string) error {
	var id string
	return q.QueryRow(ctx, `select id::text from project where id=$1::uuid and workspace_id=$2::uuid`, projectID, workspaceID).Scan(&id)
}

func (h Handler) insertFigmaPluginIssue(ctx context.Context, tx pgx.Tx, workspaceID, userID string, team figmaPluginTeam, stateID string, projectID string, priority string, input figmaPluginIssueRequest, source normalizedFigmaPluginSource) (figmaPluginIssueSummary, error) {
	var nextNumber int32
	if err := tx.QueryRow(ctx, `select coalesce(max(number),0)+1 from issue where team_id=$1::uuid`, team.ID).Scan(&nextNumber); err != nil {
		return figmaPluginIssueSummary{}, err
	}
	identifier := fmt.Sprintf("%s-%d", team.Key, nextNumber)
	description := figmaPluginIssueDescription(input.Description, source.Link.NormalizedURL)
	var issue figmaPluginIssueSummary
	var storedProjectID *string
	if projectID == "" {
		storedProjectID = nil
	} else {
		storedProjectID = &projectID
	}
	err := tx.QueryRow(ctx, `
		insert into issue (number,identifier,title,description,team_id,state_id,creator_id,priority,project_id)
		values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,$8,$9::uuid)
		returning id::text, identifier, title, team_id::text, state_id::text, priority::text, project_id::text`, nextNumber, identifier, input.Title, description, team.ID, stateID, userID, priority, storedProjectID).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamID, &issue.StateID, &issue.Priority, &issue.ProjectID)
	if err != nil {
		return figmaPluginIssueSummary{}, err
	}
	issue.TeamKey = team.Key
	issue.Path = "/team/" + url.PathEscape(team.Key) + "/issue/" + url.PathEscape(identifier)
	return issue, nil
}

func (h Handler) findFigmaPluginIssue(ctx context.Context, workspaceID, issueID, identifier string) (figmaPluginIssueSummary, error) {
	issueID = strings.TrimSpace(issueID)
	identifier = strings.TrimSpace(identifier)
	where := "i.identifier=$2"
	arg := identifier
	if issueID != "" {
		where = "i.id=$2::uuid"
		arg = issueID
	}
	var issue figmaPluginIssueSummary
	err := h.DB.QueryRow(ctx, `
		select i.id::text, i.identifier, i.title, i.team_id::text, t.key, i.state_id::text, i.priority::text, i.project_id::text
		from issue i join team t on t.id=i.team_id
		where t.workspace_id=$1::uuid and `+where+` and i.archived_at is null
		limit 1`, workspaceID, arg).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamID, &issue.TeamKey, &issue.StateID, &issue.Priority, &issue.ProjectID)
	if err != nil {
		return figmaPluginIssueSummary{}, err
	}
	issue.Path = "/team/" + url.PathEscape(issue.TeamKey) + "/issue/" + url.PathEscape(issue.Identifier)
	return issue, nil
}

func (h Handler) upsertFigmaPluginSource(ctx context.Context, tx pgx.Tx, workspaceID, issueID string, source normalizedFigmaPluginSource) (figma.Source, error) {
	snapshotRaw, err := json.Marshal(source.Snapshot)
	if err != nil {
		return figma.Source{}, err
	}
	storedSource, err := figma.ScanSource(tx.QueryRow(ctx, `
		insert into figma_source (workspace_id, issue_id, container_type, source_url, normalized_url, file_key, node_id, kind, name, thumbnail_url, snapshot, captured_at, refreshed_at, updated_at)
		values ($1::uuid,$2::uuid,'plugin',$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now(),now(),now())
		on conflict (workspace_id, issue_id, container_type, (coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(document_id, '')), normalized_url)
		do update set source_url=excluded.source_url, file_key=excluded.file_key, node_id=excluded.node_id, kind=excluded.kind, name=coalesce(excluded.name, figma_source.name), thumbnail_url=coalesce(excluded.thumbnail_url, figma_source.thumbnail_url), snapshot=figma_source.snapshot || excluded.snapshot, refreshed_at=now(), last_error=null, updated_at=now()
		returning `+figma.SourceColumns("figma_source."), workspaceID, issueID, source.Link.URL, source.Link.NormalizedURL, source.Link.FileKey, nullString(source.Link.NodeID), source.Link.Kind, source.Name, source.ThumbnailURL, snapshotRaw))
	if err != nil {
		return figma.Source{}, err
	}
	payload := map[string]any{"sourceId": storedSource.ID, "issueId": issueID, "normalizedUrl": source.Link.NormalizedURL, "fileKey": source.Link.FileKey, "nodeId": source.Link.NodeID}
	if err := h.enqueueFigmaMetadataRefresh(ctx, tx, workspaceID, payload); err != nil {
		return figma.Source{}, err
	}
	return storedSource, nil
}

func (h Handler) enqueueFigmaMetadataRefresh(ctx context.Context, tx pgx.Tx, workspaceID string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		insert into provider_job (workspace_id, workspace_integration_id, provider, kind, status, payload, scheduled_at, updated_at)
		values ($1::uuid, (select id from workspace_integration where workspace_id=$1::uuid and provider='figma' and status in ('connected','degraded') limit 1), 'figma', 'metadata_refresh', 'queued', $2::jsonb, now(), now())`, workspaceID, raw)
	return err
}

func normalizeFigmaPluginSource(input figmaPluginSourceInput) (normalizedFigmaPluginSource, error) {
	link, ok := figma.ParseLink(input.URL)
	if !ok {
		return normalizedFigmaPluginSource{}, fmt.Errorf("source.url must be a supported figma.com/file, figma.com/design, or figma.com/proto URL")
	}
	name := cleanOptionalText(input.Name, 255)
	thumbnailURL, err := cleanOptionalHTTPURL(input.ThumbnailURL)
	if err != nil {
		return normalizedFigmaPluginSource{}, err
	}
	snapshot := map[string]any{"capturedBy": "figma_plugin", "originalUrl": link.URL}
	if len(input.Selection) > 0 {
		snapshot["selection"] = input.Selection
	}
	return normalizedFigmaPluginSource{Link: link, Name: name, ThumbnailURL: thumbnailURL, Snapshot: snapshot}, nil
}

func figmaPluginIssueDescription(description *string, normalizedURL string) *string {
	body := ""
	if description != nil {
		body = strings.TrimSpace(*description)
	}
	if body == "" {
		body = `<p>Created from Figma: <a href="` + normalizedURL + `">` + normalizedURL + `</a></p>`
	}
	sanitized := sanitizehtml.RichText(body)
	return &sanitized
}

func validFigmaPluginPriority(value string) bool {
	switch value {
	case "none", "urgent", "high", "medium", "low":
		return true
	default:
		return false
	}
}

func cleanOptionalText(value *string, maxLen int) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	if len(cleaned) > maxLen {
		cleaned = cleaned[:maxLen]
	}
	return &cleaned
}

func cleanOptionalHTTPURL(value *string) (*string, error) {
	cleaned := cleanOptionalText(value, 2048)
	if cleaned == nil {
		return nil, nil
	}
	parsed, err := url.Parse(*cleaned)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, fmt.Errorf("thumbnailUrl must be an http or https URL")
	}
	return cleaned, nil
}

func valueFromPointer(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
