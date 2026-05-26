package projecttemplates

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
)

type Handler struct{ DB *pgxpool.Pool }

type Template struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Settings    Settings `json:"settings"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
}

type Settings struct {
	Status     *string  `json:"status"`
	Priority   *string  `json:"priority"`
	LabelIDs   []string `json:"labelIds"`
	Milestones []string `json:"milestones"`
}

type listResponse struct {
	Templates []Template `json:"templates"`
}

type templateResponse struct {
	Template Template `json:"template"`
}

type request struct {
	Name        any      `json:"name"`
	Description any      `json:"description"`
	Settings    Settings `json:"settings"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Patch("/{id}", h.Update)
	r.Delete("/{id}", h.Delete)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	templates, err := h.list(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List project templates failed", err.Error())
		return
	}
	problem.JSON(w, 200, listResponse{Templates: templates})
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	input, ok := readRequest(w, r)
	if !ok {
		return
	}
	name := normalizeName(input.Name)
	if name == "" {
		problem.Write(w, 400, "Template name is required", "")
		return
	}
	description := normalizeDescription(input.Description)
	settings := normalizeSettings(input.Settings)
	body, _ := json.Marshal(settings)
	template, err := scanTemplate(h.DB.QueryRow(r.Context(), `
		insert into project_template (name, description, workspace_id, created_by_id, settings)
		values ($1,$2,$3::uuid,$4,$5::jsonb)
		returning id::text, name, description, coalesce(settings,'{}'::jsonb), created_at, updated_at`, name, description, p.WorkspaceID, p.UserID, body))
	if err != nil {
		problem.Write(w, 500, "Create project template failed", err.Error())
		return
	}
	problem.JSON(w, 201, templateResponse{Template: template})
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	input, ok := readRequest(w, r)
	if !ok {
		return
	}
	name := normalizeName(input.Name)
	if name == "" {
		problem.Write(w, 400, "Template name is required", "")
		return
	}
	description := normalizeDescription(input.Description)
	settings := normalizeSettings(input.Settings)
	body, _ := json.Marshal(settings)
	template, err := scanTemplate(h.DB.QueryRow(r.Context(), `
		update project_template
		set name=$1, description=$2, settings=$3::jsonb, updated_at=now()
		where id=$4::uuid and workspace_id=$5::uuid
		returning id::text, name, description, coalesce(settings,'{}'::jsonb), created_at, updated_at`, name, description, body, chi.URLParam(r, "id"), p.WorkspaceID))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Project template not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update project template failed", err.Error())
		return
	}
	problem.JSON(w, 200, templateResponse{Template: template})
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	tag, err := h.DB.Exec(r.Context(), `delete from project_template where id=$1::uuid and workspace_id=$2::uuid`, chi.URLParam(r, "id"), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Delete project template failed", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		problem.Write(w, 404, "Project template not found", "")
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) list(ctx context.Context, workspaceID string) ([]Template, error) {
	rows, err := h.DB.Query(ctx, `
		select id::text, name, description, coalesce(settings,'{}'::jsonb), created_at, updated_at
		from project_template
		where workspace_id=$1::uuid
		order by created_at desc`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	templates := []Template{}
	for rows.Next() {
		template, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		templates = append(templates, template)
	}
	return templates, rows.Err()
}

type scanner interface{ Scan(dest ...any) error }

func scanTemplate(row scanner) (Template, error) {
	var template Template
	var description *string
	var settings []byte
	var createdAt time.Time
	var updatedAt time.Time
	if err := row.Scan(&template.ID, &template.Name, &description, &settings, &createdAt, &updatedAt); err != nil {
		return Template{}, err
	}
	if description != nil {
		template.Description = *description
	}
	template.Settings = readSettings(settings)
	template.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	template.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return template, nil
}

func readRequest(w http.ResponseWriter, r *http.Request) (request, bool) {
	var input request
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return request{}, false
	}
	return input, true
}

func normalizeName(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(strings.ReplaceAll(toString(value), "\x00", ""))
}

func normalizeDescription(value any) *string {
	if value == nil {
		return nil
	}
	description := strings.TrimSpace(toString(value))
	if description == "" {
		return nil
	}
	return &description
}

func normalizeSettings(settings Settings) Settings {
	return Settings{Status: normalizeEnum(settings.Status, []string{"planned", "started", "paused", "completed", "canceled"}), Priority: normalizeEnum(settings.Priority, []string{"none", "urgent", "high", "medium", "low"}), LabelIDs: uniqueStrings(settings.LabelIDs), Milestones: uniqueStrings(settings.Milestones)}
}

func readSettings(raw []byte) Settings {
	var settings Settings
	_ = json.Unmarshal(raw, &settings)
	return normalizeSettings(settings)
}

func normalizeEnum(value *string, allowed []string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	for _, option := range allowed {
		if trimmed == option {
			return &trimmed
		}
	}
	return nil
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		out = append(out, trimmed)
	}
	return out
}

func toString(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}
