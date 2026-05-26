package initiatives

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type UserSummary struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Image *string `json:"image"`
}

type TeamSummary struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Key  string  `json:"key"`
	Icon *string `json:"icon"`
}

type Initiative struct {
	ID                        string           `json:"id"`
	Name                      string           `json:"name"`
	Description               *string          `json:"description"`
	Status                    string           `json:"status"`
	OwnerID                   *string          `json:"ownerId"`
	Owner                     *UserSummary     `json:"owner,omitempty"`
	Teams                     []TeamSummary    `json:"teams"`
	StartDate                 *string          `json:"startDate"`
	TargetDate                *string          `json:"targetDate"`
	Timeframe                 *string          `json:"timeframe"`
	Health                    string           `json:"health"`
	Settings                  map[string]any   `json:"settings,omitempty"`
	WorkspaceID               string           `json:"workspaceId"`
	ParentInitiativeID        *string          `json:"parentInitiativeId"`
	ParentInitiative          *miniInitiative  `json:"parentInitiative,omitempty"`
	ChildInitiatives          []miniInitiative `json:"childInitiatives"`
	ProjectCount              int              `json:"projectCount,omitempty"`
	CompletedProjectCount     int              `json:"completedProjectCount,omitempty"`
	LatestUpdate              any              `json:"latestUpdate,omitempty"`
	ActiveProjectHealthRollup any              `json:"activeProjectHealthRollup,omitempty"`
	CreatedAt                 string           `json:"createdAt"`
	UpdatedAt                 string           `json:"updatedAt"`
}

type activeProjectHealthRollup struct {
	Total          int `json:"total"`
	WithUpdates    int `json:"withUpdates"`
	WithoutUpdates int `json:"withoutUpdates"`
	Paused         int `json:"paused"`
}

type miniInitiative struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Status             string  `json:"status,omitempty"`
	ParentInitiativeID *string `json:"parentInitiativeId,omitempty"`
}

type projectSummary struct {
	ID                  string  `json:"id"`
	Name                string  `json:"name"`
	Status              string  `json:"status"`
	Icon                *string `json:"icon"`
	Slug                string  `json:"slug,omitempty"`
	IssueCount          int32   `json:"issueCount,omitempty"`
	CompletedIssueCount int32   `json:"completedIssueCount,omitempty"`
}

type workspaceInitiativeSettings struct {
	Enabled        bool   `json:"enabled"`
	ProjectRollups bool   `json:"projectRollups"`
	Visibility     string `json:"visibility"`
	RoadmapMode    string `json:"roadmapMode"`
}

type listResponse struct {
	Initiatives         []Initiative                `json:"initiatives"`
	WorkspaceMembers    []UserSummary               `json:"workspaceMembers"`
	WorkspaceTeams      []TeamSummary               `json:"workspaceTeams"`
	InitiativesSettings workspaceInitiativeSettings `json:"initiativesSettings"`
}

type detailResponse struct {
	Initiative                 Initiative       `json:"initiative"`
	Projects                   []projectSummary `json:"projects"`
	AvailableProjects          []projectSummary `json:"availableProjects"`
	WorkspaceMembers           []UserSummary    `json:"workspaceMembers"`
	WorkspaceTeams             []TeamSummary    `json:"workspaceTeams"`
	AvailableParentInitiatives []miniInitiative `json:"availableParentInitiatives"`
	Updates                    []any            `json:"updates"`
	Activity                   []any            `json:"activity"`
}

type createRequest struct {
	Name               string   `json:"name"`
	Description        *string  `json:"description"`
	Status             *string  `json:"status"`
	Health             *string  `json:"health"`
	TargetDate         *string  `json:"targetDate"`
	StartDate          *string  `json:"startDate"`
	Timeframe          *string  `json:"timeframe"`
	OwnerID            *string  `json:"ownerId"`
	ParentInitiativeID *string  `json:"parentInitiativeId"`
	TeamIDs            []string `json:"teamIds"`
}

type updateRequest struct {
	Name                    *string  `json:"name"`
	Description             any      `json:"description"`
	Status                  *string  `json:"status"`
	Health                  *string  `json:"health"`
	Timeframe               any      `json:"timeframe"`
	StartDate               any      `json:"startDate"`
	TargetDate              any      `json:"targetDate"`
	OwnerID                 any      `json:"ownerId"`
	ParentInitiativeID      any      `json:"parentInitiativeId"`
	TeamIDs                 []string `json:"teamIds"`
	ChildInitiativeID       *string  `json:"childInitiativeId"`
	RemoveChildInitiativeID *string  `json:"removeChildInitiativeId"`
	InitiativeUpdate        *string  `json:"initiativeUpdate"`
	UpdateHealth            *string  `json:"updateHealth"`
	AddProjectID            *string  `json:"addProjectId"`
	RemoveProjectID         *string  `json:"removeProjectId"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{id}", h.Get)
	r.Patch("/{id}", h.Update)
	r.Delete("/{id}", h.Delete)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List initiatives failed", err.Error())
		return
	}
	members, teams, err := h.workspaceMeta(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List initiatives failed", err.Error())
		return
	}
	if !settings.Enabled {
		problem.JSON(w, 200, listResponse{WorkspaceMembers: members, WorkspaceTeams: teams, InitiativesSettings: settings})
		return
	}
	items, err := h.loadInitiatives(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List initiatives failed", err.Error())
		return
	}
	problem.JSON(w, 200, listResponse{Initiatives: items, WorkspaceMembers: members, WorkspaceTeams: teams, InitiativesSettings: settings})
}

func (h Handler) Get(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Get initiative failed", err.Error())
		return
	}
	if !settings.Enabled {
		problem.Write(w, 403, "Initiatives are disabled for this workspace", "")
		return
	}
	detail, err := h.detail(r.Context(), p.WorkspaceID, chi.URLParam(r, "id"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get initiative failed", err.Error())
		return
	}
	problem.JSON(w, 200, detail)
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Create initiative failed", err.Error())
		return
	}
	if !settings.Enabled {
		problem.Write(w, 403, "Initiatives are disabled for this workspace", "")
		return
	}
	var input createRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		problem.Write(w, 400, "Initiative name is required", "")
		return
	}
	status := valueOr(input.Status, "planned")
	if !validStatus(status) {
		status = "planned"
	}
	health := valueOr(input.Health, "unknown")
	if !validHealth(health) {
		health = "unknown"
	}
	start, err := parseDate(input.StartDate)
	if err != nil {
		problem.Write(w, 400, "Invalid date", err.Error())
		return
	}
	target, err := parseDate(input.TargetDate)
	if err != nil {
		problem.Write(w, 400, "Invalid date", err.Error())
		return
	}
	desc := trimmedPtr(input.Description, 0)
	timeframe := trimmedPtr(input.Timeframe, 120)
	ownerID := trimmedPtr(input.OwnerID, 0)
	parentID := trimmedPtr(input.ParentInitiativeID, 0)
	if ownerID != nil && !h.userMember(r.Context(), p.WorkspaceID, *ownerID) {
		problem.Write(w, 404, "Owner not found", "")
		return
	}
	if parentID != nil && !h.initiativeInWorkspace(r.Context(), p.WorkspaceID, *parentID) {
		problem.Write(w, 404, "Parent initiative not found", "")
		return
	}
	teams := uniqueStrings(input.TeamIDs)
	if len(teams) > 0 && !h.teamsInWorkspace(r.Context(), p.WorkspaceID, teams) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create initiative failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	created, err := scanInitiative(tx.QueryRow(r.Context(), `insert into initiative (name, description, status, health, start_date, target_date, timeframe, owner_id, parent_initiative_id, workspace_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid) returning `+initiativeReturningColumns(), name, desc, status, health, start, target, timeframe, ownerID, parentID, p.WorkspaceID))
	if err != nil {
		problem.Write(w, 500, "Create initiative failed", err.Error())
		return
	}
	for _, teamID := range teams {
		if _, err := tx.Exec(r.Context(), `insert into initiative_team (initiative_id, team_id) values ($1::uuid,$2::uuid) on conflict do nothing`, created.ID, teamID); err != nil {
			problem.Write(w, 500, "Create initiative failed", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create initiative failed", err.Error())
		return
	}
	problem.JSON(w, 201, created)
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Update initiative failed", err.Error())
		return
	}
	if !settings.Enabled {
		problem.Write(w, 403, "Initiatives are disabled for this workspace", "")
		return
	}
	current, err := h.findInitiative(r.Context(), p.WorkspaceID, id)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update initiative failed", err.Error())
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	var input updateRequest
	if err := json.Unmarshal(body, &input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	var rawInput map[string]json.RawMessage
	_ = json.Unmarshal(body, &rawInput)
	provided := func(key string) bool {
		_, ok := rawInput[key]
		return ok
	}
	sets := []string{"updated_at=now()"}
	args := []any{}
	add := func(expr string, v any) { args = append(args, v); sets = append(sets, fmt.Sprintf(expr, len(args))) }
	activityActor, actorImage := h.actor(r.Context(), p.UserID)
	settingsMap := current.Settings
	settingsChanged := false
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			problem.Write(w, 400, "Initiative name is required", "")
			return
		}
		if name != current.Name {
			add("name=$%d", name)
			addActivity(settingsMap, "property_change", fmt.Sprintf("Name changed from %s to %s", describe(current.Name), describe(name)), activityActor, actorImage)
			settingsChanged = true
		}
	}
	if provided("description") {
		desc := anyStringPtr(input.Description, 0)
		if ptrVal(desc) != ptrVal(current.Description) {
			add("description=$%d", desc)
			addActivity(settingsMap, "property_change", fmt.Sprintf("Description changed from %s to %s", describePtr(current.Description), describePtr(desc)), activityActor, actorImage)
			settingsChanged = true
		}
	}
	if input.Status != nil {
		if !validStatus(*input.Status) {
			problem.Write(w, 400, "Invalid initiative status", "")
			return
		}
		if *input.Status != current.Status {
			add("status=$%d", *input.Status)
			addActivity(settingsMap, "property_change", fmt.Sprintf("Status changed from %s to %s", current.Status, *input.Status), activityActor, actorImage)
			settingsChanged = true
		}
	}
	if input.Health != nil {
		if !validHealth(*input.Health) {
			problem.Write(w, 400, "Invalid initiative health", "")
			return
		}
		if *input.Health != current.Health {
			add("health=$%d", *input.Health)
			addActivity(settingsMap, "property_change", fmt.Sprintf("Health changed from %s to %s", current.Health, *input.Health), activityActor, actorImage)
			settingsChanged = true
		}
	}
	if provided("timeframe") {
		timeframe := anyStringPtr(input.Timeframe, 120)
		if ptrVal(timeframe) != ptrVal(current.Timeframe) {
			add("timeframe=$%d", timeframe)
			addActivity(settingsMap, "property_change", "Timeframe changed", activityActor, actorImage)
			settingsChanged = true
		}
	}
	if provided("startDate") {
		start, ok, err := parseAnyDate(input.StartDate)
		if err != nil {
			problem.Write(w, 400, "Invalid start date", err.Error())
			return
		}
		if ok {
			add("start_date=$%d", start)
			settingsChanged = true
			addActivity(settingsMap, "property_change", "Start date changed", activityActor, actorImage)
		}
	}
	if provided("targetDate") {
		target, ok, err := parseAnyDate(input.TargetDate)
		if err != nil {
			problem.Write(w, 400, "Invalid target date", err.Error())
			return
		}
		if ok {
			add("target_date=$%d", target)
			settingsChanged = true
			addActivity(settingsMap, "property_change", "Target date changed", activityActor, actorImage)
		}
	}
	if provided("ownerId") {
		ownerID := anyStringPtr(input.OwnerID, 0)
		if ownerID != nil && !h.userMember(r.Context(), p.WorkspaceID, *ownerID) {
			problem.Write(w, 404, "Owner not found", "")
			return
		}
		if ptrVal(ownerID) != ptrVal(current.OwnerID) {
			add("owner_id=$%d", ownerID)
			settingsChanged = true
			addActivity(settingsMap, "property_change", "Owner changed", activityActor, actorImage)
		}
	}
	if provided("parentInitiativeId") {
		parentID := anyStringPtr(input.ParentInitiativeID, 0)
		if parentID != nil {
			hierarchy, _ := h.hierarchy(r.Context(), p.WorkspaceID)
			if !containsInitiative(hierarchy, *parentID) {
				problem.Write(w, 404, "Parent initiative not found", "")
				return
			}
			if !validParentLink(hierarchy, id, parentID) {
				problem.Write(w, 400, "Cannot create a circular initiative hierarchy", "")
				return
			}
		}
		if ptrVal(parentID) != ptrVal(current.ParentInitiativeID) {
			add("parent_initiative_id=$%d", parentID)
			settingsChanged = true
			addActivity(settingsMap, "property_change", "Parent initiative changed", activityActor, actorImage)
		}
	}
	if input.InitiativeUpdate != nil {
		body := strings.TrimSpace(*input.InitiativeUpdate)
		if body == "" {
			problem.Write(w, 400, "Initiative update is required", "")
			return
		}
		health := valueOr(input.UpdateHealth, "onTrack")
		if health != "atRisk" && health != "offTrack" {
			health = "onTrack"
		}
		addUpdate(settingsMap, health, body, activityActor, actorImage)
		add("health=$%d", health)
		settingsChanged = true
	}
	if settingsChanged {
		add("settings=$%d", settingsMap)
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Update initiative failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if len(input.TeamIDs) > 0 || input.TeamIDs != nil {
		teams := uniqueStrings(input.TeamIDs)
		if len(teams) > 0 && !h.teamsInWorkspace(r.Context(), p.WorkspaceID, teams) {
			problem.Write(w, 404, "Team not found", "")
			return
		}
		if _, err := tx.Exec(r.Context(), `delete from initiative_team where initiative_id=$1::uuid`, id); err != nil {
			problem.Write(w, 500, "Update initiative failed", err.Error())
			return
		}
		for _, teamID := range teams {
			if _, err := tx.Exec(r.Context(), `insert into initiative_team (initiative_id, team_id) values ($1::uuid,$2::uuid) on conflict do nothing`, id, teamID); err != nil {
				problem.Write(w, 500, "Update initiative failed", err.Error())
				return
			}
		}
		addActivity(settingsMap, "property_change", "Teams updated", activityActor, actorImage)
	}
	if input.AddProjectID != nil && strings.TrimSpace(*input.AddProjectID) != "" {
		projectID := strings.TrimSpace(*input.AddProjectID)
		if !h.projectInWorkspace(r.Context(), p.WorkspaceID, projectID) {
			problem.Write(w, 404, "Project not found", "")
			return
		}
		if _, err := tx.Exec(r.Context(), `insert into initiative_project (initiative_id, project_id) values ($1::uuid,$2::uuid) on conflict do nothing`, id, projectID); err != nil {
			problem.Write(w, 500, "Update initiative failed", err.Error())
			return
		}
		addActivity(settingsMap, "project_linked", "Linked project", activityActor, actorImage)
	}
	if input.RemoveProjectID != nil && strings.TrimSpace(*input.RemoveProjectID) != "" {
		if _, err := tx.Exec(r.Context(), `delete from initiative_project where initiative_id=$1::uuid and project_id=$2::uuid`, id, strings.TrimSpace(*input.RemoveProjectID)); err != nil {
			problem.Write(w, 500, "Update initiative failed", err.Error())
			return
		}
		addActivity(settingsMap, "project_unlinked", "Unlinked project", activityActor, actorImage)
	}
	if input.ChildInitiativeID != nil && strings.TrimSpace(*input.ChildInitiativeID) != "" {
		childID := strings.TrimSpace(*input.ChildInitiativeID)
		hierarchy, _ := h.hierarchy(r.Context(), p.WorkspaceID)
		if !containsInitiative(hierarchy, childID) {
			problem.Write(w, 404, "Child initiative not found", "")
			return
		}
		if !validParentLink(hierarchy, childID, &id) {
			problem.Write(w, 400, "Cannot create a circular initiative hierarchy", "")
			return
		}
		if _, err := tx.Exec(r.Context(), `update initiative set parent_initiative_id=$1::uuid, updated_at=now() where id=$2::uuid and workspace_id=$3::uuid`, id, childID, p.WorkspaceID); err != nil {
			problem.Write(w, 500, "Update initiative failed", err.Error())
			return
		}
		addActivity(settingsMap, "property_change", "Added child initiative", activityActor, actorImage)
	}
	if input.RemoveChildInitiativeID != nil && strings.TrimSpace(*input.RemoveChildInitiativeID) != "" {
		childID := strings.TrimSpace(*input.RemoveChildInitiativeID)
		if _, err := tx.Exec(r.Context(), `update initiative set parent_initiative_id=null, updated_at=now() where id=$1::uuid and parent_initiative_id=$2::uuid and workspace_id=$3::uuid`, childID, id, p.WorkspaceID); err != nil {
			problem.Write(w, 500, "Update initiative failed", err.Error())
			return
		}
		addActivity(settingsMap, "property_change", "Removed child initiative", activityActor, actorImage)
	}
	if settingsChanged || input.AddProjectID != nil || input.RemoveProjectID != nil || input.ChildInitiativeID != nil || input.RemoveChildInitiativeID != nil || input.TeamIDs != nil {
		if _, err := tx.Exec(r.Context(), `update initiative set settings=$1, updated_at=now() where id=$2::uuid and workspace_id=$3::uuid`, settingsMap, id, p.WorkspaceID); err != nil {
			problem.Write(w, 500, "Update initiative failed", err.Error())
			return
		}
	}
	if len(sets) > 1 {
		args = append(args, id, p.WorkspaceID)
		if _, err := tx.Exec(r.Context(), `update initiative set `+strings.Join(sets, ", ")+fmt.Sprintf(" where id=$%d::uuid and workspace_id=$%d::uuid", len(args)-1, len(args)), args...); err != nil {
			problem.Write(w, 500, "Update initiative failed", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Update initiative failed", err.Error())
		return
	}
	detail, err := h.detail(r.Context(), p.WorkspaceID, id)
	if err != nil {
		problem.Write(w, 500, "Update initiative failed", err.Error())
		return
	}
	problem.JSON(w, 200, detail)
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.workspaceSettings(r.Context(), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Delete initiative failed", err.Error())
		return
	}
	if !settings.Enabled {
		problem.Write(w, 403, "Initiatives are disabled for this workspace", "")
		return
	}
	ct, err := h.DB.Exec(r.Context(), `delete from initiative where id=$1::uuid and workspace_id=$2::uuid`, chi.URLParam(r, "id"), p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Delete initiative failed", err.Error())
		return
	}
	if ct.RowsAffected() == 0 {
		problem.Write(w, 404, "Not found", "")
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) workspaceSettings(ctx context.Context, workspaceID string) (workspaceInitiativeSettings, error) {
	settings := workspaceInitiativeSettings{Enabled: true, ProjectRollups: true, Visibility: "workspace", RoadmapMode: "all"}
	var raw []byte
	if err := h.DB.QueryRow(ctx, `select coalesce(settings, '{}'::jsonb) from workspace where id=$1::uuid`, workspaceID).Scan(&raw); err != nil {
		return settings, err
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return settings, nil
	}
	features, _ := m["features"].(map[string]any)
	initiatives, _ := features["initiatives"].(map[string]any)
	if v, ok := initiatives["enabled"].(bool); ok {
		settings.Enabled = v
	}
	if v, ok := initiatives["projectRollups"].(bool); ok {
		settings.ProjectRollups = v
	}
	if v, ok := initiatives["visibility"].(string); ok && (v == "workspace" || v == "teams") {
		settings.Visibility = v
	}
	if v, ok := initiatives["roadmapMode"].(string); ok && (v == "all" || v == "selected") {
		settings.RoadmapMode = v
	}
	return settings, nil
}

func (h Handler) workspaceMeta(ctx context.Context, workspaceID string) ([]UserSummary, []TeamSummary, error) {
	members := []UserSummary{}
	rows, err := h.DB.Query(ctx, `select u.id, u.name, u.image from member m join "user" u on u.id=m.user_id where m.workspace_id=$1::uuid order by u.name`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m UserSummary
		if err := rows.Scan(&m.ID, &m.Name, &m.Image); err != nil {
			return nil, nil, err
		}
		members = append(members, m)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	teams := []TeamSummary{}
	teamRows, err := h.DB.Query(ctx, `select id::text, name, key, icon from team where workspace_id=$1::uuid order by name`, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	defer teamRows.Close()
	for teamRows.Next() {
		var t TeamSummary
		if err := teamRows.Scan(&t.ID, &t.Name, &t.Key, &t.Icon); err != nil {
			return nil, nil, err
		}
		teams = append(teams, t)
	}
	return members, teams, teamRows.Err()
}

func (h Handler) loadInitiatives(ctx context.Context, workspaceID string) ([]Initiative, error) {
	rows, err := h.DB.Query(ctx, `select `+initiativeColumns()+` from initiative i where i.workspace_id=$1::uuid order by i.created_at`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Initiative{}
	for rows.Next() {
		item, err := scanInitiative(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for idx := range items {
		_ = h.enrichListItem(ctx, &items[idx])
	}
	return items, nil
}

func (h Handler) enrichListItem(ctx context.Context, item *Initiative) error {
	if item.OwnerID != nil {
		var o UserSummary
		if err := h.DB.QueryRow(ctx, `select id, name, image from "user" where id=$1`, *item.OwnerID).Scan(&o.ID, &o.Name, &o.Image); err == nil {
			item.Owner = &o
		}
	}
	teams, _ := h.initiativeTeams(ctx, item.ID)
	item.Teams = teams
	projects, _ := h.initiativeProjects(ctx, item.ID, false)
	item.ProjectCount = len(projects)
	for _, p := range projects {
		if p.Status == "completed" {
			item.CompletedProjectCount++
		}
	}
	if rollup, err := h.activeProjectRollup(ctx, item.ID); err == nil {
		item.ActiveProjectHealthRollup = rollup
	}
	updates, _, _ := settingsArrays(item.Settings)
	if len(updates) > 0 {
		item.LatestUpdate = updates[0]
	}
	return nil
}

func (h Handler) detail(ctx context.Context, workspaceID, id string) (detailResponse, error) {
	init, err := h.findInitiative(ctx, workspaceID, id)
	if err != nil {
		return detailResponse{}, err
	}
	_ = h.enrichListItem(ctx, &init)
	if init.ParentInitiativeID != nil {
		var p miniInitiative
		if err := h.DB.QueryRow(ctx, `select id::text, name, status::text from initiative where id=$1::uuid and workspace_id=$2::uuid`, *init.ParentInitiativeID, workspaceID).Scan(&p.ID, &p.Name, &p.Status); err == nil {
			init.ParentInitiative = &p
		}
	}
	init.ChildInitiatives, _ = h.childInitiatives(ctx, workspaceID, id)
	projects, _ := h.initiativeProjects(ctx, id, true)
	availableProjects, _ := h.availableProjects(ctx, workspaceID, projects)
	members, teams, _ := h.workspaceMeta(ctx, workspaceID)
	candidates, _ := h.parentCandidates(ctx, workspaceID, id)
	updates, activity, _ := settingsArrays(init.Settings)
	return detailResponse{Initiative: init, Projects: projects, AvailableProjects: availableProjects, WorkspaceMembers: members, WorkspaceTeams: teams, AvailableParentInitiatives: candidates, Updates: updates, Activity: activity}, nil
}

func (h Handler) findInitiative(ctx context.Context, workspaceID, id string) (Initiative, error) {
	return scanInitiative(h.DB.QueryRow(ctx, `select `+initiativeColumns()+` from initiative i where i.id=$1::uuid and i.workspace_id=$2::uuid`, id, workspaceID))
}

func initiativeColumns() string {
	return initiativeColumnsWithPrefix("i.")
}

func initiativeReturningColumns() string {
	return initiativeColumnsWithPrefix("")
}

func initiativeColumnsWithPrefix(prefix string) string {
	return prefix + `id::text, ` + prefix + `name, ` + prefix + `description, ` + prefix + `status::text, ` + prefix + `owner_id, ` + prefix + `start_date, ` + prefix + `target_date, ` + prefix + `timeframe, ` + prefix + `health, coalesce(` + prefix + `settings, '{}'::jsonb), ` + prefix + `workspace_id::text, ` + prefix + `parent_initiative_id::text, ` + prefix + `created_at, ` + prefix + `updated_at`
}

type scanner interface{ Scan(dest ...any) error }

func scanInitiative(row scanner) (Initiative, error) {
	var item Initiative
	var start, target pgtype.Timestamp
	var raw []byte
	var created, updated time.Time
	if err := row.Scan(&item.ID, &item.Name, &item.Description, &item.Status, &item.OwnerID, &start, &target, &item.Timeframe, &item.Health, &raw, &item.WorkspaceID, &item.ParentInitiativeID, &created, &updated); err != nil {
		return Initiative{}, err
	}
	item.StartDate = formatTS(start)
	item.TargetDate = formatTS(target)
	item.Settings = map[string]any{}
	_ = json.Unmarshal(raw, &item.Settings)
	item.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	item.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
	item.Teams = []TeamSummary{}
	item.ChildInitiatives = []miniInitiative{}
	return item, nil
}

func (h Handler) initiativeTeams(ctx context.Context, id string) ([]TeamSummary, error) {
	rows, err := h.DB.Query(ctx, `select t.id::text,t.name,t.key,t.icon from initiative_team it join team t on t.id=it.team_id where it.initiative_id=$1::uuid order by t.name`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TeamSummary{}
	for rows.Next() {
		var t TeamSummary
		if err := rows.Scan(&t.ID, &t.Name, &t.Key, &t.Icon); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
func (h Handler) initiativeProjects(ctx context.Context, id string, withCounts bool) ([]projectSummary, error) {
	rows, err := h.DB.Query(ctx, `select p.id::text,p.name,p.status::text,p.icon,p.slug from initiative_project ip join project p on p.id=ip.project_id where ip.initiative_id=$1::uuid order by p.created_at`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []projectSummary{}
	for rows.Next() {
		var p projectSummary
		if err := rows.Scan(&p.ID, &p.Name, &p.Status, &p.Icon, &p.Slug); err != nil {
			return nil, err
		}
		if withCounts {
			p.IssueCount, p.CompletedIssueCount = h.issueCounts(ctx, p.ID)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (h Handler) activeProjectRollup(ctx context.Context, id string) (*activeProjectHealthRollup, error) {
	var total, withUpdates, paused int
	err := h.DB.QueryRow(ctx, `
		select
			count(*) filter (where p.status in ('started','paused'))::int,
			count(*) filter (
				where p.status in ('started','paused')
				and exists (
					select 1
					from jsonb_array_elements(case when jsonb_typeof(p.settings->'activity') = 'array' then p.settings->'activity' else '[]'::jsonb end) entry
					where entry->>'type' = 'update'
				)
			)::int,
			count(*) filter (where p.status = 'paused')::int
		from initiative_project ip
		join project p on p.id=ip.project_id
		where ip.initiative_id=$1::uuid`, id).Scan(&total, &withUpdates, &paused)
	if err != nil {
		return nil, err
	}
	return &activeProjectHealthRollup{Total: total, WithUpdates: withUpdates, WithoutUpdates: total - withUpdates, Paused: paused}, nil
}

func (h Handler) issueCounts(ctx context.Context, projectID string) (int32, int32) {
	var total, done int32
	_ = h.DB.QueryRow(ctx, `select count(*)::int, count(*) filter (where ws.category='completed')::int from issue i left join workflow_state ws on ws.id=i.state_id where i.project_id=$1::uuid`, projectID).Scan(&total, &done)
	return total, done
}
func (h Handler) availableProjects(ctx context.Context, workspaceID string, linked []projectSummary) ([]projectSummary, error) {
	ids := map[string]bool{}
	for _, p := range linked {
		ids[p.ID] = true
	}
	rows, err := h.DB.Query(ctx, `select id::text,name,status::text,icon,slug from project where workspace_id=$1::uuid order by created_at`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []projectSummary{}
	for rows.Next() {
		var p projectSummary
		if err := rows.Scan(&p.ID, &p.Name, &p.Status, &p.Icon, &p.Slug); err != nil {
			return nil, err
		}
		if !ids[p.ID] {
			out = append(out, p)
		}
	}
	return out, rows.Err()
}
func (h Handler) childInitiatives(ctx context.Context, workspaceID, id string) ([]miniInitiative, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,status::text from initiative where workspace_id=$1::uuid and parent_initiative_id=$2::uuid order by created_at`, workspaceID, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []miniInitiative{}
	for rows.Next() {
		var x miniInitiative
		if err := rows.Scan(&x.ID, &x.Name, &x.Status); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
func (h Handler) parentCandidates(ctx context.Context, workspaceID, id string) ([]miniInitiative, error) {
	hierarchy, _ := h.hierarchy(ctx, workspaceID)
	descendants := descendants(hierarchy, id)
	out := []miniInitiative{}
	for _, x := range hierarchy {
		if x.ID != id && !descendants[x.ID] {
			out = append(out, x)
		}
	}
	return out, nil
}
func (h Handler) hierarchy(ctx context.Context, workspaceID string) ([]miniInitiative, error) {
	rows, err := h.DB.Query(ctx, `select id::text,name,parent_initiative_id::text from initiative where workspace_id=$1::uuid`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []miniInitiative{}
	for rows.Next() {
		var x miniInitiative
		if err := rows.Scan(&x.ID, &x.Name, &x.ParentInitiativeID); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (h Handler) userMember(ctx context.Context, workspaceID, userID string) bool {
	var ok bool
	_ = h.DB.QueryRow(ctx, `select true from member where workspace_id=$1::uuid and user_id=$2 limit 1`, workspaceID, userID).Scan(&ok)
	return ok
}
func (h Handler) initiativeInWorkspace(ctx context.Context, workspaceID, id string) bool {
	var ok bool
	_ = h.DB.QueryRow(ctx, `select true from initiative where workspace_id=$1::uuid and id=$2::uuid`, workspaceID, id).Scan(&ok)
	return ok
}
func (h Handler) projectInWorkspace(ctx context.Context, workspaceID, id string) bool {
	var ok bool
	_ = h.DB.QueryRow(ctx, `select true from project where workspace_id=$1::uuid and id=$2::uuid`, workspaceID, id).Scan(&ok)
	return ok
}
func (h Handler) teamsInWorkspace(ctx context.Context, workspaceID string, ids []string) bool {
	if len(ids) == 0 {
		return true
	}
	var count int
	_ = h.DB.QueryRow(ctx, `select count(*)::int from team where workspace_id=$1::uuid and id=any($2::uuid[])`, workspaceID, ids).Scan(&count)
	return count == len(ids)
}
func (h Handler) actor(ctx context.Context, userID string) (string, *string) {
	var name string
	var image *string
	if err := h.DB.QueryRow(ctx, `select name,image from "user" where id=$1`, userID).Scan(&name, &image); err != nil {
		return "Unknown", nil
	}
	return name, image
}

func validStatus(s string) bool { return s == "planned" || s == "active" || s == "completed" }
func validHealth(s string) bool {
	return s == "onTrack" || s == "atRisk" || s == "offTrack" || s == "unknown"
}
func valueOr(v *string, fallback string) string {
	if v == nil || strings.TrimSpace(*v) == "" {
		return fallback
	}
	return strings.TrimSpace(*v)
}
func trimmedPtr(v *string, max int) *string {
	if v == nil {
		return nil
	}
	return trimStringPtr(*v, max)
}
func trimStringPtr(s string, max int) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if max > 0 && len(s) > max {
		s = s[:max]
	}
	return &s
}
func anyStringPtr(v any, max int) *string {
	s, ok := v.(string)
	if !ok {
		return nil
	}
	return trimStringPtr(s, max)
}
func ptrVal(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
func parseDate(v *string) (*time.Time, error) {
	if v == nil || strings.TrimSpace(*v) == "" {
		return nil, nil
	}
	return parseDateString(*v)
}
func parseDateString(s string) (*time.Time, error) {
	s = strings.TrimSpace(s)
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t2, err2 := time.Parse("2006-01-02", s)
		if err2 != nil {
			return nil, err
		}
		t = t2
	}
	return &t, nil
}
func parseAnyDate(v any) (*time.Time, bool, error) {
	if v == nil {
		return nil, true, nil
	}
	s, ok := v.(string)
	if !ok {
		return nil, false, fmt.Errorf("date must be a string")
	}
	if strings.TrimSpace(s) == "" {
		return nil, true, nil
	}
	t, err := parseDateString(s)
	return t, true, err
}
func formatTS(ts pgtype.Timestamp) *string {
	if !ts.Valid {
		return nil
	}
	s := ts.Time.UTC().Format(time.RFC3339Nano)
	return &s
}
func uniqueStrings(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
func containsInitiative(nodes []miniInitiative, id string) bool {
	for _, n := range nodes {
		if n.ID == id {
			return true
		}
	}
	return false
}
func validParentLink(nodes []miniInitiative, childID string, parentID *string) bool {
	if parentID == nil {
		return true
	}
	if childID == *parentID {
		return false
	}
	parentByID := map[string]*string{}
	for _, n := range nodes {
		parentByID[n.ID] = n.ParentInitiativeID
	}
	cur := parentID
	seen := map[string]bool{}
	for cur != nil && *cur != "" {
		if *cur == childID || seen[*cur] {
			return false
		}
		seen[*cur] = true
		cur = parentByID[*cur]
	}
	return true
}
func descendants(nodes []miniInitiative, id string) map[string]bool {
	children := map[string][]string{}
	for _, n := range nodes {
		if n.ParentInitiativeID != nil {
			children[*n.ParentInitiativeID] = append(children[*n.ParentInitiativeID], n.ID)
		}
	}
	out := map[string]bool{}
	q := append([]string{}, children[id]...)
	for len(q) > 0 {
		x := q[0]
		q = q[1:]
		if out[x] {
			continue
		}
		out[x] = true
		q = append(q, children[x]...)
	}
	return out
}
func describe(v string) string {
	if v == "" {
		return "None"
	}
	return v
}
func describePtr(v *string) string {
	if v == nil || *v == "" {
		return "None"
	}
	return *v
}
func settingsArrays(m map[string]any) ([]any, []any, error) {
	updates, _ := m["updates"].([]any)
	activity, _ := m["activity"].([]any)
	if updates == nil {
		updates = []any{}
	}
	if activity == nil {
		activity = []any{}
	}
	return updates, activity, nil
}
func addActivity(m map[string]any, typ, msg, actor string, image *string) {
	_, activity, _ := settingsArrays(m)
	entry := map[string]any{"id": randomID(), "type": typ, "message": msg, "actorName": actor, "actorImage": image, "createdAt": time.Now().UTC().Format(time.RFC3339Nano)}
	m["activity"] = append([]any{entry}, activity...)[:min(50, len(activity)+1)]
}
func addUpdate(m map[string]any, health, body, actor string, image *string) {
	updates, _, _ := settingsArrays(m)
	entry := map[string]any{"id": randomID(), "health": health, "body": body, "actorName": actor, "actorImage": image, "createdAt": time.Now().UTC().Format(time.RFC3339Nano)}
	m["updates"] = append([]any{entry}, updates...)[:min(25, len(updates)+1)]
}
func randomID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:4]) + "-" + hex.EncodeToString(b[4:6]) + "-" + hex.EncodeToString(b[6:8]) + "-" + hex.EncodeToString(b[8:10]) + "-" + hex.EncodeToString(b[10:])
}
