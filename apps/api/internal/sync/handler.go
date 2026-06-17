package sync

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	stdsync "sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"nhooyr.io/websocket"
)

type Handler struct{ DB *pgxpool.Pool }

type Operation struct {
	ID          string          `json:"id"`
	WorkspaceID string          `json:"workspace_id"`
	EntityType  string          `json:"entity_type"`
	EntityID    string          `json:"entity_id"`
	OpType      string          `json:"op_type"`
	Payload     json.RawMessage `json:"payload"`
	Version     int64           `json:"version"`
	CreatedAt   string          `json:"created_at"`
	CreatedBy   *string         `json:"created_by"`
}

type replayMessage struct {
	Type       string      `json:"type"`
	Operations []Operation `json:"operations"`
}

type ReplayStatus struct {
	RequestedVersion int64  `json:"requestedVersion"`
	OperationCount   int    `json:"operationCount"`
	ReplayedAt       string `json:"replayedAt"`
}

type statusMessage struct {
	CurrentVersion int64         `json:"currentVersion"`
	LastReplay     *ReplayStatus `json:"lastReplay,omitempty"`
}

var replayStatuses = struct {
	stdsync.Mutex
	byWorkspace map[string]ReplayStatus
}{byWorkspace: map[string]ReplayStatus{}}

func (h Handler) Status(w http.ResponseWriter, r *http.Request) {
	principal, ok := auth.FromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	currentVersion, err := h.currentVersion(r.Context(), principal.WorkspaceID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	response := statusMessage{CurrentVersion: currentVersion}
	replayStatuses.Lock()
	if status, ok := replayStatuses.byWorkspace[principal.WorkspaceID]; ok {
		copy := status
		response.LastReplay = &copy
	}
	replayStatuses.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(response)
}

func (h Handler) WebSocket(w http.ResponseWriter, r *http.Request) {
	principal, ok := auth.FromContext(r.Context())
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "done")

	lastVersion, _ := strconv.ParseInt(r.URL.Query().Get("version"), 10, 64)
	subscription, _ := SubscribeOperations(r.Context(), principal.WorkspaceID)
	if subscription != nil {
		defer subscription.Close()
	}

	ops, err := h.loadOperations(r.Context(), principal.WorkspaceID, lastVersion)
	if err != nil {
		_ = conn.Close(websocket.StatusInternalError, err.Error())
		return
	}
	_ = wsjsonWrite(r.Context(), conn, replayMessage{Type: "replay", Operations: ops})
	recordReplayStatus(principal.WorkspaceID, lastVersion, len(ops))

	clientClosed := make(chan struct{})
	go func() {
		defer close(clientClosed)
		for {
			if _, _, err := conn.Read(r.Context()); err != nil {
				return
			}
		}
	}()

	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-clientClosed:
			return
		case op, ok := <-operationStream(subscription):
			if !ok {
				subscription = nil
				continue
			}
			if err := wsjsonWrite(r.Context(), conn, replayMessage{Type: "operation", Operations: []Operation{op}}); err != nil {
				return
			}
		case <-ticker.C:
			if err := conn.Ping(r.Context()); err != nil {
				return
			}
		}
	}
}

func (h Handler) loadOperations(ctx context.Context, workspaceID string, after int64) ([]Operation, error) {
	rows, err := h.DB.Query(ctx, `
		select id::text, workspace_id::text, entity_type, entity_id, op_type, payload, version, created_at, created_by
		from operation
		where workspace_id = $1::uuid and version > $2
		order by version asc
		limit 1000`, workspaceID, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ops := []Operation{}
	for rows.Next() {
		var op Operation
		var createdAt time.Time
		if err := rows.Scan(&op.ID, &op.WorkspaceID, &op.EntityType, &op.EntityID, &op.OpType, &op.Payload, &op.Version, &createdAt, &op.CreatedBy); err != nil {
			return nil, err
		}
		op.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
		ops = append(ops, op)
	}
	return ops, rows.Err()
}

func (h Handler) currentVersion(ctx context.Context, workspaceID string) (int64, error) {
	var version int64
	err := h.DB.QueryRow(ctx, `select coalesce(max(version), 0) from operation where workspace_id=$1::uuid`, workspaceID).Scan(&version)
	return version, err
}

func recordReplayStatus(workspaceID string, requestedVersion int64, operationCount int) {
	replayStatuses.Lock()
	replayStatuses.byWorkspace[workspaceID] = ReplayStatus{RequestedVersion: requestedVersion, OperationCount: operationCount, ReplayedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	replayStatuses.Unlock()
}

func wsjsonWrite(ctx context.Context, conn *websocket.Conn, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, payload)
}

func operationStream(subscription *OperationSubscription) <-chan Operation {
	if subscription == nil {
		return nil
	}
	return subscription.Operations
}
