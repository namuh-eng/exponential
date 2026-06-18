package airbyte

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

const privateDataBehavior = "Airbyte read-only tokens are workspace-scoped and include issues, comments, cycles, initiatives, and project metadata from private teams."

var streams = map[string]streamDefinition{
	"issues": {
		Name:        "issues",
		CursorField: "updated_at",
		PrimaryKey:  "id",
		Schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":           stringSchema(),
				"identifier":   stringSchema(),
				"number":       map[string]any{"type": "integer"},
				"title":        stringSchema(),
				"description":  nullableSchema("string"),
				"team_id":      stringSchema(),
				"state_id":     stringSchema(),
				"assignee_id":  nullableSchema("string"),
				"creator_id":   stringSchema(),
				"priority":     stringSchema(),
				"project_id":   nullableSchema("string"),
				"cycle_id":     nullableSchema("string"),
				"created_at":   dateTimeSchema(),
				"updated_at":   dateTimeSchema(),
				"archived_at":  nullableDateTimeSchema(),
				"completed_at": nullableDateTimeSchema(),
				"canceled_at":  nullableDateTimeSchema(),
			},
		},
	},
	"projects": {
		Name:        "projects",
		CursorField: "updated_at",
		PrimaryKey:  "id",
		Schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":           stringSchema(),
				"name":         stringSchema(),
				"description":  nullableSchema("string"),
				"slug":         stringSchema(),
				"status":       stringSchema(),
				"priority":     stringSchema(),
				"lead_id":      nullableSchema("string"),
				"workspace_id": stringSchema(),
				"start_date":   nullableDateTimeSchema(),
				"target_date":  nullableDateTimeSchema(),
				"completed_at": nullableDateTimeSchema(),
				"canceled_at":  nullableDateTimeSchema(),
				"created_at":   dateTimeSchema(),
				"updated_at":   dateTimeSchema(),
			},
		},
	},
	"comments": {
		Name:        "comments",
		CursorField: "updated_at",
		PrimaryKey:  "id",
		Schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":         stringSchema(),
				"body":       stringSchema(),
				"issue_id":   stringSchema(),
				"user_id":    stringSchema(),
				"created_at": dateTimeSchema(),
				"updated_at": dateTimeSchema(),
			},
		},
	},
	"cycles": {
		Name:        "cycles",
		CursorField: "updated_at",
		PrimaryKey:  "id",
		Schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":            stringSchema(),
				"name":          nullableSchema("string"),
				"number":        map[string]any{"type": "integer"},
				"team_id":       stringSchema(),
				"start_date":    dateTimeSchema(),
				"end_date":      dateTimeSchema(),
				"auto_rollover": nullableSchema("boolean"),
				"created_at":    dateTimeSchema(),
				"updated_at":    dateTimeSchema(),
			},
		},
	},
	"initiatives": {
		Name:        "initiatives",
		CursorField: "updated_at",
		PrimaryKey:  "id",
		Schema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"id":                   stringSchema(),
				"name":                 stringSchema(),
				"description":          nullableSchema("string"),
				"status":               stringSchema(),
				"owner_id":             nullableSchema("string"),
				"workspace_id":         stringSchema(),
				"start_date":           nullableDateTimeSchema(),
				"target_date":          nullableDateTimeSchema(),
				"timeframe":            nullableSchema("string"),
				"health":               stringSchema(),
				"parent_initiative_id": nullableSchema("string"),
				"created_at":           dateTimeSchema(),
				"updated_at":           dateTimeSchema(),
			},
		},
	},
}

var streamOrder = []string{"issues", "projects", "comments", "cycles", "initiatives"}

type Handler struct{ DB *pgxpool.Pool }

type streamDefinition struct {
	Name        string         `json:"name"`
	CursorField string         `json:"cursor_field"`
	PrimaryKey  string         `json:"primary_key"`
	SyncModes   []string       `json:"supported_sync_modes"`
	Schema      map[string]any `json:"json_schema"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/check", h.Check)
	r.Get("/discover", h.Discover)
	r.Get("/catalog", h.Discover)
	r.Get("/streams/{stream}", h.ReadStream)
	return r
}

func (h Handler) Check(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	slug := ""
	_ = h.DB.QueryRow(r.Context(), `select url_slug from workspace where id=$1::uuid limit 1`, p.WorkspaceID).Scan(&slug)
	problem.JSON(w, http.StatusOK, map[string]any{"status": "SUCCEEDED", "message": "Authenticated Airbyte source for workspace " + slug + "."})
}

func (h Handler) Discover(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	payload := map[string]any{
		"connector": map[string]any{
			"name":                 "Exponential Airbyte source",
			"workspace_id":         p.WorkspaceID,
			"supported_sync_modes": []string{"full_refresh", "incremental"},
		},
		"streams":      catalogStreams(),
		"private_data": map[string]any{"private_teams": privateDataBehavior},
	}
	problem.JSON(w, http.StatusOK, payload)
}

func (h Handler) ReadStream(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	streamName := chi.URLParam(r, "stream")
	definition, ok := streams[streamName]
	if !ok {
		problem.Write(w, http.StatusNotFound, "Unsupported Airbyte stream.", "")
		return
	}
	cursor, err := parseCursor(r.URL.Query().Get("cursor"))
	if err != nil {
		problem.Write(w, http.StatusBadRequest, err.Error(), "")
		return
	}
	limit := readLimit(r.URL.Query().Get("limit"))
	records, err := h.readRecords(r, streamName, p.WorkspaceID, cursor, limit)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Read Airbyte stream failed", err.Error())
		return
	}
	nextCursor := any(nil)
	if len(records) > 0 {
		nextCursor = records[len(records)-1][definition.CursorField]
	}
	problem.JSON(w, http.StatusOK, map[string]any{
		"stream":       streamName,
		"sync_mode":    syncMode(cursor),
		"cursor_field": definition.CursorField,
		"records":      records,
		"next_cursor":  nextCursor,
		"has_more":     len(records) == limit,
		"private_data": map[string]any{"private_teams": privateDataBehavior},
	})
}

func catalogStreams() []streamDefinition {
	out := make([]streamDefinition, 0, len(streamOrder))
	for _, name := range streamOrder {
		entry := streams[name]
		entry.SyncModes = []string{"full_refresh", "incremental"}
		out = append(out, entry)
	}
	return out
}

func readLimit(value string) int {
	limit, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || limit <= 0 {
		return 100
	}
	if limit > 1000 {
		return 1000
	}
	return limit
}

func parseCursor(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil, errString("Cursor must be an ISO timestamp.")
	}
	parsed = parsed.UTC()
	return &parsed, nil
}

func syncMode(cursor *time.Time) string {
	if cursor == nil {
		return "full_refresh"
	}
	return "incremental"
}

func (h Handler) readRecords(r *http.Request, stream string, workspaceID string, cursor *time.Time, limit int) ([]map[string]any, error) {
	switch stream {
	case "issues":
		return h.readIssues(r, workspaceID, cursor, limit)
	case "projects":
		return h.readProjects(r, workspaceID, cursor, limit)
	case "comments":
		return h.readComments(r, workspaceID, cursor, limit)
	case "cycles":
		return h.readCycles(r, workspaceID, cursor, limit)
	case "initiatives":
		return h.readInitiatives(r, workspaceID, cursor, limit)
	}
	return nil, errString("Unsupported Airbyte stream.")
}

func (h Handler) readIssues(r *http.Request, workspaceID string, cursor *time.Time, limit int) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `
		select i.id::text, i.identifier, i.number, i.title, i.description, i.team_id::text, i.state_id::text,
		       i.assignee_id, i.creator_id, i.priority::text, i.project_id::text, i.cycle_id::text,
		       i.created_at, i.updated_at, i.archived_at, i.completed_at, i.canceled_at
		from issue i
		join team t on t.id=i.team_id
		where t.workspace_id=$1::uuid and ($2::timestamp is null or i.updated_at>$2::timestamp)
		order by i.updated_at asc, i.id asc
		limit $3`, workspaceID, cursor, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows, []string{"id", "identifier", "number", "title", "description", "team_id", "state_id", "assignee_id", "creator_id", "priority", "project_id", "cycle_id", "created_at", "updated_at", "archived_at", "completed_at", "canceled_at"})
}

func (h Handler) readProjects(r *http.Request, workspaceID string, cursor *time.Time, limit int) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `
		select id::text, name, description, slug, status::text, priority::text, lead_id, workspace_id::text,
		       start_date, target_date, completed_at, canceled_at, created_at, updated_at
		from project
		where workspace_id=$1::uuid and ($2::timestamp is null or updated_at>$2::timestamp)
		order by updated_at asc, id asc
		limit $3`, workspaceID, cursor, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows, []string{"id", "name", "description", "slug", "status", "priority", "lead_id", "workspace_id", "start_date", "target_date", "completed_at", "canceled_at", "created_at", "updated_at"})
}

func (h Handler) readComments(r *http.Request, workspaceID string, cursor *time.Time, limit int) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `
		select c.id::text, c.body, c.issue_id::text, c.user_id, c.created_at, c.updated_at
		from comment c
		join issue i on i.id=c.issue_id
		join team t on t.id=i.team_id
		where t.workspace_id=$1::uuid and ($2::timestamp is null or c.updated_at>$2::timestamp)
		order by c.updated_at asc, c.id asc
		limit $3`, workspaceID, cursor, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows, []string{"id", "body", "issue_id", "user_id", "created_at", "updated_at"})
}

func (h Handler) readCycles(r *http.Request, workspaceID string, cursor *time.Time, limit int) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `
		select c.id::text, c.name, c.number, c.team_id::text, c.start_date, c.end_date, c.auto_rollover, c.created_at, c.updated_at
		from cycle c
		join team t on t.id=c.team_id
		where t.workspace_id=$1::uuid and ($2::timestamp is null or c.updated_at>$2::timestamp)
		order by c.updated_at asc, c.id asc
		limit $3`, workspaceID, cursor, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows, []string{"id", "name", "number", "team_id", "start_date", "end_date", "auto_rollover", "created_at", "updated_at"})
}

func (h Handler) readInitiatives(r *http.Request, workspaceID string, cursor *time.Time, limit int) ([]map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `
		select id::text, name, description, status::text, owner_id, workspace_id::text, start_date, target_date,
		       timeframe, health, parent_initiative_id::text, created_at, updated_at
		from initiative
		where workspace_id=$1::uuid and ($2::timestamp is null or updated_at>$2::timestamp)
		order by updated_at asc, id asc
		limit $3`, workspaceID, cursor, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows, []string{"id", "name", "description", "status", "owner_id", "workspace_id", "start_date", "target_date", "timeframe", "health", "parent_initiative_id", "created_at", "updated_at"})
}

func scanRows(rows pgx.Rows, fields []string) ([]map[string]any, error) {
	out := []map[string]any{}
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		record := map[string]any{}
		for i, field := range fields {
			record[field] = normalizeValue(values[i])
		}
		out = append(out, record)
	}
	return out, rows.Err()
}

func normalizeValue(value any) any {
	switch v := value.(type) {
	case time.Time:
		return v.UTC().Format(time.RFC3339Nano)
	default:
		return v
	}
}

func stringSchema() map[string]any { return map[string]any{"type": "string"} }
func dateTimeSchema() map[string]any {
	return map[string]any{"type": "string", "format": "date-time"}
}
func nullableSchema(kind string) map[string]any { return map[string]any{"type": []string{kind, "null"}} }
func nullableDateTimeSchema() map[string]any {
	return map[string]any{"type": []string{"string", "null"}, "format": "date-time"}
}

type errString string

func (e errString) Error() string { return string(e) }
