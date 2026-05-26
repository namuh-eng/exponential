package issuetemplates

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
	Type        string   `json:"type"`
	TeamID      *string  `json:"teamId"`
	Settings    Settings `json:"settings"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
}

type Settings struct {
	Title             string  `json:"title,omitempty"`
	Body              string  `json:"body,omitempty"`
	DefaultPriority   string  `json:"defaultPriority,omitempty"`
	DefaultStatusID   string  `json:"defaultStatusId,omitempty"`
	DefaultStatusName string  `json:"defaultStatusName,omitempty"`
	DefaultTeamID     string  `json:"defaultTeamId,omitempty"`
	DefaultTeamKey    string  `json:"defaultTeamKey,omitempty"`
	DefaultScope      string  `json:"defaultScope,omitempty"`
	DefaultProjectID  *string `json:"defaultProjectId,omitempty"`
	ArchivedAt        string  `json:"archivedAt,omitempty"`
}

type listResponse struct {
	Templates []Template `json:"templates"`
}
type templateResponse struct {
	Template Template `json:"template"`
}

type createRequest struct {
	Name            any `json:"name"`
	Description     any `json:"description"`
	Settings        any `json:"settings"`
	DuplicateFromID any `json:"duplicateFromId"`
}

type updateRequest struct {
	Name        any   `json:"name"`
	Description any   `json:"description"`
	Settings    any   `json:"settings"`
	Archived    *bool `json:"archived"`
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
	teamID, err := h.teamIDForKey(r.Context(), p.WorkspaceID, strings.TrimSpace(r.URL.Query().Get("teamKey")))
	if err != nil {
		problem.JSON(w, 200, listResponse{Templates: []Template{}})
		return
	}
	templates, err := h.list(r.Context(), p.WorkspaceID, teamID)
	if err != nil {
		problem.Write(w, 500, "List issue templates failed", err.Error())
		return
	}
	out := []Template{}
	for _, template := range templates {
		if template.Settings.ArchivedAt == "" {
			out = append(out, template)
		}
	}
	problem.JSON(w, 200, listResponse{Templates: out})
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input createRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	source, err := h.source(r.Context(), p.WorkspaceID, stringValue(input.DuplicateFromID))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Template not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create issue template failed", err.Error())
		return
	}
	name := stringValue(input.Name)
	if name == "" && source != nil {
		name = source.Name + " copy"
	}
	name = strings.TrimSpace(name)
	settings, err := normalizeSettings(firstValue(input.Settings, sourceSettings(source)))
	if err != nil {
		problem.Write(w, 400, err.Error(), "")
		return
	}
	description := strings.TrimSpace(stringValue(input.Description))
	if description == "" && source != nil {
		description = source.Description
	}
	if name == "" {
		problem.Write(w, 400, "Template name is required", "")
		return
	}
	if description == "" && settings.Body == "" {
		problem.Write(w, 400, "Issue description is required", "")
		return
	}
	if description == "" {
		description = settings.Body
	}
	body, _ := json.Marshal(settings)
	template, err := scanTemplate(h.DB.QueryRow(r.Context(), `
		insert into issue_template (name, description, template_type, workspace_id, team_id, created_by_id, settings)
		values ($1,$2,'issue',$3::uuid,null,$4,$5::jsonb)
		returning `+columns(), name, description, p.WorkspaceID, p.UserID, body))
	if err != nil {
		problem.Write(w, 500, "Create issue template failed", err.Error())
		return
	}
	problem.JSON(w, 201, templateResponse{Template: template})
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input updateRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	current, err := h.getWorkspaceTemplate(r.Context(), p.WorkspaceID, chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Template not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update issue template failed", err.Error())
		return
	}
	name := current.Name
	if input.Name != nil {
		name = strings.TrimSpace(stringValue(input.Name))
		if name == "" {
			problem.Write(w, 400, "Template name is required", "")
			return
		}
	}
	description := current.Description
	if input.Description != nil {
		description = strings.TrimSpace(stringValue(input.Description))
		if description == "" {
			problem.Write(w, 400, "Issue description is required", "")
			return
		}
	}
	settings := current.Settings
	if input.Settings != nil || input.Archived != nil {
		settings, err = normalizeSettings(input.Settings)
		if err != nil {
			problem.Write(w, 400, err.Error(), "")
			return
		}
		if input.Archived != nil && *input.Archived {
			settings.ArchivedAt = time.Now().UTC().Format(time.RFC3339)
		}
	}
	body, _ := json.Marshal(settings)
	template, err := scanTemplate(h.DB.QueryRow(r.Context(), `
		update issue_template set name=$1, description=$2, settings=$3::jsonb, updated_at=now()
		where id=$4::uuid and workspace_id=$5::uuid and team_id is null
		returning `+columns(), name, description, body, current.ID, p.WorkspaceID))
	if err != nil {
		problem.Write(w, 500, "Update issue template failed", err.Error())
		return
	}
	problem.JSON(w, 200, templateResponse{Template: template})
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	tag, err := h.DB.Exec(r.Context(), `delete from issue_template where id=$1::uuid and workspace_id=$2::uuid and team_id is null`, chi.URLParam(r, "id"), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Delete issue template failed", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		problem.Write(w, 404, "Template not found", "")
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) teamIDForKey(ctx context.Context, workspaceID, teamKey string) (*string, error) {
	if teamKey == "" {
		return nil, nil
	}
	var id string
	if err := h.DB.QueryRow(ctx, `select id::text from team where workspace_id=$1::uuid and key=$2 limit 1`, workspaceID, teamKey).Scan(&id); err != nil {
		return nil, err
	}
	return &id, nil
}

func (h Handler) list(ctx context.Context, workspaceID string, teamID *string) ([]Template, error) {
	where := `workspace_id=$1::uuid and template_type='issue' and team_id is null`
	args := []any{workspaceID}
	if teamID != nil {
		where = `workspace_id=$1::uuid and template_type='issue' and (team_id is null or team_id=$2::uuid)`
		args = append(args, *teamID)
	}
	rows, err := h.DB.Query(ctx, `select `+columns()+` from issue_template where `+where+` order by created_at desc`, args...)
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

func (h Handler) source(ctx context.Context, workspaceID, id string) (*Template, error) {
	if strings.TrimSpace(id) == "" {
		return nil, nil
	}
	template, err := scanTemplate(h.DB.QueryRow(ctx, `select `+columns()+` from issue_template where id=$1::uuid and workspace_id=$2::uuid and team_id is null limit 1`, id, workspaceID))
	if err != nil {
		return nil, err
	}
	return &template, nil
}

func (h Handler) getWorkspaceTemplate(ctx context.Context, workspaceID, id string) (Template, error) {
	return scanTemplate(h.DB.QueryRow(ctx, `select `+columns()+` from issue_template where id=$1::uuid and workspace_id=$2::uuid and team_id is null limit 1`, id, workspaceID))
}

func columns() string {
	return `id::text, name, description, template_type, team_id::text, coalesce(settings,'{}'::jsonb), created_at, updated_at`
}

type scanner interface{ Scan(dest ...any) error }

func scanTemplate(row scanner) (Template, error) {
	var template Template
	var settings []byte
	var createdAt time.Time
	var updatedAt time.Time
	if err := row.Scan(&template.ID, &template.Name, &template.Description, &template.Type, &template.TeamID, &settings, &createdAt, &updatedAt); err != nil {
		return Template{}, err
	}
	if template.Type == "" {
		template.Type = "issue"
	}
	normalized, err := normalizeSettings(settings)
	if err != nil {
		normalized = Settings{}
	}
	template.Settings = normalized
	template.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	template.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return template, nil
}

func normalizeSettings(value any) (Settings, error) {
	raw := map[string]any{}
	switch v := value.(type) {
	case nil:
	case []byte:
		_ = json.Unmarshal(v, &raw)
	case map[string]any:
		raw = v
	default:
		encoded, _ := json.Marshal(v)
		_ = json.Unmarshal(encoded, &raw)
	}
	settings := Settings{}
	for key, assign := range map[string]func(string){
		"title":             func(v string) { settings.Title = v },
		"body":              func(v string) { settings.Body = v },
		"defaultStatusId":   func(v string) { settings.DefaultStatusID = v },
		"defaultStatusName": func(v string) { settings.DefaultStatusName = v },
		"defaultTeamId":     func(v string) { settings.DefaultTeamID = v },
		"defaultTeamKey":    func(v string) { settings.DefaultTeamKey = v },
		"defaultScope":      func(v string) { settings.DefaultScope = v },
		"archivedAt":        func(v string) { settings.ArchivedAt = v },
	} {
		if value, ok := raw[key].(string); ok {
			assign(strings.TrimSpace(value))
		}
	}
	if value, ok := raw["defaultPriority"].(string); ok {
		priority := strings.ToLower(strings.TrimSpace(value))
		if !validPriority(priority) {
			return Settings{}, errors.New("Invalid default priority")
		}
		if priority != "" {
			settings.DefaultPriority = priority
		}
	}
	if raw["defaultProjectId"] == nil {
		// Omit absent values; explicit null is indistinguishable after map lookup.
	} else if value, ok := raw["defaultProjectId"].(string); ok {
		trimmed := strings.TrimSpace(value)
		settings.DefaultProjectID = &trimmed
	} else {
		settings.DefaultProjectID = nil
	}
	return settings, nil
}

func validPriority(value string) bool {
	switch value {
	case "urgent", "high", "medium", "low", "none", "":
		return true
	default:
		return false
	}
}

func stringValue(value any) string {
	if s, ok := value.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}

func firstValue(value any, fallback any) any {
	if value != nil {
		return value
	}
	return fallback
}

func sourceSettings(source *Template) any {
	if source == nil {
		return map[string]any{}
	}
	return source.Settings
}
