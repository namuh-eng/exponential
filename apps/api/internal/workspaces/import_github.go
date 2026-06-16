package workspaces

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type githubSnapshot struct {
	Provider     string                `json:"provider"`
	Scope        string                `json:"scope"`
	Repositories []githubSnapshotRepo  `json:"repositories"`
	Issues       []githubSnapshotIssue `json:"issues"`
	FetchedAt    string                `json:"fetchedAt"`
	Totals       map[string]int        `json:"totals"`
}

type githubSnapshotRepo struct {
	FullName string `json:"fullName"`
	HTMLURL  string `json:"htmlUrl"`
}

type githubSnapshotIssue struct {
	ExternalID string                   `json:"externalId"`
	Repository string                   `json:"repository"`
	Number     int                      `json:"number"`
	Title      string                   `json:"title"`
	Body       string                   `json:"body"`
	State      string                   `json:"state"`
	HTMLURL    string                   `json:"htmlUrl"`
	Author     githubSnapshotUser       `json:"author"`
	Assignees  []githubSnapshotUser     `json:"assignees"`
	Labels     []githubSnapshotLabel    `json:"labels"`
	Milestone  *githubSnapshotMilestone `json:"milestone,omitempty"`
	Comments   []githubSnapshotComment  `json:"comments"`
	CreatedAt  string                   `json:"createdAt"`
	UpdatedAt  string                   `json:"updatedAt"`
}

type githubSnapshotUser struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatarUrl"`
	HTMLURL   string `json:"htmlUrl"`
}

type githubSnapshotLabel struct {
	Name        string `json:"name"`
	Color       string `json:"color"`
	Description string `json:"description"`
}

type githubSnapshotMilestone struct {
	Title string `json:"title"`
	State string `json:"state"`
}

type githubSnapshotComment struct {
	ExternalID string             `json:"externalId"`
	Body       string             `json:"body"`
	HTMLURL    string             `json:"htmlUrl"`
	Author     githubSnapshotUser `json:"author"`
	CreatedAt  string             `json:"createdAt"`
}

type githubAPIClient struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

type githubAPIUser struct {
	Login     string `json:"login"`
	AvatarURL string `json:"avatar_url"`
	HTMLURL   string `json:"html_url"`
}

type githubAPILabel struct {
	Name        string `json:"name"`
	Color       string `json:"color"`
	Description string `json:"description"`
}

type githubAPIMilestone struct {
	Title string `json:"title"`
	State string `json:"state"`
}

type githubAPIIssue struct {
	ID          int64               `json:"id"`
	Number      int                 `json:"number"`
	Title       string              `json:"title"`
	Body        string              `json:"body"`
	State       string              `json:"state"`
	HTMLURL     string              `json:"html_url"`
	User        githubAPIUser       `json:"user"`
	Assignees   []githubAPIUser     `json:"assignees"`
	Labels      []githubAPILabel    `json:"labels"`
	Milestone   *githubAPIMilestone `json:"milestone"`
	PullRequest *struct{}           `json:"pull_request"`
	CreatedAt   string              `json:"created_at"`
	UpdatedAt   string              `json:"updated_at"`
}

type githubAPIComment struct {
	ID        int64         `json:"id"`
	Body      string        `json:"body"`
	HTMLURL   string        `json:"html_url"`
	User      githubAPIUser `json:"user"`
	CreatedAt string        `json:"created_at"`
}

type githubImportMapping struct {
	DefaultTeamID string            `json:"defaultTeamId"`
	RepoTeams     map[string]string `json:"repoTeams"`
	Statuses      map[string]string `json:"statuses"`
	Users         map[string]string `json:"users"`
	Labels        map[string]string `json:"labels"`
}

func (h Handler) handleGitHubProviderSnapshot(w http.ResponseWriter, r *http.Request, current importExportWorkspace, p auth.Principal, body map[string]any) {
	if asStringValue(body["provider"]) != "github" {
		problem.Write(w, 400, "Unsupported provider", "")
		return
	}
	token := strings.TrimSpace(asStringValue(body["token"]))
	repos := stringSlice(body["repositories"])
	if len(repos) == 0 {
		repos = splitProviderList(asStringValue(body["repositoriesText"]))
	}
	if len(repos) == 0 {
		problem.Write(w, 400, "Choose at least one GitHub repository", "")
		return
	}
	scope := normalizeGitHubImportScope(asStringValue(body["scope"]))
	jobID := asStringValue(body["jobId"])
	message := "Fetching GitHub issues for guided review."
	job, err := h.ensureProviderImportJob(r.Context(), current.ID, jobID, "github", "fetching", message, map[string]any{"scope": scope, "repositories": repos}, &p.UserID)
	if err != nil {
		problem.Write(w, 500, "Prepare GitHub import failed", err.Error())
		return
	}
	client := githubAPIClient{BaseURL: stringOr(body["apiBaseUrl"], "https://api.github.com"), Token: token, HTTP: http.DefaultClient}
	snapshot, err := client.fetchSnapshot(r.Context(), repos, scope)
	if err != nil {
		_ = h.markProviderImportFailed(r.Context(), current.ID, asStringValue(job["id"]), err)
		problem.Write(w, 502, "Fetch GitHub issues failed", err.Error())
		return
	}
	job, err = h.storeProviderSnapshot(r.Context(), current.ID, asStringValue(job["id"]), snapshot)
	if err != nil {
		problem.Write(w, 500, "Save GitHub import snapshot failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"import": job, "snapshot": snapshot})
}

func (h Handler) handleGitHubProviderConfirm(w http.ResponseWriter, r *http.Request, current importExportWorkspace, p auth.Principal, body map[string]any) {
	jobID := asStringValue(body["jobId"])
	if jobID == "" {
		problem.Write(w, 400, "Import job is required", "")
		return
	}
	snapshot, err := h.providerSnapshot(r.Context(), current.ID, jobID)
	if err != nil {
		problem.Write(w, 404, "GitHub import snapshot not found", err.Error())
		return
	}
	mapping := readGitHubImportMapping(recordFromAny(body["mapping"]))
	if mapping.DefaultTeamID == "" {
		mapping.DefaultTeamID = stringOr(body["defaultTeamId"], "")
	}
	includeClosed := snapshot.Scope == "all" || boolFromAny(body["includeClosed"], false)
	result, err := h.importGitHubSnapshot(r.Context(), p, current.ID, jobID, snapshot, mapping, includeClosed)
	if err != nil {
		_ = h.markProviderImportFailed(r.Context(), current.ID, jobID, err)
		problem.Write(w, 500, "GitHub import failed", err.Error())
		return
	}
	job, err := h.finishProviderImportJob(r.Context(), current.ID, jobID, result)
	if err != nil {
		problem.Write(w, 500, "Save GitHub import result failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"import": job, "summary": result})
}

func (h Handler) handleProviderImportCancel(w http.ResponseWriter, r *http.Request, current importExportWorkspace, body map[string]any) {
	jobID := asStringValue(body["jobId"])
	if jobID == "" {
		problem.Write(w, 400, "Import job is required", "")
		return
	}
	job, err := h.updateProviderImportStatus(r.Context(), current.ID, jobID, "canceled", "Provider import canceled before confirmation.", map[string]any{"canceled": 1}, nil)
	if err != nil {
		problem.Write(w, 500, "Cancel provider import failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"import": job})
}

func (h Handler) providerImportJobs(ctx context.Context, workspaceID string) ([]map[string]any, error) {
	rows, err := h.DB.Query(ctx, `select id, provider, status, created_at, completed_at, message, coalesce(summary,'{}'::jsonb) from import_job where workspace_id=$1::uuid order by created_at desc limit 25`, workspaceID)
	if err != nil {
		if strings.Contains(err.Error(), "import_job") {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	jobs := []map[string]any{}
	for rows.Next() {
		var id, providerName, status, message string
		var createdAt time.Time
		var completedAt sql.NullTime
		var summaryRaw []byte
		if err := rows.Scan(&id, &providerName, &status, &createdAt, &completedAt, &message, &summaryRaw); err != nil {
			return nil, err
		}
		job := providerImportJobMap(id, providerName, status, createdAt, completedAt, message, mapFromJSON(summaryRaw))
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func (h Handler) createProviderImportJob(ctx context.Context, workspaceID string, providerName string, status string, message string, summary map[string]any, userID *string) (map[string]any, error) {
	return h.ensureProviderImportJob(ctx, workspaceID, "", providerName, status, message, summary, userID)
}

func (h Handler) ensureProviderImportJob(ctx context.Context, workspaceID string, jobID string, providerName string, status string, message string, summary map[string]any, userID *string) (map[string]any, error) {
	if jobID == "" {
		jobID = importExportJobID("import")
	}
	summaryRaw, _ := json.Marshal(summary)
	var completedAt sql.NullTime
	var createdAt time.Time
	if userID == nil {
		_, err := h.DB.Exec(ctx, `insert into import_job (id, workspace_id, provider, status, message, summary, updated_at) values ($1,$2::uuid,$3,$4,$5,$6::jsonb,now()) on conflict (id) do update set status=excluded.status, message=excluded.message, summary=excluded.summary, updated_at=now()`, jobID, workspaceID, providerName, status, message, summaryRaw)
		if err != nil {
			return nil, err
		}
	} else {
		_, err := h.DB.Exec(ctx, `insert into import_job (id, workspace_id, provider, status, created_by_user_id, message, summary, updated_at) values ($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,now()) on conflict (id) do update set status=excluded.status, message=excluded.message, summary=excluded.summary, updated_at=now()`, jobID, workspaceID, providerName, status, *userID, message, summaryRaw)
		if err != nil {
			return nil, err
		}
	}
	if err := h.DB.QueryRow(ctx, `select created_at, completed_at from import_job where id=$1 and workspace_id=$2::uuid`, jobID, workspaceID).Scan(&createdAt, &completedAt); err != nil {
		return nil, err
	}
	return providerImportJobMap(jobID, providerName, status, createdAt, completedAt, message, summary), nil
}

func (h Handler) storeProviderSnapshot(ctx context.Context, workspaceID string, jobID string, snapshot githubSnapshot) (map[string]any, error) {
	raw, _ := json.Marshal(snapshot)
	summary := map[string]any{"repositories": len(snapshot.Repositories), "issues": snapshot.Totals["issues"], "comments": snapshot.Totals["comments"], "scope": snapshot.Scope}
	message := "GitHub review snapshot fetched with " + strconv.Itoa(snapshot.Totals["issues"]) + " issues. Review mappings before importing."
	var job map[string]any
	err := pgx.BeginFunc(ctx, h.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `insert into import_source (job_id, workspace_id, provider, source_type, external_id, payload, updated_at) values ($1,$2::uuid,'github','github_snapshot',$3,$4::jsonb,now()) on conflict (job_id, source_type, external_id) do update set payload=excluded.payload, updated_at=now()`, jobID, workspaceID, strings.Join(repoNames(snapshot.Repositories), ","), raw); err != nil {
			return err
		}
		summaryRaw, _ := json.Marshal(summary)
		if _, err := tx.Exec(ctx, `update import_job set status='review', message=$3, summary=$4::jsonb, updated_at=now() where id=$1 and workspace_id=$2::uuid`, jobID, workspaceID, message, summaryRaw); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	job = providerImportJobMap(jobID, "github", "review", time.Now().UTC(), sql.NullTime{}, message, summary)
	if row, err := h.providerImportJob(ctx, workspaceID, jobID); err == nil {
		job = row
	}
	return job, nil
}

func (h Handler) providerImportJob(ctx context.Context, workspaceID string, jobID string) (map[string]any, error) {
	var id, providerName, status, message string
	var createdAt time.Time
	var completedAt sql.NullTime
	var summaryRaw []byte
	err := h.DB.QueryRow(ctx, `select id, provider, status, created_at, completed_at, message, coalesce(summary,'{}'::jsonb) from import_job where id=$1 and workspace_id=$2::uuid`, jobID, workspaceID).Scan(&id, &providerName, &status, &createdAt, &completedAt, &message, &summaryRaw)
	if err != nil {
		return nil, err
	}
	return providerImportJobMap(id, providerName, status, createdAt, completedAt, message, mapFromJSON(summaryRaw)), nil
}

func (h Handler) providerSnapshot(ctx context.Context, workspaceID string, jobID string) (githubSnapshot, error) {
	var raw []byte
	err := h.DB.QueryRow(ctx, `select payload from import_source where workspace_id=$1::uuid and job_id=$2 and provider='github' and source_type='github_snapshot' order by updated_at desc limit 1`, workspaceID, jobID).Scan(&raw)
	if err != nil {
		return githubSnapshot{}, err
	}
	var snapshot githubSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return githubSnapshot{}, err
	}
	return snapshot, nil
}

func (h Handler) updateProviderImportStatus(ctx context.Context, workspaceID string, jobID string, status string, message string, summary map[string]any, completedAt *time.Time) (map[string]any, error) {
	summaryRaw, _ := json.Marshal(summary)
	_, err := h.DB.Exec(ctx, `update import_job set status=$3, message=$4, summary=coalesce(summary,'{}'::jsonb) || $5::jsonb, completed_at=coalesce($6, completed_at), updated_at=now() where id=$1 and workspace_id=$2::uuid`, jobID, workspaceID, status, message, summaryRaw, completedAt)
	if err != nil {
		return nil, err
	}
	return h.providerImportJob(ctx, workspaceID, jobID)
}

func (h Handler) markProviderImportFailed(ctx context.Context, workspaceID string, jobID string, cause error) error {
	_, err := h.updateProviderImportStatus(ctx, workspaceID, jobID, "failed", "GitHub import failed: "+cause.Error(), map[string]any{"errors": []string{cause.Error()}}, ptrTime(time.Now().UTC()))
	return err
}

func (h Handler) finishProviderImportJob(ctx context.Context, workspaceID string, jobID string, summary map[string]any) (map[string]any, error) {
	created := intFromAny(summary["created"])
	skipped := intFromAny(summary["skipped"])
	failed := intFromAny(summary["failed"])
	message := "GitHub import completed with " + strconv.Itoa(created) + " created, " + strconv.Itoa(skipped) + " skipped, and " + strconv.Itoa(failed) + " failed."
	return h.updateProviderImportStatus(ctx, workspaceID, jobID, "completed", message, summary, ptrTime(time.Now().UTC()))
}

func providerImportJobMap(id string, providerName string, status string, createdAt time.Time, completedAt sql.NullTime, message string, summary map[string]any) map[string]any {
	job := map[string]any{"id": id, "type": "import", "provider": providerName, "status": status, "createdAt": createdAt.UTC().Format(time.RFC3339Nano), "message": message}
	if completedAt.Valid {
		job["completedAt"] = completedAt.Time.UTC().Format(time.RFC3339Nano)
	}
	if issues := intFromAny(summary["issues"]); issues > 0 {
		job["rowCount"] = issues
	}
	if created := intFromAny(summary["created"]); created > 0 {
		job["importedCount"] = created
	}
	if failed := intFromAny(summary["failed"]); failed > 0 {
		job["errorCount"] = failed
	}
	job["summary"] = summary
	return job
}

func (h Handler) importGitHubSnapshot(ctx context.Context, p auth.Principal, workspaceID string, jobID string, snapshot githubSnapshot, mapping githubImportMapping, includeClosed bool) (map[string]any, error) {
	teams, err := h.importTeams(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	if len(teams) == 0 {
		return nil, errors.New("create a team before importing GitHub issues")
	}
	states, err := h.importStatesForTeams(ctx, teamIDs(teams))
	if err != nil {
		return nil, err
	}
	teamByID := map[string]importTeamRow{}
	for _, team := range teams {
		teamByID[team.ID] = team
	}
	fallback := teams[0]
	if team, ok := teamByID[mapping.DefaultTeamID]; ok {
		fallback = team
	}
	maxNumbers := map[string]int{}
	for _, team := range teams {
		var max int
		if err := h.DB.QueryRow(ctx, `select coalesce(max(number),0)::int from issue where team_id=$1::uuid`, team.ID).Scan(&max); err != nil {
			return nil, err
		}
		maxNumbers[team.ID] = max
	}
	actorName, actorEmail := h.userNameEmail(ctx, p.UserID)
	summary := map[string]any{"created": 0, "skipped": 0, "failed": 0, "errors": []string{}, "comments": 0, "labels": 0}
	err = pgx.BeginFunc(ctx, h.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update import_job set status='importing', message='Importing GitHub issues.', updated_at=now() where id=$1 and workspace_id=$2::uuid`, jobID, workspaceID); err != nil {
			return err
		}
		for _, source := range snapshot.Issues {
			if source.State == "closed" && !includeClosed {
				summary["skipped"] = intFromAny(summary["skipped"]) + 1
				continue
			}
			var existing string
			err := tx.QueryRow(ctx, `select issue_id::text from import_result where workspace_id=$1::uuid and provider='github' and external_issue_id=$2 and issue_id is not null limit 1`, workspaceID, source.ExternalID).Scan(&existing)
			if err == nil && existing != "" {
				summary["skipped"] = intFromAny(summary["skipped"]) + 1
				continue
			}
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			target := fallback
			if mappedTeamID := mapping.RepoTeams[source.Repository]; mappedTeamID != "" {
				if team, ok := teamByID[mappedTeamID]; ok {
					target = team
				}
			}
			state := mappedGitHubState(states, target.ID, source.State, mapping.Statuses)
			if state.ID == "" {
				state = defaultImportState(states, target.ID)
			}
			if state.ID == "" {
				return errors.New("no workflow state found for " + target.Key)
			}
			number := maxNumbers[target.ID] + 1
			maxNumbers[target.ID] = number
			identifier := target.Key + "-" + strconv.Itoa(number)
			assigneeID := mappedGitHubAssignee(source.Assignees, mapping.Users)
			description := githubIssueDescription(source)
			var issueID string
			if err := tx.QueryRow(ctx, `insert into issue (number,identifier,title,description,team_id,state_id,creator_id,assignee_id,priority,completed_at) values ($1,$2,$3,$4,$5::uuid,$6::uuid,$7,nullif($8,''),'none',case when $9='closed' then now() else null end) returning id::text`, number, identifier, source.Title, description, target.ID, state.ID, p.UserID, assigneeID, source.State).Scan(&issueID); err != nil {
				return err
			}
			metadata, _ := json.Marshal(map[string]any{"identifier": identifier, "title": source.Title, "source": "github_issue", "importSource": "github", "github": map[string]any{"repository": source.Repository, "number": source.Number, "url": source.HTMLURL, "externalId": source.ExternalID}})
			if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,actor_name,actor_email,event_type,metadata) values ($1::uuid,$2,$3,$4,'created',$5::jsonb)`, issueID, p.UserID, actorName, actorEmail, metadata); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `insert into integration_thread_link (workspace_id, provider, issue_id, external_channel_id, external_thread_ts, external_message_ts, external_permalink, direction, source_event_id) values ($1::uuid,'github',$2::uuid,$3,$4,$5,$6,'inbound',$7) on conflict do nothing`, workspaceID, issueID, source.Repository, strconv.Itoa(source.Number), source.ExternalID, source.HTMLURL, source.ExternalID); err != nil {
				return err
			}
			commentCount, err := insertGitHubComments(ctx, tx, p.UserID, issueID, source.Comments)
			if err != nil {
				return err
			}
			labelCount, err := h.attachMappedGitHubLabels(ctx, tx, workspaceID, issueID, target.ID, source.Labels, mapping.Labels)
			if err != nil {
				return err
			}
			resultRaw, _ := json.Marshal(map[string]any{"identifier": identifier, "repository": source.Repository, "number": source.Number, "url": source.HTMLURL})
			if _, err := tx.Exec(ctx, `insert into import_result (job_id, workspace_id, provider, external_issue_id, issue_id, status, source_url, payload, updated_at) values ($1,$2::uuid,'github',$3,$4::uuid,'created',$5,$6::jsonb,now()) on conflict (workspace_id, provider, external_issue_id) do update set job_id=excluded.job_id, issue_id=coalesce(import_result.issue_id, excluded.issue_id), status='skipped', payload=import_result.payload || excluded.payload, updated_at=now()`, jobID, workspaceID, source.ExternalID, issueID, source.HTMLURL, resultRaw); err != nil {
				return err
			}
			summary["created"] = intFromAny(summary["created"]) + 1
			summary["comments"] = intFromAny(summary["comments"]) + commentCount
			summary["labels"] = intFromAny(summary["labels"]) + labelCount
		}
		summary["issues"] = len(snapshot.Issues)
		summaryRaw, _ := json.Marshal(summary)
		_, err := tx.Exec(ctx, `insert into import_mapping (job_id, workspace_id, provider, mapping_type, external_id, target_id, payload, updated_at) values ($1,$2::uuid,'github','confirmation','github',$3,$4::jsonb,now()) on conflict (job_id, mapping_type, external_id) do update set target_id=excluded.target_id, payload=excluded.payload, updated_at=now()`, jobID, workspaceID, mapping.DefaultTeamID, summaryRaw)
		return err
	})
	return summary, err
}

func (h Handler) attachMappedGitHubLabels(ctx context.Context, tx pgx.Tx, workspaceID string, issueID string, teamID string, labels []githubSnapshotLabel, mapping map[string]string) (int, error) {
	count := 0
	for _, label := range labels {
		target := strings.TrimSpace(mapping[label.Name])
		if target == "" || target == "skip" {
			continue
		}
		labelID := target
		if target == "create" {
			err := tx.QueryRow(ctx, `select id::text from label where workspace_id=$1::uuid and team_id=$2::uuid and lower(name)=lower($3) and archived_at is null order by created_at asc limit 1`, workspaceID, teamID, label.Name).Scan(&labelID)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return count, err
			}
			if errors.Is(err, pgx.ErrNoRows) {
				color := "#6b6f76"
				if normalized := normalizeGitHubLabelColor(label.Color); normalized != "" {
					color = normalized
				}
				if err := tx.QueryRow(ctx, `insert into label (name,color,description,workspace_id,team_id) values ($1,$2,$3,$4::uuid,$5::uuid) returning id::text`, label.Name, color, importNullString(label.Description), workspaceID, teamID).Scan(&labelID); err != nil {
					return count, err
				}
			}
		}
		if _, err := tx.Exec(ctx, `insert into issue_label (issue_id,label_id) values ($1::uuid,$2::uuid) on conflict do nothing`, issueID, labelID); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

func insertGitHubComments(ctx context.Context, tx pgx.Tx, userID string, issueID string, comments []githubSnapshotComment) (int, error) {
	for _, comment := range comments {
		body := githubCommentBody(comment)
		var commentID string
		if err := tx.QueryRow(ctx, `insert into comment (body,issue_id,user_id) values ($1,$2::uuid,$3) returning id::text`, body, issueID, userID).Scan(&commentID); err != nil {
			return 0, err
		}
		metadata, _ := json.Marshal(map[string]any{"source": "github_issue_comment", "github": map[string]any{"externalId": comment.ExternalID, "url": comment.HTMLURL, "author": comment.Author.Login}})
		if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,event_type,metadata) values ($1::uuid,$2,'comment_created',$3::jsonb)`, issueID, userID, metadata); err != nil {
			return 0, err
		}
	}
	return len(comments), nil
}

func (c githubAPIClient) fetchSnapshot(ctx context.Context, repositories []string, scope string) (githubSnapshot, error) {
	client := c
	if client.HTTP == nil {
		client.HTTP = http.DefaultClient
	}
	client.BaseURL = strings.TrimRight(client.BaseURL, "/")
	snapshot := githubSnapshot{Provider: "github", Scope: normalizeGitHubImportScope(scope), FetchedAt: time.Now().UTC().Format(time.RFC3339Nano), Totals: map[string]int{"issues": 0, "comments": 0, "open": 0, "closed": 0}}
	for _, repo := range repositories {
		fullName := normalizeGitHubRepo(repo)
		if fullName == "" {
			return snapshot, errors.New("repository must be owner/name")
		}
		issues, err := client.fetchRepoIssues(ctx, fullName)
		if err != nil {
			return snapshot, err
		}
		snapshot.Repositories = append(snapshot.Repositories, githubSnapshotRepo{FullName: fullName, HTMLURL: "https://github.com/" + fullName})
		for _, issue := range issues {
			if issue.PullRequest != nil {
				continue
			}
			comments, err := client.fetchIssueComments(ctx, fullName, issue.Number)
			if err != nil {
				return snapshot, err
			}
			converted := convertGitHubIssue(fullName, issue, comments)
			if converted.State == "closed" {
				snapshot.Totals["closed"]++
			} else {
				snapshot.Totals["open"]++
			}
			snapshot.Totals["issues"]++
			snapshot.Totals["comments"] += len(converted.Comments)
			snapshot.Issues = append(snapshot.Issues, converted)
		}
	}
	return snapshot, nil
}

func (c githubAPIClient) fetchRepoIssues(ctx context.Context, fullName string) ([]githubAPIIssue, error) {
	var out []githubAPIIssue
	for page := 1; ; page++ {
		path := "/repos/" + escapedGitHubRepo(fullName) + "/issues?state=all&per_page=100&page=" + strconv.Itoa(page)
		var batch []githubAPIIssue
		if err := c.get(ctx, path, &batch); err != nil {
			return nil, err
		}
		out = append(out, batch...)
		if len(batch) < 100 {
			return out, nil
		}
	}
}

func (c githubAPIClient) fetchIssueComments(ctx context.Context, fullName string, number int) ([]githubAPIComment, error) {
	var out []githubAPIComment
	for page := 1; ; page++ {
		path := "/repos/" + escapedGitHubRepo(fullName) + "/issues/" + strconv.Itoa(number) + "/comments?per_page=100&page=" + strconv.Itoa(page)
		var batch []githubAPIComment
		if err := c.get(ctx, path, &batch); err != nil {
			return nil, err
		}
		out = append(out, batch...)
		if len(batch) < 100 {
			return out, nil
		}
	}
}

func (c githubAPIClient) get(ctx context.Context, path string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(c.BaseURL, "/")+path, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if c.Token != "" {
		request.Header.Set("Authorization", "Bearer "+c.Token)
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return errors.New("GitHub API returned " + response.Status + ": " + string(bytes.TrimSpace(body)))
	}
	return json.Unmarshal(body, target)
}

func convertGitHubIssue(repo string, issue githubAPIIssue, comments []githubAPIComment) githubSnapshotIssue {
	labels := make([]githubSnapshotLabel, 0, len(issue.Labels))
	for _, label := range issue.Labels {
		labels = append(labels, githubSnapshotLabel{Name: label.Name, Color: label.Color, Description: label.Description})
	}
	assignees := make([]githubSnapshotUser, 0, len(issue.Assignees))
	for _, assignee := range issue.Assignees {
		assignees = append(assignees, convertGitHubUser(assignee))
	}
	convertedComments := make([]githubSnapshotComment, 0, len(comments))
	for _, comment := range comments {
		convertedComments = append(convertedComments, githubSnapshotComment{ExternalID: strconv.FormatInt(comment.ID, 10), Body: comment.Body, HTMLURL: comment.HTMLURL, Author: convertGitHubUser(comment.User), CreatedAt: comment.CreatedAt})
	}
	var milestone *githubSnapshotMilestone
	if issue.Milestone != nil {
		milestone = &githubSnapshotMilestone{Title: issue.Milestone.Title, State: issue.Milestone.State}
	}
	return githubSnapshotIssue{ExternalID: repo + "#" + strconv.Itoa(issue.Number), Repository: repo, Number: issue.Number, Title: issue.Title, Body: issue.Body, State: strings.ToLower(issue.State), HTMLURL: issue.HTMLURL, Author: convertGitHubUser(issue.User), Assignees: assignees, Labels: labels, Milestone: milestone, Comments: convertedComments, CreatedAt: issue.CreatedAt, UpdatedAt: issue.UpdatedAt}
}

func convertGitHubUser(user githubAPIUser) githubSnapshotUser {
	return githubSnapshotUser{Login: user.Login, AvatarURL: user.AvatarURL, HTMLURL: user.HTMLURL}
}

func readGitHubImportMapping(raw map[string]any) githubImportMapping {
	return githubImportMapping{DefaultTeamID: stringFromMap(raw, "defaultTeamId"), RepoTeams: stringMap(raw["repoTeams"]), Statuses: stringMap(raw["statuses"]), Users: stringMap(raw["users"]), Labels: stringMap(raw["labels"])}
}

func mappedGitHubState(states []importStateRow, teamID string, sourceState string, mapping map[string]string) importStateRow {
	stateID := mapping[strings.ToLower(sourceState)]
	for _, state := range states {
		if state.TeamID == teamID && state.ID == stateID {
			return state
		}
	}
	return importStateRow{}
}

func mappedGitHubAssignee(assignees []githubSnapshotUser, mapping map[string]string) string {
	for _, assignee := range assignees {
		if userID := strings.TrimSpace(mapping[assignee.Login]); userID != "" {
			return userID
		}
	}
	return ""
}

func githubIssueDescription(issue githubSnapshotIssue) string {
	parts := []string{"<p>Imported from GitHub: <a href=\"" + html.EscapeString(issue.HTMLURL) + "\">" + html.EscapeString(issue.Repository+"#"+strconv.Itoa(issue.Number)) + "</a></p>"}
	if strings.TrimSpace(issue.Body) != "" {
		parts = append(parts, "<p>"+strings.ReplaceAll(html.EscapeString(issue.Body), "\n", "<br>")+"</p>")
	}
	return strings.Join(parts, "")
}

func githubCommentBody(comment githubSnapshotComment) string {
	prefix := "Imported GitHub comment"
	if comment.Author.Login != "" {
		prefix += " by " + html.EscapeString(comment.Author.Login)
	}
	if comment.HTMLURL != "" {
		prefix += " (<a href=\"" + html.EscapeString(comment.HTMLURL) + "\">source</a>)"
	}
	body := strings.ReplaceAll(html.EscapeString(comment.Body), "\n", "<br>")
	return "<p>" + prefix + "</p><p>" + body + "</p>"
}

func normalizeGitHubImportScope(scope string) string {
	if strings.EqualFold(scope, "all") || strings.EqualFold(scope, "include_closed") {
		return "all"
	}
	return "open"
}

func normalizeGitHubRepo(repo string) string {
	trimmed := strings.Trim(strings.TrimSpace(repo), "/")
	trimmed = strings.TrimPrefix(trimmed, "https://github.com/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return ""
	}
	return parts[0] + "/" + parts[1]
}

func escapedGitHubRepo(fullName string) string {
	parts := strings.SplitN(fullName, "/", 2)
	if len(parts) != 2 {
		return url.PathEscape(fullName)
	}
	return url.PathEscape(parts[0]) + "/" + url.PathEscape(parts[1])
}

func splitProviderList(value string) []string {
	fields := strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '\n' || r == '\r' || r == '\t' || r == ' ' })
	out := []string{}
	seen := map[string]bool{}
	for _, field := range fields {
		repo := normalizeGitHubRepo(field)
		if repo != "" && !seen[repo] {
			seen[repo] = true
			out = append(out, repo)
		}
	}
	return out
}

func stringSlice(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := []string{}
	for _, item := range items {
		if s := normalizeGitHubRepo(asStringValue(item)); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func stringMap(value any) map[string]string {
	raw := recordFromAny(value)
	out := map[string]string{}
	for key, item := range raw {
		out[key] = asStringValue(item)
	}
	return out
}

func repoNames(repos []githubSnapshotRepo) []string {
	out := make([]string, 0, len(repos))
	for _, repo := range repos {
		out = append(out, repo.FullName)
	}
	return out
}

func normalizeGitHubLabelColor(color string) string {
	trimmed := strings.TrimPrefix(strings.TrimSpace(color), "#")
	if len(trimmed) != 6 {
		return ""
	}
	for _, r := range trimmed {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return ""
		}
	}
	return "#" + strings.ToLower(trimmed)
}

func importNullString(value string) sql.NullString {
	trimmed := strings.TrimSpace(value)
	return sql.NullString{String: trimmed, Valid: trimmed != ""}
}

func ptrTime(value time.Time) *time.Time {
	return &value
}
