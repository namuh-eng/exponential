package projectstatuses

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type ProjectStatus struct {
	ID           string `json:"id"`
	Key          string `json:"key"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	Color        string `json:"color"`
	Icon         string `json:"icon"`
	Position     int    `json:"position"`
	IsDefault    bool   `json:"isDefault"`
	ProjectCount int32  `json:"projectCount"`
}

type response struct {
	Statuses                []ProjectStatus `json:"statuses"`
	TotalProjects           int32           `json:"totalProjects"`
	ReadOnly                bool            `json:"readOnly"`
	CustomStatusesSupported bool            `json:"customStatusesSupported"`
	CanManage               bool            `json:"canManage"`
}

type patchRequest struct {
	Statuses []ProjectStatus `json:"statuses"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.Get)
	r.Patch("/", h.Update)
	return r
}

func (h Handler) Get(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, role, err := h.workspaceAccess(r.Context(), p)
	if errors.Is(err, pgx.ErrNoRows) {
		statuses := withCounts(defaultStatuses(), map[string]int32{})
		problem.JSON(w, 200, response{Statuses: statuses, ReadOnly: false, CustomStatusesSupported: true, CanManage: false})
		return
	}
	if err != nil {
		problem.Write(w, 500, "Unable to load project statuses", err.Error())
		return
	}
	counts, err := h.projectCounts(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Unable to load project statuses", err.Error())
		return
	}
	statuses := withCounts(readStatuses(settings), counts)
	problem.JSON(w, 200, response{Statuses: statuses, TotalProjects: total(statuses), ReadOnly: false, CustomStatusesSupported: true, CanManage: canManage(role)})
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, role, err := h.workspaceAccess(r.Context(), p)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "No workspace", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update project statuses failed", err.Error())
		return
	}
	if !canManage(role) {
		problem.Write(w, 403, "Only workspace admins can manage project statuses", "")
		return
	}
	var input patchRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	counts, err := h.projectCounts(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Update project statuses failed", err.Error())
		return
	}
	validated, msg := validate(input.Statuses, counts)
	if msg != "" {
		problem.Write(w, 400, msg, "")
		return
	}
	next := asMap(settings)
	next["projectStatuses"] = serialize(validated)
	body, _ := json.Marshal(next)
	if _, err := h.DB.Exec(r.Context(), `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, body, p.WorkspaceID); err != nil {
		problem.Write(w, 500, "Update project statuses failed", err.Error())
		return
	}
	statuses := withCounts(validated, counts)
	problem.JSON(w, 200, response{Statuses: statuses, TotalProjects: total(statuses), ReadOnly: false, CustomStatusesSupported: true, CanManage: true})
}

func (h Handler) workspaceAccess(ctx context.Context, p auth.Principal) ([]byte, string, error) {
	var settings []byte
	var role string
	err := h.DB.QueryRow(ctx, `select coalesce(w.settings,'{}'::jsonb), m.role::text from workspace w join member m on m.workspace_id=w.id and m.user_id=$1 where w.id=$2::uuid`, p.UserID, p.WorkspaceID).Scan(&settings, &role)
	return settings, role, err
}

func (h Handler) projectCounts(ctx context.Context, workspaceID string) (map[string]int32, error) {
	rows, err := h.DB.Query(ctx, `select status::text, coalesce(settings,'{}'::jsonb) from project where workspace_id=$1::uuid`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int32{}
	for rows.Next() {
		var status string
		var settings []byte
		if err := rows.Scan(&status, &settings); err != nil {
			return nil, err
		}
		key := projectStatusKey(settings, status)
		counts[key]++
	}
	return counts, rows.Err()
}

func projectStatusKey(settings []byte, fallback string) string {
	m := asMap(settings)
	if key, ok := m["projectStatusKey"].(string); ok && strings.TrimSpace(key) != "" {
		return key
	}
	return fallback
}

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func readStatuses(settings []byte) []ProjectStatus {
	m := asMap(settings)
	values, ok := m["projectStatuses"].([]any)
	if !ok || len(values) == 0 {
		return defaultStatuses()
	}
	byKey := map[string]ProjectStatus{}
	for _, status := range defaultStatuses() {
		byKey[status.Key] = status
	}
	for _, value := range values {
		rec, ok := value.(map[string]any)
		if !ok {
			continue
		}
		id := strings.TrimSpace(stringValue(rec["id"]))
		key := strings.TrimSpace(stringValue(rec["key"]))
		if key == "" {
			key = id
		}
		name := strings.TrimSpace(stringValue(rec["name"]))
		if key == "" || name == "" {
			continue
		}
		color := strings.TrimSpace(stringValue(rec["color"]))
		if !hexColor.MatchString(color) {
			color = "#6b6f76"
		}
		icon := strings.TrimSpace(stringValue(rec["icon"]))
		if icon == "" {
			icon = "•"
		}
		if len([]rune(icon)) > 4 {
			icon = string([]rune(icon)[:4])
		}
		position := intValue(rec["position"], len(byKey))
		status := ProjectStatus{ID: idOrKey(id, key), Key: key, Name: name, Description: strings.TrimSpace(stringValue(rec["description"])), Color: color, Icon: icon, Position: position}
		status.IsDefault = isDefault(status.Key)
		byKey[status.Key] = status
	}
	out := make([]ProjectStatus, 0, len(byKey))
	for _, status := range byKey {
		out = append(out, status)
	}
	sortStatuses(out)
	for i := range out {
		out[i].Position = i
	}
	return out
}

func defaultStatuses() []ProjectStatus {
	return []ProjectStatus{
		{ID: "planned", Key: "planned", Name: "Planned", Description: "Projects that are proposed or scheduled but not active yet.", Color: "#6b6f76", Icon: "○", Position: 0, IsDefault: true},
		{ID: "started", Key: "started", Name: "In progress", Description: "Projects that are actively being worked on.", Color: "#b58900", Icon: "◐", Position: 1, IsDefault: true},
		{ID: "paused", Key: "paused", Name: "Paused", Description: "Projects that are temporarily on hold.", Color: "#6b6f76", Icon: "Ⅱ", Position: 2, IsDefault: true},
		{ID: "completed", Key: "completed", Name: "Completed", Description: "Projects that have reached their intended outcome.", Color: "#2e7d32", Icon: "✓", Position: 3, IsDefault: true},
		{ID: "canceled", Key: "canceled", Name: "Canceled", Description: "Projects that are no longer planned to continue.", Color: "#6b6f76", Icon: "×", Position: 4, IsDefault: true},
	}
}

func withCounts(statuses []ProjectStatus, counts map[string]int32) []ProjectStatus {
	out := make([]ProjectStatus, len(statuses))
	copy(out, statuses)
	for i := range out {
		out[i].ProjectCount = counts[out[i].Key]
	}
	return out
}
func total(statuses []ProjectStatus) int32 {
	var n int32
	for _, s := range statuses {
		n += s.ProjectCount
	}
	return n
}
func canManage(role string) bool { return role == "owner" || role == "admin" }
func isDefault(key string) bool {
	return key == "planned" || key == "started" || key == "paused" || key == "completed" || key == "canceled"
}
func validate(statuses []ProjectStatus, counts map[string]int32) ([]ProjectStatus, string) {
	if len(statuses) < len(defaultStatuses()) {
		return nil, "Default project statuses cannot be removed."
	}
	if len(statuses) > 30 {
		return nil, "Project statuses are limited to 30."
	}
	seen := map[string]bool{}
	out := []ProjectStatus{}
	for i, s := range statuses {
		s.ID = strings.TrimSpace(s.ID)
		s.Key = slugify(strings.TrimSpace(valueOrString(s.Key, s.ID)))
		s.Name = strings.TrimSpace(s.Name)
		s.Description = strings.TrimSpace(s.Description)
		if s.Name == "" {
			return nil, "Status name is required."
		}
		if len(s.Name) > 60 {
			return nil, "Status names must be 60 characters or fewer."
		}
		if len(s.Description) > 180 {
			return nil, "Status descriptions must be 180 characters or fewer."
		}
		if s.Key == "" {
			s.Key = slugify(s.Name)
		}
		if s.ID == "" {
			s.ID = s.Key
		}
		s.ID = slugify(s.ID)
		if s.Key == "" || s.ID == "" {
			return nil, "Status key is required."
		}
		if seen[s.Key] {
			return nil, "Status names and keys must be unique."
		}
		if !hexColor.MatchString(s.Color) {
			return nil, "Status color must be a hex color."
		}
		s.Icon = strings.TrimSpace(s.Icon)
		if s.Icon == "" || len([]rune(s.Icon)) > 4 {
			return nil, "Status icon is required and must be short."
		}
		if isDefault(s.Key) {
			s.ID = s.Key
		}
		s.IsDefault = isDefault(s.Key)
		s.Position = i
		seen[s.Key] = true
		out = append(out, s)
	}
	for _, defaultStatus := range defaultStatuses() {
		if !seen[defaultStatus.Key] {
			if counts[defaultStatus.Key] > 0 {
				return nil, defaultStatus.Name + " cannot be removed while projects use it."
			}
			return nil, "Default project statuses cannot be removed."
		}
	}
	for key, count := range counts {
		if count > 0 && !seen[key] {
			return nil, "Project statuses with assigned projects cannot be removed."
		}
	}
	return out, ""
}
func serialize(statuses []ProjectStatus) []map[string]any {
	out := []map[string]any{}
	for i, s := range statuses {
		out = append(out, map[string]any{"id": s.ID, "key": s.Key, "name": s.Name, "description": s.Description, "color": s.Color, "icon": s.Icon, "position": i, "isDefault": s.IsDefault})
	}
	return out
}
func asMap(raw []byte) map[string]any { m := map[string]any{}; _ = json.Unmarshal(raw, &m); return m }
func stringValue(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
func sortStatuses(statuses []ProjectStatus) {
	sort.Slice(statuses, func(i, j int) bool { return statuses[i].Position < statuses[j].Position })
}

func idOrKey(id, key string) string {
	if id != "" {
		return id
	}
	return key
}

func intValue(v any, fallback int) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return fallback
	}
}

func valueOrString(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func slugify(value string) string {
	value = strings.ToLower(value)
	var b strings.Builder
	lastUnderscore := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			b.WriteByte('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(strings.TrimSpace(b.String()), "_")
}
