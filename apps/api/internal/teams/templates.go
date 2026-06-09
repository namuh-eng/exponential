package teams

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type teamTemplate struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Settings    map[string]any `json:"settings"`
	CreatedAt   string         `json:"createdAt"`
	UpdatedAt   string         `json:"updatedAt"`
}

func (h Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	team, ok := h.requireTeamAccess(w, r, false)
	if !ok {
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		select id::text, name, description, coalesce(settings,'{}'::jsonb), created_at, updated_at
		from issue_template
		where workspace_id=$1::uuid
		  and template_type='issue'
		  and (
		    team_id=$2::uuid
		    or (team_id is null and (settings->>'defaultTeamId'=$4 or upper(settings->>'defaultTeamKey')=upper($3)))
		  )
		  and nullif(settings->>'archivedAt','') is null
		order by created_at desc`, team.WorkspaceID, team.ID, team.Key, team.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "List team templates failed", err.Error())
		return
	}
	defer rows.Close()
	templates := []teamTemplate{}
	for rows.Next() {
		template, err := scanTeamTemplate(rows)
		if err != nil {
			problem.Write(w, http.StatusInternalServerError, "List team templates failed", err.Error())
			return
		}
		templates = append(templates, template)
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "List team templates failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]any{"team": map[string]string{"name": team.Name, "key": team.Key}, "templates": templates})
}

func (h Handler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	team, ok := h.requireTeamAccess(w, r, true)
	if !ok {
		return
	}
	body, ok := readTemplateBody(w, r)
	if !ok {
		return
	}
	name := strings.TrimSpace(stringFromAny(body["name"], ""))
	description := strings.TrimSpace(stringFromAny(body["description"], ""))
	settings := normalizeTeamTemplateSettings(body["settings"], team)
	if name == "" {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Template name is required"})
		return
	}
	if description == "" {
		description = strings.TrimSpace(stringFromAny(settings["body"], ""))
	}
	if description == "" {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Issue description is required"})
		return
	}
	raw, _ := json.Marshal(settings)
	template, err := scanTeamTemplate(h.DB.QueryRow(r.Context(), `
		insert into issue_template (name, description, template_type, workspace_id, team_id, created_by_id, settings)
		values ($1,$2,'issue',$3::uuid,$4::uuid,$5,$6::jsonb)
		returning id::text, name, description, coalesce(settings,'{}'::jsonb), created_at, updated_at`, name, description, team.WorkspaceID, team.ID, currentUserIDForTemplates(r), raw))
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create team template failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusCreated, map[string]teamTemplate{"template": template})
}

func (h Handler) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	team, ok := h.requireTeamAccess(w, r, true)
	if !ok {
		return
	}
	body, ok := readTemplateBody(w, r)
	if !ok {
		return
	}
	id := strings.TrimSpace(stringFromAny(body["id"], ""))
	if id == "" {
		problem.JSON(w, http.StatusNotFound, map[string]string{"error": "Template not found"})
		return
	}
	name := strings.TrimSpace(stringFromAny(body["name"], ""))
	description := strings.TrimSpace(stringFromAny(body["description"], ""))
	settings := normalizeTeamTemplateSettings(body["settings"], team)
	if name == "" {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Template name is required"})
		return
	}
	if description == "" {
		description = strings.TrimSpace(stringFromAny(settings["body"], ""))
	}
	if description == "" {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Issue description is required"})
		return
	}
	raw, _ := json.Marshal(settings)
	template, err := scanTeamTemplate(h.DB.QueryRow(r.Context(), `
		update issue_template set name=$1, description=$2, settings=$3::jsonb, updated_at=now()
		where id=$4::uuid and workspace_id=$5::uuid and (team_id=$6::uuid or (team_id is null and (settings->>'defaultTeamId'=$8 or upper(settings->>'defaultTeamKey')=upper($7))))
		returning id::text, name, description, coalesce(settings,'{}'::jsonb), created_at, updated_at`, name, description, raw, id, team.WorkspaceID, team.ID, team.Key, team.ID))
	if err == pgx.ErrNoRows {
		problem.JSON(w, http.StatusNotFound, map[string]string{"error": "Template not found"})
		return
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Update team template failed", err.Error())
		return
	}
	problem.JSON(w, http.StatusOK, map[string]teamTemplate{"template": template})
}

func (h Handler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	team, ok := h.requireTeamAccess(w, r, true)
	if !ok {
		return
	}
	body, ok := readTemplateBody(w, r)
	if !ok {
		return
	}
	id := strings.TrimSpace(stringFromAny(body["id"], ""))
	if id == "" {
		problem.JSON(w, http.StatusNotFound, map[string]string{"error": "Template not found"})
		return
	}
	result, err := h.DB.Exec(r.Context(), `delete from issue_template where id=$1::uuid and workspace_id=$2::uuid and (team_id=$3::uuid or (team_id is null and (settings->>'defaultTeamId'=$5 or upper(settings->>'defaultTeamKey')=upper($4))))`, id, team.WorkspaceID, team.ID, team.Key, team.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Delete team template failed", err.Error())
		return
	}
	if result.RowsAffected() == 0 {
		problem.JSON(w, http.StatusNotFound, map[string]string{"error": "Template not found"})
		return
	}
	problem.JSON(w, http.StatusOK, map[string]bool{"success": true})
}

func readTemplateBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.JSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
		return nil, false
	}
	return body, true
}

func normalizeTeamTemplateSettings(value any, team teamRecord) map[string]any {
	settings := map[string]any{}
	if raw, ok := value.(map[string]any); ok {
		for k, v := range raw {
			settings[k] = v
		}
	} else if value != nil {
		encoded, _ := json.Marshal(value)
		_ = json.Unmarshal(encoded, &settings)
	}
	settings["defaultTeamId"] = team.ID
	settings["defaultTeamKey"] = team.Key
	return settings
}

func scanTeamTemplate(row scanner) (teamTemplate, error) {
	var template teamTemplate
	var raw []byte
	var createdAt time.Time
	var updatedAt time.Time
	if err := row.Scan(&template.ID, &template.Name, &template.Description, &raw, &createdAt, &updatedAt); err != nil {
		return teamTemplate{}, err
	}
	template.Settings = map[string]any{}
	_ = json.Unmarshal(raw, &template.Settings)
	template.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	template.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return template, nil
}

func currentUserIDForTemplates(r *http.Request) string {
	p, _ := auth.FromContext(r.Context())
	return p.UserID
}
