package teams

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type contextTeam struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Key          string  `json:"key"`
	ParentTeamID *string `json:"parentTeamId"`
	RetiredAt    *string `json:"retiredAt"`
}

type teamContextResponse struct {
	WorkspaceName     string        `json:"workspaceName"`
	WorkspaceSlug     string        `json:"workspaceSlug"`
	WorkspaceID       string        `json:"workspaceId"`
	TeamID            string        `json:"teamId"`
	TeamName          string        `json:"teamName"`
	TeamKey           string        `json:"teamKey"`
	WorkspaceInitials string        `json:"workspaceInitials"`
	Teams             []contextTeam `json:"teams"`
}

type displayOptionsResponse struct {
	DisplayOptions any `json:"displayOptions"`
}

type displayOptionsRequest struct {
	DisplayOptions any `json:"displayOptions"`
}

type teamRecordForSettings struct {
	ID          string
	Name        string
	Key         string
	WorkspaceID string
	Settings    map[string]any
}

func (h Handler) Context(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeamRecord(r, p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load team context failed", err.Error())
		return
	}
	var workspaceName, workspaceSlug string
	if err := h.DB.QueryRow(r.Context(), `select name, url_slug from workspace where id=$1::uuid limit 1`, team.WorkspaceID).Scan(&workspaceName, &workspaceSlug); err != nil {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	rows, err := h.DB.Query(r.Context(), `select id::text, name, key, parent_team_id::text, retired_at::text from team where workspace_id=$1::uuid and deleted_at is null and retired_at is null order by name asc`, team.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Load team context failed", err.Error())
		return
	}
	defer rows.Close()
	teams := []contextTeam{}
	for rows.Next() {
		var item contextTeam
		if err := rows.Scan(&item.ID, &item.Name, &item.Key, &item.ParentTeamID, &item.RetiredAt); err != nil {
			problem.Write(w, 500, "Load team context failed", err.Error())
			return
		}
		teams = append(teams, item)
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, 500, "Load team context failed", err.Error())
		return
	}
	problem.JSON(w, 200, teamContextResponse{WorkspaceName: workspaceName, WorkspaceSlug: workspaceSlug, WorkspaceID: team.WorkspaceID, TeamID: team.ID, TeamName: team.Name, TeamKey: team.Key, WorkspaceInitials: initials(workspaceName), Teams: teams})
}

func (h Handler) GetDisplayOptions(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeamRecord(r, p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load display options failed", err.Error())
		return
	}
	problem.JSON(w, 200, displayOptionsResponse{DisplayOptions: team.Settings["displayOptions"]})
}

func (h Handler) UpdateDisplayOptions(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeamRecord(r, p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update display options failed", err.Error())
		return
	}
	var input displayOptionsRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	settings := team.Settings
	if settings == nil {
		settings = map[string]any{}
	}
	settings["displayOptions"] = input.DisplayOptions
	raw, _ := json.Marshal(settings)
	if _, err := h.DB.Exec(r.Context(), `update team set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, team.ID); err != nil {
		problem.Write(w, 500, "Update display options failed", err.Error())
		return
	}
	problem.JSON(w, 200, displayOptionsResponse{DisplayOptions: input.DisplayOptions})
}

func (h Handler) findTeamRecord(r *http.Request, workspaceID, key string) (teamRecordForSettings, error) {
	var team teamRecordForSettings
	var settingsRaw []byte
	err := h.DB.QueryRow(r.Context(), `select id::text, name, key, workspace_id::text, coalesce(settings,'{}'::jsonb) from team where workspace_id=$1::uuid and key=$2 and deleted_at is null limit 1`, workspaceID, key).Scan(&team.ID, &team.Name, &team.Key, &team.WorkspaceID, &settingsRaw)
	if err != nil {
		return team, err
	}
	team.Settings = map[string]any{}
	_ = json.Unmarshal(settingsRaw, &team.Settings)
	return team, nil
}

func initials(value string) string {
	runes := []rune(value)
	if len(runes) > 2 {
		runes = runes[:2]
	}
	return strings.ToUpper(string(runes))
}
