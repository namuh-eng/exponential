package webhooks

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

// Handler exposes webhook delivery admin endpoints.
type Handler struct{ DB *pgxpool.Pool }

// Routes registers the webhook delivery management routes.
// All routes are expected to be mounted under an auth-protected prefix,
// e.g. /workspaces/current/webhook-deliveries.
func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.ListDeliveries)
	r.Post("/{id}/retry", h.RetryDelivery)
	return r
}

// deliveryRow is the JSON shape returned by the list endpoint.
type deliveryRow struct {
	ID                string  `json:"id"`
	WebhookID         string  `json:"webhookId"`
	EventType         string  `json:"eventType"`
	Status            string  `json:"status"`
	Attempts          int     `json:"attempts"`
	ResponseCode      *int    `json:"responseCode"`
	ResponseBody      *string `json:"responseBody"`
	LastAttemptedAt   *string `json:"lastAttemptedAt"`
	NextAttemptAt     *string `json:"nextAttemptAt"`
	SourceOperationID *string `json:"sourceOperationId"`
	CreatedAt         string  `json:"createdAt"`
}

// ListDeliveries returns recent webhook delivery rows for the workspace.
// Optional query params: webhook_id, status, limit (max 100).
func (h Handler) ListDeliveries(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}

	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n := parseInt(v); n > 0 && n <= 100 {
			limit = n
		}
	}

	args := []any{p.WorkspaceID, limit}
	where := "wd.workspace_id = $1::uuid"
	if webhookID := r.URL.Query().Get("webhook_id"); webhookID != "" {
		args = append(args, webhookID)
		where += fmt.Sprintf(" and wd.webhook_id = $%d::uuid", len(args))
	}
	if status := r.URL.Query().Get("status"); status != "" {
		args = append(args, status)
		where += fmt.Sprintf(" and wd.status = $%d", len(args))
	}

	rows, err := h.DB.Query(r.Context(),
		`select wd.id::text, wd.webhook_id::text, wd.event_type, wd.status,
		        wd.attempts, wd.response_code, wd.response_body,
		        wd.last_attempted_at, wd.next_attempt_at,
		        wd.source_operation_id, wd.created_at
		 from webhook_delivery wd
		 where `+where+`
		 order by wd.created_at desc
		 limit $2`,
		args...,
	)
	if err != nil {
		problem.Write(w, 500, "List deliveries failed", err.Error())
		return
	}
	defer rows.Close()

	out := []deliveryRow{}
	for rows.Next() {
		var dr deliveryRow
		var createdAt time.Time
		var lastAttempted *time.Time
		var nextAttempt *time.Time
		if err := rows.Scan(
			&dr.ID, &dr.WebhookID, &dr.EventType, &dr.Status,
			&dr.Attempts, &dr.ResponseCode, &dr.ResponseBody,
			&lastAttempted, &nextAttempt,
			&dr.SourceOperationID, &createdAt,
		); err != nil {
			problem.Write(w, 500, "List deliveries failed", err.Error())
			return
		}
		dr.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
		if lastAttempted != nil {
			s := lastAttempted.UTC().Format(time.RFC3339Nano)
			dr.LastAttemptedAt = &s
		}
		if nextAttempt != nil {
			s := nextAttempt.UTC().Format(time.RFC3339Nano)
			dr.NextAttemptAt = &s
		}
		out = append(out, dr)
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, 500, "List deliveries failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"deliveries": out})
}

// RetryDelivery resets a failed/dead delivery to pending so it will be
// re-attempted on the next processing cycle.
func (h Handler) RetryDelivery(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if !isManager(p.Role) {
		problem.Write(w, 403, "Forbidden", "")
		return
	}

	deliveryID := chi.URLParam(r, "id")

	// Verify the delivery belongs to this workspace.
	var currentStatus string
	err := h.DB.QueryRow(r.Context(),
		`select status from webhook_delivery where id=$1::uuid and workspace_id=$2::uuid`,
		deliveryID, p.WorkspaceID,
	).Scan(&currentStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Delivery not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Retry delivery failed", err.Error())
		return
	}
	if currentStatus == "pending" || currentStatus == "delivering" {
		problem.Write(w, 409, "Delivery is already pending", "")
		return
	}

	_, err = h.DB.Exec(r.Context(),
		`update webhook_delivery
		 set status='pending', next_attempt_at=now(), updated_at=now()
		 where id=$1::uuid and workspace_id=$2::uuid`,
		deliveryID, p.WorkspaceID,
	)
	if err != nil {
		problem.Write(w, 500, "Retry delivery failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]string{"status": "pending"})
}

// isManager returns true if the principal role can manage workspace settings.
func isManager(role string) bool {
	return role == "owner" || role == "admin"
}

func parseInt(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}
