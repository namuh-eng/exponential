package issues

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type historyActor struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Email *string `json:"email"`
}

type historyEvent struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Metadata  map[string]any `json:"metadata"`
	Actor     *historyActor  `json:"actor"`
	CreatedAt string         `json:"createdAt"`
}

type historyResponse struct {
	History []historyEvent `json:"history"`
}

func (h Handler) History(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	currentIssue, err := h.findIssue(r.Context(), chi.URLParam(r, "id"), p.WorkspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Issue not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load issue history failed", err.Error())
		return
	}

	rows, err := h.DB.Query(r.Context(), `
		select ih.id::text, ih.event_type::text, coalesce(ih.metadata,'{}'::jsonb), ih.actor_id, ih.actor_name, ih.actor_email, u.name, u.email, ih.created_at
		from issue_history ih
		left join "user" u on u.id=ih.actor_id
		where ih.issue_id=$1::uuid
		order by ih.created_at asc`, currentIssue.ID)
	if err != nil {
		problem.Write(w, 500, "Load issue history failed", err.Error())
		return
	}
	defer rows.Close()

	events := []historyEvent{}
	for rows.Next() {
		var event historyEvent
		var metadataRaw []byte
		var actorID *string
		var actorName *string
		var actorEmail *string
		var currentActorName *string
		var currentActorEmail *string
		var createdAt time.Time
		if err := rows.Scan(&event.ID, &event.Type, &metadataRaw, &actorID, &actorName, &actorEmail, &currentActorName, &currentActorEmail, &createdAt); err != nil {
			problem.Write(w, 500, "Load issue history failed", err.Error())
			return
		}
		event.Metadata = map[string]any{}
		_ = json.Unmarshal(metadataRaw, &event.Metadata)
		if actorID != nil {
			event.Actor = &historyActor{ID: *actorID, Name: firstStringPtr(currentActorName, actorName), Email: firstStringPtr(currentActorEmail, actorEmail)}
		}
		event.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, 500, "Load issue history failed", err.Error())
		return
	}

	if len(events) == 0 {
		events = []historyEvent{{
			ID:   "legacy-created-" + currentIssue.ID,
			Type: "created",
			Metadata: map[string]any{
				"identifier":        currentIssue.Identifier,
				"title":             currentIssue.Title,
				"migrationFallback": true,
			},
			CreatedAt: currentIssue.CreatedAt,
		}}
		if currentIssue.CreatorID != "" {
			events[0].Actor = &historyActor{ID: currentIssue.CreatorID}
		}
	}

	problem.JSON(w, 200, historyResponse{History: events})
}

func firstStringPtr(values ...*string) *string {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}
