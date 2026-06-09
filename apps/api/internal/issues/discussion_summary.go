package issues

import (
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

const minSummaryComments = 2

type discussionIssue struct {
	ID          string
	Identifier  string
	Title       string
	TeamID      string
	WorkspaceID string
	Settings    map[string]any
}

type discussionComment struct {
	Body      string
	UserName  *string
	CreatedAt time.Time
	UpdatedAt *time.Time
}

type persistedDiscussionSummary struct {
	Status               string
	Summary              *string
	GeneratedAt          *time.Time
	GeneratedBy          *string
	SourceCommentCount   int32
	SourceCommentVersion *string
	Error                *string
	StaleAt              *time.Time
}

var htmlTagPattern = regexp.MustCompile(`<[^>]+>`)

func (h Handler) GetDiscussionSummary(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	issue, err := h.findDiscussionIssue(r, chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load discussion summary failed", err.Error())
		return
	}
	comments, err := h.discussionComments(r, issue.ID)
	if err != nil {
		problem.Write(w, 500, "Load discussion summary failed", err.Error())
		return
	}
	persisted, err := h.persistedDiscussionSummary(r, issue.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 500, "Load discussion summary failed", err.Error())
		return
	}
	problem.JSON(w, 200, buildDiscussionState(discussionSummaryEnabled(issue.Settings), comments, persisted))
}

func (h Handler) GenerateDiscussionSummary(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	issue, err := h.findDiscussionIssue(r, chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Generate discussion summary failed", err.Error())
		return
	}
	if !discussionSummaryEnabled(issue.Settings) {
		problem.Write(w, 403, "Discussion summaries are disabled for this team", "")
		return
	}
	comments, err := h.discussionComments(r, issue.ID)
	if err != nil {
		problem.Write(w, 500, "Generate discussion summary failed", err.Error())
		return
	}
	sourceCount, sourceVersion := discussionSource(comments)
	if sourceCount < minSummaryComments {
		problem.Write(w, 400, "At least two comments are required to summarize discussion", "")
		return
	}
	summary := deterministicDiscussionSummary(issue, comments)
	generatedAt := time.Now().UTC()
	var stored persistedDiscussionSummary
	err = h.DB.QueryRow(r.Context(), `
		insert into issue_discussion_summary (issue_id,team_id,workspace_id,status,summary,source_comment_count,source_comment_version,generated_at,generated_by,stale_at,error,updated_at)
		values ($1::uuid,$2::uuid,$3::uuid,'generated',$4,$5,$6,$7,$8,null,null,now())
		on conflict (issue_id) do update set status='generated', summary=$4, source_comment_count=$5, source_comment_version=$6, generated_at=$7, generated_by=$8, stale_at=null, error=null, updated_at=now()
		returning status, summary, generated_at, generated_by, source_comment_count, source_comment_version, error, stale_at`, issue.ID, issue.TeamID, issue.WorkspaceID, summary, sourceCount, sourceVersion, generatedAt, p.UserID).Scan(&stored.Status, &stored.Summary, &stored.GeneratedAt, &stored.GeneratedBy, &stored.SourceCommentCount, &stored.SourceCommentVersion, &stored.Error, &stored.StaleAt)
	if err != nil {
		problem.Write(w, 500, "Generate discussion summary failed", err.Error())
		return
	}
	problem.JSON(w, 200, buildDiscussionState(true, comments, &stored))
}

func (h Handler) findDiscussionIssue(r *http.Request, id, workspaceID string) (discussionIssue, error) {
	where := "i.identifier=$2"
	if strings.Count(id, "-") == 4 && len(id) >= 32 {
		where = "i.id=$2::uuid"
	}
	var issue discussionIssue
	var raw []byte
	err := h.DB.QueryRow(r.Context(), `select i.id::text,i.identifier,i.title,i.team_id::text,t.workspace_id::text,coalesce(t.settings,'{}'::jsonb) from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid and `+where+` limit 1`, workspaceID, id).Scan(&issue.ID, &issue.Identifier, &issue.Title, &issue.TeamID, &issue.WorkspaceID, &raw)
	issue.Settings = decodeMap(raw)
	return issue, err
}

func (h Handler) discussionComments(r *http.Request, issueID string) ([]discussionComment, error) {
	rows, err := h.DB.Query(r.Context(), `select c.body,u.name,c.created_at,c.updated_at from comment c left join "user" u on u.id=c.user_id where c.issue_id=$1::uuid order by c.created_at asc`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []discussionComment{}
	for rows.Next() {
		var c discussionComment
		if err := rows.Scan(&c.Body, &c.UserName, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (h Handler) persistedDiscussionSummary(r *http.Request, issueID string) (*persistedDiscussionSummary, error) {
	var s persistedDiscussionSummary
	err := h.DB.QueryRow(r.Context(), `select status, summary, generated_at, generated_by, source_comment_count, source_comment_version, error, stale_at from issue_discussion_summary where issue_id=$1::uuid limit 1`, issueID).Scan(&s.Status, &s.Summary, &s.GeneratedAt, &s.GeneratedBy, &s.SourceCommentCount, &s.SourceCommentVersion, &s.Error, &s.StaleAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func buildDiscussionState(enabled bool, comments []discussionComment, persisted *persistedDiscussionSummary) map[string]any {
	if !enabled {
		return map[string]any{"enabled": false, "status": "disabled", "text": nil, "generatedAt": nil, "generatedBy": nil, "sourceCommentCount": 0, "sourceCommentVersion": nil, "staleAt": nil, "error": nil}
	}
	count, version := discussionSource(comments)
	if count < minSummaryComments {
		return map[string]any{"enabled": true, "status": "ineligible", "text": nil, "generatedAt": nil, "generatedBy": nil, "sourceCommentCount": count, "sourceCommentVersion": version, "staleAt": nil, "error": nil}
	}
	if persisted == nil {
		return map[string]any{"enabled": true, "status": "ready", "text": nil, "generatedAt": nil, "generatedBy": nil, "sourceCommentCount": count, "sourceCommentVersion": version, "staleAt": nil, "error": nil}
	}
	status := persisted.Status
	staleAt := timePtrString(persisted.StaleAt)
	if persisted.SourceCommentCount != count || stringPtrValue(persisted.SourceCommentVersion) != stringPtrValue(version) {
		if persisted.Summary != nil {
			status = "stale"
			now := time.Now().UTC().Format(time.RFC3339)
			staleAt = &now
		} else {
			status = "ready"
		}
	}
	var errText any
	if status == "failed" {
		errText = persisted.Error
	}
	return map[string]any{"enabled": true, "status": status, "text": persisted.Summary, "generatedAt": timePtrString(persisted.GeneratedAt), "generatedBy": persisted.GeneratedBy, "sourceCommentCount": count, "sourceCommentVersion": version, "staleAt": staleAt, "error": errText}
}

func discussionSummaryEnabled(settings map[string]any) bool {
	if value, ok := settings["discussionSummariesEnabled"].(bool); ok {
		return value
	}
	return false
}

func discussionSource(comments []discussionComment) (int32, *string) {
	var latest *time.Time
	count := int32(0)
	for _, comment := range comments {
		if cleanDiscussionText(comment.Body) == "" {
			continue
		}
		count++
		version := comment.CreatedAt
		if comment.UpdatedAt != nil {
			version = *comment.UpdatedAt
		}
		if latest == nil || version.After(*latest) {
			v := version
			latest = &v
		}
	}
	if latest == nil {
		return count, nil
	}
	value := latest.UTC().Format(time.RFC3339)
	return count, &value
}

func deterministicDiscussionSummary(issue discussionIssue, comments []discussionComment) string {
	lines := []string{fmt.Sprintf("AI discussion summary for %s: %s", issue.Identifier, issue.Title), "Discussion context considered:"}
	for index, comment := range comments {
		text := cleanDiscussionText(comment.Body)
		if text == "" {
			continue
		}
		author := "Unknown user"
		if comment.UserName != nil && strings.TrimSpace(*comment.UserName) != "" {
			author = strings.TrimSpace(*comment.UserName)
		}
		if len(text) > 220 {
			text = strings.TrimSpace(text[:219]) + "…"
		}
		lines = append(lines, fmt.Sprintf("%d. %s: %s", index+1, author, text))
	}
	return strings.Join(lines, "\n")
}

func cleanDiscussionText(value string) string {
	text := htmlTagPattern.ReplaceAllString(value, " ")
	text = html.UnescapeString(text)
	return strings.Join(strings.Fields(text), " ")
}

func timePtrString(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}
func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func decodeMap(raw []byte) map[string]any {
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return out
}
