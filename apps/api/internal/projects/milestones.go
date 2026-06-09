package projects

import (
	"context"
	"crypto/rand"
	"encoding/hex"
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

type Milestone struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	SortOrder      float64 `json:"sortOrder"`
	Description    *string `json:"description,omitempty"`
	IssueCount     int32   `json:"issueCount,omitempty"`
	CompletedCount int32   `json:"completedCount,omitempty"`
	Progress       int32   `json:"progress,omitempty"`
}

type milestoneResponse struct {
	Milestone Milestone `json:"milestone"`
}

type milestoneRequest struct {
	Name        *string  `json:"name"`
	Description *string  `json:"description"`
	SortOrder   *float64 `json:"sortOrder"`
}

func (h Handler) CreateMilestone(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	project, err := h.findProject(r.Context(), p.WorkspaceID, chi.URLParam(r, "slug"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Project not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create milestone failed", err.Error())
		return
	}
	var input milestoneRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := strings.TrimSpace(valueOr(input.Name, ""))
	if name == "" {
		problem.Write(w, 400, "Milestone name is required", "")
		return
	}
	description := nullableString(valueOr(input.Description, ""))
	last, err := h.lastMilestoneSortOrder(r.Context(), project.ID)
	if err != nil {
		problem.Write(w, 500, "Create milestone failed", err.Error())
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create milestone failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	milestone, err := scanMilestone(tx.QueryRow(r.Context(), `insert into project_milestone (project_id,name,sort_order) values ($1::uuid,$2,$3) returning id::text,name,sort_order`, project.ID, name, last+1))
	if err != nil {
		problem.Write(w, 500, "Create milestone failed", err.Error())
		return
	}
	settings, err := h.projectSettings(r.Context(), tx, project.ID)
	if err != nil {
		problem.Write(w, 500, "Create milestone failed", err.Error())
		return
	}
	setMilestoneDescription(settings, milestone.ID, description)
	prependActivity(settings, "Created milestone \""+name+"\"", description)
	if err := h.saveProjectSettings(r.Context(), tx, project.ID, settings); err != nil {
		problem.Write(w, 500, "Create milestone failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create milestone failed", err.Error())
		return
	}
	milestone.Description = description
	problem.JSON(w, 201, milestoneResponse{Milestone: milestone})
}

func (h Handler) UpdateMilestone(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	project, err := h.findProject(r.Context(), p.WorkspaceID, chi.URLParam(r, "slug"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Project not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update milestone failed", err.Error())
		return
	}
	milestoneID := chi.URLParam(r, "milestoneID")
	current, err := h.findMilestone(r.Context(), project.ID, milestoneID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Milestone not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update milestone failed", err.Error())
		return
	}
	var input milestoneRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := current.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
		if name == "" {
			problem.Write(w, 400, "Milestone name is required", "")
			return
		}
	}
	sortOrder := current.SortOrder
	if input.SortOrder != nil {
		sortOrder = *input.SortOrder
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Update milestone failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	updated, err := scanMilestone(tx.QueryRow(r.Context(), `update project_milestone set name=$1, sort_order=$2, updated_at=now() where id=$3::uuid and project_id=$4::uuid returning id::text,name,sort_order`, name, sortOrder, milestoneID, project.ID))
	if err != nil {
		problem.Write(w, 500, "Update milestone failed", err.Error())
		return
	}
	settings, err := h.projectSettings(r.Context(), tx, project.ID)
	if err != nil {
		problem.Write(w, 500, "Update milestone failed", err.Error())
		return
	}
	if input.Description != nil {
		setMilestoneDescription(settings, milestoneID, nullableString(*input.Description))
	}
	updated.Description = milestoneDescription(settings, milestoneID)
	prependActivity(settings, "Updated milestone \""+updated.Name+"\"", updated.Description)
	if err := h.saveProjectSettings(r.Context(), tx, project.ID, settings); err != nil {
		problem.Write(w, 500, "Update milestone failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Update milestone failed", err.Error())
		return
	}
	problem.JSON(w, 200, milestoneResponse{Milestone: updated})
}

func (h Handler) DeleteMilestone(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	project, err := h.findProject(r.Context(), p.WorkspaceID, chi.URLParam(r, "slug"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Project not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete milestone failed", err.Error())
		return
	}
	milestoneID := chi.URLParam(r, "milestoneID")
	current, err := h.findMilestone(r.Context(), project.ID, milestoneID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Milestone not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete milestone failed", err.Error())
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Delete milestone failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err := tx.Exec(r.Context(), `update issue set project_milestone_id=null, updated_at=now() where project_milestone_id=$1::uuid`, milestoneID); err != nil {
		problem.Write(w, 500, "Delete milestone failed", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `delete from project_milestone where id=$1::uuid and project_id=$2::uuid`, milestoneID, project.ID); err != nil {
		problem.Write(w, 500, "Delete milestone failed", err.Error())
		return
	}
	settings, err := h.projectSettings(r.Context(), tx, project.ID)
	if err != nil {
		problem.Write(w, 500, "Delete milestone failed", err.Error())
		return
	}
	setMilestoneDescription(settings, milestoneID, nil)
	body := "Assigned issues were moved back to no milestone."
	prependActivity(settings, "Deleted milestone \""+current.Name+"\"", &body)
	if err := h.saveProjectSettings(r.Context(), tx, project.ID, settings); err != nil {
		problem.Write(w, 500, "Delete milestone failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Delete milestone failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) lastMilestoneSortOrder(ctx context.Context, projectID string) (float64, error) {
	var value *float64
	err := h.DB.QueryRow(ctx, `select sort_order from project_milestone where project_id=$1::uuid order by sort_order desc limit 1`, projectID).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return -1, nil
	}
	if value == nil {
		return -1, err
	}
	return *value, err
}

func (h Handler) findMilestone(ctx context.Context, projectID, milestoneID string) (Milestone, error) {
	milestone, err := scanMilestone(h.DB.QueryRow(ctx, `select id::text,name,sort_order from project_milestone where id=$1::uuid and project_id=$2::uuid limit 1`, milestoneID, projectID))
	return milestone, err
}

func scanMilestone(row scanner) (Milestone, error) {
	var item Milestone
	if err := row.Scan(&item.ID, &item.Name, &item.SortOrder); err != nil {
		return Milestone{}, err
	}
	return item, nil
}

func (h Handler) projectSettings(ctx context.Context, tx pgx.Tx, projectID string) (map[string]any, error) {
	var raw []byte
	if err := tx.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from project where id=$1::uuid limit 1`, projectID).Scan(&raw); err != nil {
		return nil, err
	}
	settings := map[string]any{}
	_ = json.Unmarshal(raw, &settings)
	return settings, nil
}

func (h Handler) saveProjectSettings(ctx context.Context, tx pgx.Tx, projectID string, settings map[string]any) error {
	raw, _ := json.Marshal(settings)
	_, err := tx.Exec(ctx, `update project set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, projectID)
	return err
}

func milestoneDescription(settings map[string]any, id string) *string {
	descriptions := record(settings["milestoneDescriptions"])
	if value, ok := descriptions[id].(string); ok && strings.TrimSpace(value) != "" {
		trimmed := strings.TrimSpace(value)
		return &trimmed
	}
	return nil
}

func setMilestoneDescription(settings map[string]any, id string, description *string) {
	descriptions := record(settings["milestoneDescriptions"])
	if description == nil || strings.TrimSpace(*description) == "" {
		delete(descriptions, id)
	} else {
		descriptions[id] = strings.TrimSpace(*description)
	}
	settings["milestoneDescriptions"] = descriptions
}

func prependActivity(settings map[string]any, title string, body *string) {
	activity := []any{map[string]any{"id": randomID(), "createdAt": time.Now().UTC().Format(time.RFC3339Nano), "type": "milestone", "title": title, "body": body}}
	if existing, ok := settings["activity"].([]any); ok {
		activity = append(activity, existing...)
	}
	if len(activity) > 50 {
		activity = activity[:50]
	}
	settings["activity"] = activity
}

func prependProjectUpdate(settings map[string]any, body *string) {
	activity := []any{map[string]any{"id": randomID(), "createdAt": time.Now().UTC().Format(time.RFC3339Nano), "type": "update", "title": "Project update", "body": body, "actorName": "You", "actorImage": nil}}
	if existing, ok := settings["activity"].([]any); ok {
		activity = append(activity, existing...)
	}
	if len(activity) > 50 {
		activity = activity[:50]
	}
	settings["activity"] = activity
}

func record(value any) map[string]any {
	if item, ok := value.(map[string]any); ok {
		return item
	}
	return map[string]any{}
}

func randomID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return "activity_" + hex.EncodeToString(buf)
}
