package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	syncapi "github.com/namuh-eng/exponential/apps/api/internal/sync"
)

type Handler struct{ DB *pgxpool.Pool }

type Notification struct {
	ID              string  `json:"id"`
	Type            string  `json:"type"`
	ActorName       string  `json:"actorName"`
	ActorImage      *string `json:"actorImage"`
	IssueIdentifier string  `json:"issueIdentifier"`
	IssueTitle      string  `json:"issueTitle"`
	IssuePriority   string  `json:"issuePriority"`
	IssueID         *string `json:"issueId"`
	ReadAt          *string `json:"readAt"`
	SnoozedUntilAt  *string `json:"snoozedUntilAt"`
	UnsnoozedAt     *string `json:"unsnoozedAt"`
	CreatedAt       string  `json:"createdAt"`
}

type listResponse struct {
	Notifications []Notification `json:"notifications"`
	UnreadCount   int32          `json:"unreadCount"`
}

type bulkReadResponse struct {
	Success      bool  `json:"success"`
	UpdatedCount int64 `json:"updatedCount"`
	UnreadCount  int32 `json:"unreadCount"`
}

type notificationActionResponse struct {
	Success      bool                    `json:"success"`
	UnreadCount  int32                   `json:"unreadCount"`
	Notification *notificationSnoozeInfo `json:"notification,omitempty"`
}

type notificationSnoozeInfo struct {
	ID             string  `json:"id"`
	SnoozedUntilAt *string `json:"snoozedUntilAt"`
	UnsnoozedAt    *string `json:"unsnoozedAt"`
}

type snoozeRequest struct {
	SnoozedUntilAt *string `json:"snoozedUntilAt"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Patch("/bulk-read", h.BulkRead)
	r.Patch("/{id}/read", h.MarkRead)
	r.Patch("/{id}/unread", h.MarkUnread)
	r.Patch("/{id}/snooze", h.Snooze)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	rows, err := h.DB.Query(r.Context(), `
		select n.id::text, n.type::text, coalesce(a.name,'Unknown'), a.image, i.id::text, coalesce(i.identifier,''), coalesce(i.title,''), coalesce(i.priority::text,'none'), n.read_at, n.snoozed_until_at, n.unsnoozed_at, n.created_at
		from notification n
		left join "user" a on a.id=n.actor_id
		left join issue i on i.id=n.issue_id
		where n.user_id=$1
		order by n.created_at desc
		limit 100`, p.UserID)
	if err != nil {
		problem.Write(w, 500, "List notifications failed", err.Error())
		return
	}
	defer rows.Close()
	items := []Notification{}
	for rows.Next() {
		item, err := scanNotification(rows)
		if err != nil {
			problem.Write(w, 500, "List notifications failed", err.Error())
			return
		}
		items = append(items, item)
	}
	count, err := h.unreadCount(r.Context(), p.UserID)
	if err != nil {
		problem.Write(w, 500, "List notifications failed", err.Error())
		return
	}
	problem.JSON(w, 200, listResponse{Notifications: items, UnreadCount: count})
}

func (h Handler) BulkRead(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Mark notifications read failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	cmd, err := tx.Exec(r.Context(), `update notification set read_at=now() where user_id=$1 and read_at is null and type <> 'comment'`, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Mark notifications read failed", err.Error())
		return
	}
	count, err := h.unreadCountTx(r.Context(), tx, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Mark notifications read failed", err.Error())
		return
	}
	response := bulkReadResponse{Success: true, UpdatedCount: cmd.RowsAffected(), UnreadCount: count}
	op, err := syncapi.InsertOperation(r.Context(), tx, p.WorkspaceID, "notification", p.UserID, "bulk_read", response, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Mark notifications read failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Mark notifications read failed", err.Error())
		return
	}
	syncapi.PublishOperations(r.Context(), []syncapi.Operation{op})
	problem.JSON(w, 200, response)
}

func (h Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	h.updateReadState(w, r, true)
}

func (h Handler) MarkUnread(w http.ResponseWriter, r *http.Request) {
	h.updateReadState(w, r, false)
}

func (h Handler) updateReadState(w http.ResponseWriter, r *http.Request, read bool) {
	p, _ := auth.FromContext(r.Context())
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Update notification failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var id string
	if read {
		err = tx.QueryRow(r.Context(), `update notification set read_at=now() where id=$1::uuid and user_id=$2 returning id::text`, chi.URLParam(r, "id"), p.UserID).Scan(&id)
	} else {
		err = tx.QueryRow(r.Context(), `update notification set read_at=null where id=$1::uuid and user_id=$2 returning id::text`, chi.URLParam(r, "id"), p.UserID).Scan(&id)
	}
	if err != nil {
		writeNotificationUpdateErr(w, err)
		return
	}
	count, err := h.unreadCountTx(r.Context(), tx, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Update notification failed", err.Error())
		return
	}
	response := notificationActionResponse{Success: true, UnreadCount: count}
	opType := "unread"
	if read {
		opType = "read"
	}
	op, err := syncapi.InsertOperation(r.Context(), tx, p.WorkspaceID, "notification", id, opType, response, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Update notification failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Update notification failed", err.Error())
		return
	}
	syncapi.PublishOperations(r.Context(), []syncapi.Operation{op})
	problem.JSON(w, 200, response)
}

func (h Handler) Snooze(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input snoozeRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	var snoozeDate *time.Time
	if input.SnoozedUntilAt != nil && *input.SnoozedUntilAt != "" {
		parsed, err := time.Parse(time.RFC3339, *input.SnoozedUntilAt)
		if err != nil {
			problem.Write(w, 400, "snoozedUntilAt must be a valid ISO date or null", "")
			return
		}
		snoozeDate = &parsed
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Snooze notification failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var id string
	var snoozed, unsnoozed *time.Time
	err = tx.QueryRow(r.Context(), `
		update notification
		set snoozed_until_at=$1, unsnoozed_at=case when $1::timestamptz is null then now() else null end
		where id=$2::uuid and user_id=$3
		returning id::text, snoozed_until_at, unsnoozed_at`, snoozeDate, chi.URLParam(r, "id"), p.UserID).Scan(&id, &snoozed, &unsnoozed)
	if err != nil {
		writeNotificationUpdateErr(w, err)
		return
	}
	count, err := h.unreadCountTx(r.Context(), tx, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Snooze notification failed", err.Error())
		return
	}
	response := notificationActionResponse{Success: true, UnreadCount: count, Notification: &notificationSnoozeInfo{ID: id, SnoozedUntilAt: formatTime(snoozed), UnsnoozedAt: formatTime(unsnoozed)}}
	op, err := syncapi.InsertOperation(r.Context(), tx, p.WorkspaceID, "notification", id, "snoozed", response, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Snooze notification failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Snooze notification failed", err.Error())
		return
	}
	syncapi.PublishOperations(r.Context(), []syncapi.Operation{op})
	problem.JSON(w, 200, response)
}

type scanner interface{ Scan(dest ...any) error }

func scanNotification(row scanner) (Notification, error) {
	var n Notification
	var readAt, snoozed, unsnoozed *time.Time
	var created time.Time
	if err := row.Scan(&n.ID, &n.Type, &n.ActorName, &n.ActorImage, &n.IssueID, &n.IssueIdentifier, &n.IssueTitle, &n.IssuePriority, &readAt, &snoozed, &unsnoozed, &created); err != nil {
		return Notification{}, err
	}
	n.ReadAt = formatTime(readAt)
	n.SnoozedUntilAt = formatTime(snoozed)
	n.UnsnoozedAt = formatTime(unsnoozed)
	n.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	return n, nil
}

func (h Handler) unreadCount(ctx context.Context, userID string) (int32, error) {
	var count int32
	err := h.DB.QueryRow(ctx, `select count(*)::int from notification where user_id=$1 and read_at is null and (snoozed_until_at is null or snoozed_until_at <= now() or (unsnoozed_at is not null and unsnoozed_at >= snoozed_until_at))`, userID).Scan(&count)
	return count, err
}

func (h Handler) unreadCountTx(ctx context.Context, tx pgx.Tx, userID string) (int32, error) {
	var count int32
	err := tx.QueryRow(ctx, `select count(*)::int from notification where user_id=$1 and read_at is null and (snoozed_until_at is null or snoozed_until_at <= now() or (unsnoozed_at is not null and unsnoozed_at >= snoozed_until_at))`, userID).Scan(&count)
	return count, err
}

func formatTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	v := t.UTC().Format(time.RFC3339Nano)
	return &v
}

func writeNotificationUpdateErr(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Notification not found", "")
		return
	}
	problem.Write(w, 500, "Update notification failed", err.Error())
}
