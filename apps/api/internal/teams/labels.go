package teams

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type teamLabel struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Color         string  `json:"color"`
	Description   *string `json:"description"`
	ParentLabelID *string `json:"parentLabelId"`
	CreatedAt     string  `json:"createdAt,omitempty"`
	UpdatedAt     string  `json:"updatedAt,omitempty"`
}

type teamLabelsResponse struct {
	Labels []teamLabel `json:"labels"`
}

type teamLabelResponse struct {
	Label teamLabel `json:"label"`
}

type teamLabelRequest struct {
	Name          *string `json:"name"`
	Color         *string `json:"color"`
	Description   *string `json:"description"`
	ParentLabelID *string `json:"parentLabelId"`
}

func (h Handler) ListLabels(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeam(r, chi.URLParam(r, "key"), false)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "List team labels failed", err.Error())
		return
	}
	rows, err := h.DB.Query(r.Context(), `select id::text,name,color,description,parent_label_id::text,created_at,updated_at from label where workspace_id=$1::uuid and team_id=$2::uuid and archived_at is null order by name`, p.WorkspaceID, team.ID)
	if err != nil {
		problem.Write(w, 500, "List team labels failed", err.Error())
		return
	}
	defer rows.Close()
	items := []teamLabel{}
	for rows.Next() {
		item, err := scanTeamLabel(rows)
		if err != nil {
			problem.Write(w, 500, "List team labels failed", err.Error())
			return
		}
		items = append(items, item)
	}
	problem.JSON(w, 200, teamLabelsResponse{Labels: items})
}

func (h Handler) CreateLabel(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeam(r, chi.URLParam(r, "key"), false)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create team label failed", err.Error())
		return
	}
	var input teamLabelRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := strings.TrimSpace(teamLabelValue(input.Name))
	if name == "" {
		problem.Write(w, 400, "Name is required", "")
		return
	}
	color := normalizeTeamLabelColor(teamLabelValue(input.Color))
	description := nullIfEmpty(teamLabelValue(input.Description))
	parentID := nullIfEmpty(teamLabelValue(input.ParentLabelID))
	if parentID != nil && !h.teamLabelExists(r, p.WorkspaceID, team.ID, *parentID) {
		problem.Write(w, 400, "Parent label must belong to the same team", "")
		return
	}
	label, err := scanTeamLabel(h.DB.QueryRow(r.Context(), `insert into label (name,color,description,workspace_id,team_id,parent_label_id) values ($1,$2,$3,$4::uuid,$5::uuid,$6::uuid) returning id::text,name,color,description,parent_label_id::text,created_at,updated_at`, name, color, description, p.WorkspaceID, team.ID, parentID))
	if err != nil {
		problem.Write(w, 500, "Create team label failed", err.Error())
		return
	}
	problem.JSON(w, 201, teamLabelResponse{Label: label})
}

func (h Handler) UpdateLabel(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeam(r, chi.URLParam(r, "key"), false)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update team label failed", err.Error())
		return
	}
	var input teamLabelRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	current, err := h.findTeamLabel(r, p.WorkspaceID, team.ID, chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Label not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update team label failed", err.Error())
		return
	}
	name := current.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
		if name == "" {
			problem.Write(w, 400, "Name is required", "")
			return
		}
	}
	color := current.Color
	if input.Color != nil {
		color = normalizeTeamLabelColor(*input.Color)
	}
	description := current.Description
	if input.Description != nil {
		description = nullIfEmpty(*input.Description)
	}
	parentID := current.ParentLabelID
	if input.ParentLabelID != nil {
		parentID = nullIfEmpty(*input.ParentLabelID)
	}
	if parentID != nil && *parentID == current.ID {
		problem.Write(w, 400, "Label cannot be its own parent", "")
		return
	}
	if parentID != nil && !h.teamLabelExists(r, p.WorkspaceID, team.ID, *parentID) {
		problem.Write(w, 400, "Parent label must belong to the same team", "")
		return
	}
	updated, err := scanTeamLabel(h.DB.QueryRow(r.Context(), `update label set name=$1,color=$2,description=$3,parent_label_id=$4::uuid,updated_at=now() where id=$5::uuid and workspace_id=$6::uuid and team_id=$7::uuid returning id::text,name,color,description,parent_label_id::text,created_at,updated_at`, name, color, description, parentID, current.ID, p.WorkspaceID, team.ID))
	if err != nil {
		problem.Write(w, 500, "Update team label failed", err.Error())
		return
	}
	problem.JSON(w, 200, teamLabelResponse{Label: updated})
}

func (h Handler) DeleteLabel(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeam(r, chi.URLParam(r, "key"), false)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete team label failed", err.Error())
		return
	}
	ct, err := h.DB.Exec(r.Context(), `update label set archived_at=now(), updated_at=now() where id=$1::uuid and workspace_id=$2::uuid and team_id=$3::uuid`, chi.URLParam(r, "id"), p.WorkspaceID, team.ID)
	if err != nil {
		problem.Write(w, 500, "Delete team label failed", err.Error())
		return
	}
	if ct.RowsAffected() == 0 {
		problem.Write(w, 404, "Label not found", "")
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) findTeamLabel(r *http.Request, workspaceID, teamID, id string) (teamLabel, error) {
	return scanTeamLabel(h.DB.QueryRow(r.Context(), `select id::text,name,color,description,parent_label_id::text,created_at,updated_at from label where id=$1::uuid and workspace_id=$2::uuid and team_id=$3::uuid and archived_at is null limit 1`, id, workspaceID, teamID))
}

func (h Handler) teamLabelExists(r *http.Request, workspaceID, teamID, id string) bool {
	var exists bool
	_ = h.DB.QueryRow(r.Context(), `select exists(select 1 from label where id=$1::uuid and workspace_id=$2::uuid and team_id=$3::uuid and archived_at is null)`, id, workspaceID, teamID).Scan(&exists)
	return exists
}

func scanTeamLabel(row scanner) (teamLabel, error) {
	var item teamLabel
	var created, updated time.Time
	if err := row.Scan(&item.ID, &item.Name, &item.Color, &item.Description, &item.ParentLabelID, &created, &updated); err != nil {
		return teamLabel{}, err
	}
	item.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	item.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
	return item, nil
}

func normalizeTeamLabelColor(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) == 7 && strings.HasPrefix(trimmed, "#") {
		return trimmed
	}
	return "#6b6f76"
}

func teamLabelValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
