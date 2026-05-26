package comments

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	syncapi "github.com/namuh-eng/exponential/apps/api/internal/sync"
)

type Handler struct{ DB *pgxpool.Pool }

type Comment struct {
	ID        string            `json:"id"`
	Body      string            `json:"body"`
	IssueID   string            `json:"issue_id"`
	UserID    string            `json:"user_id"`
	User      CommentUser       `json:"user"`
	OwnedByMe bool              `json:"owned_by_me"`
	CanEdit   bool              `json:"can_edit"`
	CanDelete bool              `json:"can_delete"`
	Reactions []ReactionSummary `json:"reactions"`
	CreatedAt string            `json:"created_at"`
	UpdatedAt string            `json:"updated_at"`
}

type CommentUser struct {
	Name  string  `json:"name"`
	Image *string `json:"image"`
}

type ReactionSummary struct {
	Emoji       string `json:"emoji"`
	Count       int32  `json:"count"`
	Reacted     bool   `json:"reacted"`
	ReactedByMe bool   `json:"reactedByMe"`
}

type commentRequest struct {
	Body string `json:"body"`
}

type reactionRequest struct {
	Emoji string `json:"emoji"`
}

func (h Handler) CreateForIssue(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	issueID, err := h.findIssueID(r.Context(), chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create comment failed", err.Error())
		return
	}
	var input commentRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	body := strings.TrimSpace(input.Body)
	if body == "" {
		problem.Write(w, 400, "Comment body is required", "")
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create comment failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	comment, err := scanComment(tx.QueryRow(r.Context(), `
		with inserted as (
			insert into comment (body, issue_id, user_id) values ($1,$2::uuid,$3)
			returning id, body, issue_id, user_id, created_at, updated_at
		)
		select inserted.id::text, inserted.body, inserted.issue_id::text, inserted.user_id, u.name, u.image, inserted.created_at, inserted.updated_at
		from inserted join "user" u on u.id = inserted.user_id`, body, issueID, p.UserID), p.UserID)
	if err != nil {
		problem.Write(w, 500, "Create comment failed", err.Error())
		return
	}
	if err := h.markDiscussionStale(r.Context(), tx, issueID); err != nil {
		problem.Write(w, 500, "Create comment failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "comment", comment.ID, "created", comment, p.UserID); err != nil {
		problem.Write(w, 500, "Create comment failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create comment failed", err.Error())
		return
	}
	problem.JSON(w, 201, comment)
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input commentRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	body := strings.TrimSpace(input.Body)
	if body == "" {
		problem.Write(w, 400, "Comment body is required", "")
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Update comment failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	comment, err := scanComment(tx.QueryRow(r.Context(), `
		update comment c set body=$1, updated_at=now()
		from "user" u
		where c.id=$2::uuid and c.user_id=$3 and u.id=c.user_id
		returning c.id::text, c.body, c.issue_id::text, c.user_id, u.name, u.image, c.created_at, c.updated_at`, body, chi.URLParam(r, "id"), p.UserID), p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Comment not found or unauthorized", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update comment failed", err.Error())
		return
	}
	if err := h.markDiscussionStale(r.Context(), tx, comment.IssueID); err != nil {
		problem.Write(w, 500, "Update comment failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "comment", comment.ID, "updated", comment, p.UserID); err != nil {
		problem.Write(w, 500, "Update comment failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Update comment failed", err.Error())
		return
	}
	problem.JSON(w, 200, comment)
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	comment, err := h.findOwnedComment(r.Context(), chi.URLParam(r, "id"), p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Comment not found or unauthorized", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete comment failed", err.Error())
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Delete comment failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err := tx.Exec(r.Context(), `delete from comment_attachment where comment_id=$1::uuid`, comment.ID); err != nil {
		problem.Write(w, 500, "Delete comment failed", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `delete from comment where id=$1::uuid`, comment.ID); err != nil {
		problem.Write(w, 500, "Delete comment failed", err.Error())
		return
	}
	if err := h.markDiscussionStale(r.Context(), tx, comment.IssueID); err != nil {
		problem.Write(w, 500, "Delete comment failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "comment", comment.ID, "deleted", comment, p.UserID); err != nil {
		problem.Write(w, 500, "Delete comment failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Delete comment failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) ToggleCommentReaction(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input reactionRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	emoji := strings.TrimSpace(input.Emoji)
	if emoji == "" {
		problem.Write(w, 400, "Emoji is required", "")
		return
	}
	commentID := chi.URLParam(r, "id")
	if ok, err := h.commentInWorkspace(r.Context(), commentID, p.WorkspaceID); err != nil {
		problem.Write(w, 500, "Toggle reaction failed", err.Error())
		return
	} else if !ok {
		problem.Write(w, 404, "Comment not found", "")
		return
	}
	if err := h.toggleReaction(r.Context(), "reaction", "comment_id", commentID, p.UserID, emoji); err != nil {
		problem.Write(w, 500, "Toggle reaction failed", err.Error())
		return
	}
	summary, err := h.commentReactionSummary(r.Context(), commentID, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Toggle reaction failed", err.Error())
		return
	}
	problem.JSON(w, 200, summary)
}

func (h Handler) ToggleIssueReaction(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input reactionRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	emoji := strings.TrimSpace(input.Emoji)
	if emoji == "" {
		problem.Write(w, 400, "Emoji is required", "")
		return
	}
	issueID, err := h.findIssueID(r.Context(), chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Toggle reaction failed", err.Error())
		return
	}
	if err := h.toggleReaction(r.Context(), "issue_reaction", "issue_id", issueID, p.UserID, emoji); err != nil {
		problem.Write(w, 500, "Toggle reaction failed", err.Error())
		return
	}
	summary, err := h.issueReactionSummary(r.Context(), issueID, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Toggle reaction failed", err.Error())
		return
	}
	problem.JSON(w, 200, summary)
}

func (h Handler) DeleteIssueReaction(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input reactionRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	emoji := strings.TrimSpace(input.Emoji)
	if emoji == "" {
		problem.Write(w, 400, "Emoji is required", "")
		return
	}
	issueID, err := h.findIssueID(r.Context(), chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete reaction failed", err.Error())
		return
	}
	_, err = h.DB.Exec(r.Context(), `delete from issue_reaction where issue_id=$1::uuid and user_id=$2 and emoji=$3`, issueID, p.UserID, emoji)
	if err != nil {
		problem.Write(w, 500, "Delete reaction failed", err.Error())
		return
	}
	summary, err := h.issueReactionSummary(r.Context(), issueID, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Delete reaction failed", err.Error())
		return
	}
	problem.JSON(w, 200, summary)
}

func (h Handler) findIssueID(ctx context.Context, id, workspaceID string) (string, error) {
	var issueID string
	err := h.DB.QueryRow(ctx, `select i.id::text from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid and (i.id::text=$2 or i.identifier=$2) limit 1`, workspaceID, id).Scan(&issueID)
	return issueID, err
}

func scanComment(row scanner, currentUserID string) (Comment, error) {
	var c Comment
	var created, updated time.Time
	if err := row.Scan(&c.ID, &c.Body, &c.IssueID, &c.UserID, &c.User.Name, &c.User.Image, &created, &updated); err != nil {
		return Comment{}, err
	}
	c.OwnedByMe = c.UserID == currentUserID
	c.CanEdit = c.OwnedByMe
	c.CanDelete = c.OwnedByMe
	c.Reactions = []ReactionSummary{}
	c.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	c.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
	return c, nil
}

type scanner interface{ Scan(dest ...any) error }

func (h Handler) findOwnedComment(ctx context.Context, id, userID string) (Comment, error) {
	return scanComment(h.DB.QueryRow(ctx, `select c.id::text, c.body, c.issue_id::text, c.user_id, u.name, u.image, c.created_at, c.updated_at from comment c join "user" u on u.id=c.user_id where c.id=$1::uuid and c.user_id=$2`, id, userID), userID)
}

func (h Handler) markDiscussionStale(ctx context.Context, tx pgx.Tx, issueID string) error {
	_, err := tx.Exec(ctx, `update issue_discussion_summary set stale_at=now(), updated_at=now() where issue_id=$1::uuid`, issueID)
	return err
}

func (h Handler) commentInWorkspace(ctx context.Context, commentID, workspaceID string) (bool, error) {
	var one int
	err := h.DB.QueryRow(ctx, `select 1 from comment c join issue i on i.id=c.issue_id join team t on t.id=i.team_id where c.id=$1::uuid and t.workspace_id=$2::uuid`, commentID, workspaceID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (h Handler) toggleReaction(ctx context.Context, table, fk string, id, userID, emoji string) error {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var reactionID string
	err = tx.QueryRow(ctx, `select id::text from `+table+` where `+fk+`=$1::uuid and user_id=$2 and emoji=$3 limit 1`, id, userID, emoji).Scan(&reactionID)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx, `insert into `+table+` (`+fk+`, user_id, emoji) values ($1::uuid,$2,$3)`, id, userID, emoji)
	} else if err == nil {
		_, err = tx.Exec(ctx, `delete from `+table+` where id=$1::uuid`, reactionID)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h Handler) commentReactionSummary(ctx context.Context, commentID, userID string) ([]ReactionSummary, error) {
	rows, err := h.DB.Query(ctx, `select emoji, count(*)::int, bool_or(user_id=$2) from reaction where comment_id=$1::uuid group by emoji order by emoji`, commentID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanReactions(rows, false)
}

func (h Handler) issueReactionSummary(ctx context.Context, issueID, userID string) ([]ReactionSummary, error) {
	rows, err := h.DB.Query(ctx, `select emoji, count(*)::int, bool_or(user_id=$2) from issue_reaction where issue_id=$1::uuid group by emoji order by emoji`, issueID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanReactions(rows, true)
}

func scanReactions(rows pgx.Rows, issueShape bool) ([]ReactionSummary, error) {
	summary := []ReactionSummary{}
	for rows.Next() {
		var r ReactionSummary
		if err := rows.Scan(&r.Emoji, &r.Count, &r.Reacted); err != nil {
			return nil, err
		}
		r.ReactedByMe = r.Reacted
		if !issueShape {
			r.ReactedByMe = false
		}
		summary = append(summary, r)
	}
	return summary, rows.Err()
}

func insertOperation(ctx context.Context, tx pgx.Tx, workspaceID, entityType, entityID, opType string, payload any, createdBy string) error {
	return syncapi.InsertOperation(ctx, tx, workspaceID, entityType, entityID, opType, payload, createdBy)
}
