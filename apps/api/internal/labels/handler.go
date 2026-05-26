package labels

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
	syncapi "github.com/namuh-eng/exponential/apps/api/internal/sync"
)

type Handler struct{ DB *pgxpool.Pool }

type Label struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Color         string  `json:"color"`
	Description   *string `json:"description"`
	ParentLabelID *string `json:"parentLabelId"`
	TeamID        *string `json:"teamId"`
	TeamName      *string `json:"teamName"`
	TeamKey       *string `json:"teamKey"`
	Scope         string  `json:"scope"`
	ArchivedAt    *string `json:"archivedAt"`
	IssueCount    int32   `json:"issueCount"`
	LastApplied   *string `json:"lastApplied"`
	CreatedAt     string  `json:"createdAt"`
	UpdatedAt     string  `json:"updatedAt"`
}

type labelListResponse struct {
	Labels []Label `json:"labels"`
}
type labelResponse struct {
	Label Label `json:"label"`
}

type labelRequest struct {
	Name           *string `json:"name"`
	Color          *string `json:"color"`
	Description    *string `json:"description"`
	ParentLabelID  *string `json:"parentLabelId"`
	TeamID         *string `json:"teamId"`
	Archived       *bool   `json:"archived"`
	ConvertToGroup bool    `json:"convertToGroup"`
}

type bulkRequest struct {
	Action             string   `json:"action"`
	LabelIDs           []string `json:"labelIds"`
	DestinationLabelID *string  `json:"destinationLabelId"`
	TeamID             *string  `json:"teamId"`
}

type bulkResponse struct {
	Success            bool    `json:"success"`
	UpdatedCount       int     `json:"updatedCount,omitempty"`
	DestinationLabelID *string `json:"destinationLabelId,omitempty"`
	MergedCount        int     `json:"mergedCount,omitempty"`
}

type ProjectLabel struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Color        string  `json:"color"`
	Description  *string `json:"description"`
	ProjectCount int32   `json:"projectCount"`
	CreatedAt    string  `json:"createdAt"`
	UpdatedAt    string  `json:"updatedAt"`
}

type projectLabelListResponse struct {
	Labels []ProjectLabel `json:"labels"`
}
type projectLabelResponse struct {
	Label ProjectLabel `json:"label"`
}

type projectLabelRequest struct {
	Name        *string `json:"name"`
	Color       *string `json:"color"`
	Description *string `json:"description"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Post("/bulk", h.Bulk)
	r.Patch("/{id}", h.Update)
	r.Delete("/{id}", h.Delete)
	return r
}

func (h Handler) ProjectRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.ListProjectLabels)
	r.Post("/", h.CreateProjectLabel)
	r.Patch("/{id}", h.UpdateProjectLabel)
	r.Delete("/{id}", h.DeleteProjectLabel)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	scope := r.URL.Query().Get("scope")
	if scope == "" {
		scope = "workspace"
	}
	teamID := r.URL.Query().Get("teamId")
	includeArchived := r.URL.Query().Get("includeArchived") == "true"
	where := []string{"l.workspace_id=$1::uuid", "(l.team_id is null or t.workspace_id=$1::uuid)"}
	args := []any{p.WorkspaceID}
	if !includeArchived {
		where = append(where, "l.archived_at is null")
	}
	if scope == "team" && teamID != "" {
		args = append(args, teamID)
		where = append(where, "l.team_id=$2::uuid")
	} else if scope == "team" {
		where = append(where, "l.team_id is not null")
	} else if scope != "all" {
		where = append(where, "l.team_id is null")
	}
	rows, err := h.DB.Query(r.Context(), `select l.id::text,l.name,l.color,l.description,l.parent_label_id::text,l.team_id::text,t.name,t.key,l.archived_at,count(il.issue_id)::int,l.updated_at,l.created_at,l.updated_at from label l left join issue_label il on il.label_id=l.id left join team t on t.id=l.team_id where `+strings.Join(where, " and ")+` group by l.id,t.id order by t.name,l.name`, args...)
	if err != nil {
		problem.Write(w, 500, "List labels failed", err.Error())
		return
	}
	defer rows.Close()
	labels := []Label{}
	for rows.Next() {
		label, err := scanLabel(rows)
		if err != nil {
			problem.Write(w, 500, "List labels failed", err.Error())
			return
		}
		labels = append(labels, label)
	}
	problem.JSON(w, 200, labelListResponse{Labels: labels})
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input labelRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := strings.TrimSpace(value(input.Name))
	if name == "" {
		problem.Write(w, 400, "Name is required", "")
		return
	}
	color := normalizeColor(value(input.Color), "#6b6f76")
	teamID := nullableTrim(input.TeamID)
	if teamID != nil {
		if ok, err := h.teamInWorkspace(r.Context(), p.WorkspaceID, *teamID); err != nil {
			problem.Write(w, 500, "Create label failed", err.Error())
			return
		} else if !ok {
			problem.Write(w, 404, "Team not found", "")
			return
		}
	}
	if err := h.validateParent(r.Context(), p.WorkspaceID, teamID, nullableTrim(input.ParentLabelID), ""); err != nil {
		writeParentErr(w, err)
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create label failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	label, err := scanLabel(tx.QueryRow(r.Context(), `insert into label (name,color,description,workspace_id,team_id,parent_label_id) values ($1,$2,$3,$4::uuid,$5::uuid,$6::uuid) returning id::text,name,color,description,parent_label_id::text,team_id::text,null::text,null::text,archived_at,0::int,updated_at,created_at,updated_at`, name, color, nullableTrim(input.Description), p.WorkspaceID, teamID, nullableTrim(input.ParentLabelID)))
	if err != nil {
		problem.Write(w, 500, "Create label failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "label", label.ID, "created", label, p.UserID); err != nil {
		problem.Write(w, 500, "Create label failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create label failed", err.Error())
		return
	}
	problem.JSON(w, 201, labelResponse{Label: label})
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	var input labelRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	sets := []string{"updated_at=now()"}
	args := []any{}
	add := func(sql string, value any) {
		args = append(args, value)
		sets = append(sets, strings.Replace(sql, "?", "$"+itoa(len(args)), 1))
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			problem.Write(w, 400, "Name is required", "")
			return
		}
		add("name=?", name)
	}
	if input.Color != nil {
		add("color=?", normalizeColor(*input.Color, "#6b6f76"))
	}
	if input.Description != nil {
		add("description=?", nullableTrim(input.Description))
	}
	if input.Archived != nil {
		if *input.Archived {
			add("archived_at=?", time.Now())
		} else {
			add("archived_at=?", nil)
		}
	}
	if input.ConvertToGroup {
		add("parent_label_id=?", nil)
		add("color=?", "#6b6f76")
	}
	teamID := (*string)(nil)
	if input.TeamID != nil {
		teamID = nullableTrim(input.TeamID)
		if teamID != nil {
			if ok, err := h.teamInWorkspace(r.Context(), p.WorkspaceID, *teamID); err != nil {
				problem.Write(w, 500, "Update label failed", err.Error())
				return
			} else if !ok {
				problem.Write(w, 404, "Team not found", "")
				return
			}
		}
		add("team_id=?", teamID)
		add("parent_label_id=?", nil)
	}
	if input.ParentLabelID != nil {
		if teamID == nil {
			var err error
			teamID, err = h.currentLabelTeam(r.Context(), p.WorkspaceID, id)
			if err != nil {
				problem.Write(w, 404, "Label not found", "")
				return
			}
		}
		parent := nullableTrim(input.ParentLabelID)
		if err := h.validateParent(r.Context(), p.WorkspaceID, teamID, parent, id); err != nil {
			writeParentErr(w, err)
			return
		}
		add("parent_label_id=?", parent)
	}
	args = append(args, id, p.WorkspaceID)
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Update label failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	label, err := scanLabel(tx.QueryRow(r.Context(), `update label l set `+strings.Join(sets, ",")+` from team t where l.id=$`+itoa(len(args)-1)+`::uuid and l.workspace_id=$`+itoa(len(args))+`::uuid and (t.id=l.team_id or l.team_id is null) returning l.id::text,l.name,l.color,l.description,l.parent_label_id::text,l.team_id::text,t.name,t.key,l.archived_at,0::int,l.updated_at,l.created_at,l.updated_at`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Label not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update label failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "label", label.ID, "updated", label, p.UserID); err != nil {
		problem.Write(w, 500, "Update label failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Update label failed", err.Error())
		return
	}
	problem.JSON(w, 200, labelResponse{Label: label})
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Delete label failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var exists int
	if err := tx.QueryRow(r.Context(), `select 1 from label where id=$1::uuid and workspace_id=$2::uuid`, id, p.WorkspaceID).Scan(&exists); errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Label not found", "")
		return
	} else if err != nil {
		problem.Write(w, 500, "Delete label failed", err.Error())
		return
	}
	_, _ = tx.Exec(r.Context(), `delete from issue_label where label_id=$1::uuid`, id)
	if _, err := tx.Exec(r.Context(), `delete from label where id=$1::uuid and workspace_id=$2::uuid`, id, p.WorkspaceID); err != nil {
		problem.Write(w, 500, "Delete label failed", err.Error())
		return
	}
	if err := insertOperation(r.Context(), tx, p.WorkspaceID, "label", id, "deleted", map[string]string{"id": id}, p.UserID); err != nil {
		problem.Write(w, 500, "Delete label failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Delete label failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) Bulk(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input bulkRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	labelIDs := uniqueStrings(input.LabelIDs)
	if strings.TrimSpace(input.Action) == "" {
		problem.Write(w, 400, "Action is required", "")
		return
	}
	if len(labelIDs) == 0 {
		problem.Write(w, 400, "Select at least one label", "")
		return
	}
	if err := h.requireLabels(r.Context(), p.WorkspaceID, labelIDs); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problem.Write(w, 404, "One or more labels were not found", "")
			return
		}
		problem.Write(w, 500, "Bulk label action failed", err.Error())
		return
	}
	switch input.Action {
	case "archive", "unarchive":
		archivedAt := any(nil)
		if input.Action == "archive" {
			archivedAt = time.Now()
		}
		if _, err := h.DB.Exec(r.Context(), `update label set archived_at=$1, updated_at=now() where workspace_id=$2::uuid and id=any($3::uuid[])`, archivedAt, p.WorkspaceID, labelIDs); err != nil {
			problem.Write(w, 500, "Bulk label action failed", err.Error())
			return
		}
		problem.JSON(w, 200, bulkResponse{Success: true, UpdatedCount: len(labelIDs)})
	case "delete":
		tx, err := h.DB.Begin(r.Context())
		if err != nil {
			problem.Write(w, 500, "Bulk label action failed", err.Error())
			return
		}
		defer func() { _ = tx.Rollback(r.Context()) }()
		if _, err := tx.Exec(r.Context(), `delete from issue_label where label_id=any($1::uuid[])`, labelIDs); err != nil {
			problem.Write(w, 500, "Bulk label action failed", err.Error())
			return
		}
		if _, err := tx.Exec(r.Context(), `delete from label where workspace_id=$1::uuid and id=any($2::uuid[])`, p.WorkspaceID, labelIDs); err != nil {
			problem.Write(w, 500, "Bulk label action failed", err.Error())
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			problem.Write(w, 500, "Bulk label action failed", err.Error())
			return
		}
		problem.JSON(w, 200, bulkResponse{Success: true, UpdatedCount: len(labelIDs)})
	case "convertToGroup":
		if _, err := h.DB.Exec(r.Context(), `update label set parent_label_id=null, color='#6b6f76', updated_at=now() where workspace_id=$1::uuid and id=any($2::uuid[])`, p.WorkspaceID, labelIDs); err != nil {
			problem.Write(w, 500, "Bulk label action failed", err.Error())
			return
		}
		problem.JSON(w, 200, bulkResponse{Success: true, UpdatedCount: len(labelIDs)})
	case "rescope":
		teamID := nullableTrim(input.TeamID)
		if teamID != nil {
			if ok, err := h.teamInWorkspace(r.Context(), p.WorkspaceID, *teamID); err != nil {
				problem.Write(w, 500, "Bulk label action failed", err.Error())
				return
			} else if !ok {
				problem.Write(w, 404, "Team not found", "")
				return
			}
		}
		if _, err := h.DB.Exec(r.Context(), `update label set team_id=$1::uuid, updated_at=now() where workspace_id=$2::uuid and id=any($3::uuid[])`, teamID, p.WorkspaceID, labelIDs); err != nil {
			problem.Write(w, 500, "Bulk label action failed", err.Error())
			return
		}
		problem.JSON(w, 200, bulkResponse{Success: true, UpdatedCount: len(labelIDs)})
	case "merge":
		h.bulkMerge(w, r, p.WorkspaceID, labelIDs, nullableTrim(input.DestinationLabelID))
	default:
		problem.Write(w, 400, "Unsupported action", "")
	}
}

func (h Handler) bulkMerge(w http.ResponseWriter, r *http.Request, workspaceID string, labelIDs []string, destinationID *string) {
	if destinationID == nil {
		problem.Write(w, 400, "destinationLabelId is required", "")
		return
	}
	sourceIDs := []string{}
	for _, id := range labelIDs {
		if id != *destinationID {
			sourceIDs = append(sourceIDs, id)
		}
	}
	if len(sourceIDs) == 0 {
		problem.Write(w, 400, "Choose at least one source label", "")
		return
	}
	if err := h.requireLabels(r.Context(), workspaceID, []string{*destinationID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			problem.Write(w, 404, "Destination label not found", "")
			return
		}
		problem.Write(w, 500, "Bulk label action failed", err.Error())
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Bulk label action failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if _, err := tx.Exec(r.Context(), `
		delete from issue_label src
		where src.label_id=any($1::uuid[])
		  and exists (
		    select 1 from issue_label dst
		    where dst.label_id=$2::uuid and dst.issue_id=src.issue_id
		  )`, sourceIDs, *destinationID); err != nil {
		problem.Write(w, 500, "Bulk label action failed", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `update issue_label set label_id=$1::uuid where label_id=any($2::uuid[])`, *destinationID, sourceIDs); err != nil {
		problem.Write(w, 500, "Bulk label action failed", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `delete from label where id=any($1::uuid[]) and workspace_id=$2::uuid`, sourceIDs, workspaceID); err != nil {
		problem.Write(w, 500, "Bulk label action failed", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `update label set updated_at=now() where id=$1::uuid and workspace_id=$2::uuid`, *destinationID, workspaceID); err != nil {
		problem.Write(w, 500, "Bulk label action failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Bulk label action failed", err.Error())
		return
	}
	problem.JSON(w, 200, bulkResponse{Success: true, DestinationLabelID: destinationID, MergedCount: len(sourceIDs)})
}

func (h Handler) ListProjectLabels(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	rows, err := h.DB.Query(r.Context(), `select pl.id::text,pl.name,pl.color,pl.description,count(pr.id)::int,pl.created_at,pl.updated_at from project_label pl left join project pr on pr.workspace_id=$1::uuid and (pr.settings->'labelIds') ? pl.id::text where pl.workspace_id=$1::uuid group by pl.id order by pl.name`, p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List project labels failed", err.Error())
		return
	}
	defer rows.Close()
	labels := []ProjectLabel{}
	for rows.Next() {
		l, err := scanProjectLabel(rows)
		if err != nil {
			problem.Write(w, 500, "List project labels failed", err.Error())
			return
		}
		labels = append(labels, l)
	}
	problem.JSON(w, 200, projectLabelListResponse{Labels: labels})
}

func (h Handler) CreateProjectLabel(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input projectLabelRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := strings.TrimSpace(value(input.Name))
	if name == "" {
		problem.Write(w, 400, "Name is required", "")
		return
	}
	label, err := scanProjectLabel(h.DB.QueryRow(r.Context(), `insert into project_label (name,color,description,workspace_id) values ($1,$2,$3,$4::uuid) returning id::text,name,color,description,0::int,created_at,updated_at`, name, normalizeColor(value(input.Color), "#6b6f76"), nullableTrim(input.Description), p.WorkspaceID))
	if isUniqueViolation(err) {
		problem.Write(w, 409, "A project label with this name already exists", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Create project label failed", err.Error())
		return
	}
	problem.JSON(w, 201, projectLabelResponse{Label: label})
}

func (h Handler) UpdateProjectLabel(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	var input projectLabelRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	sets := []string{"updated_at=now()"}
	args := []any{}
	add := func(sql string, value any) {
		args = append(args, value)
		sets = append(sets, strings.Replace(sql, "?", "$"+itoa(len(args)), 1))
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			problem.Write(w, 400, "Name is required", "")
			return
		}
		add("name=?", name)
	}
	if input.Color != nil {
		if !hexColorRe.MatchString(*input.Color) {
			problem.Write(w, 400, "Invalid color", "")
			return
		}
		add("color=?", strings.ToLower(*input.Color))
	}
	if input.Description != nil {
		add("description=?", nullableTrim(input.Description))
	}
	args = append(args, id, p.WorkspaceID)
	label, err := scanProjectLabel(h.DB.QueryRow(r.Context(), `update project_label set `+strings.Join(sets, ",")+` where id=$`+itoa(len(args)-1)+`::uuid and workspace_id=$`+itoa(len(args))+`::uuid returning id::text,name,color,description,(select count(*)::int from project pr where pr.workspace_id=$`+itoa(len(args))+`::uuid and (pr.settings->'labelIds') ? project_label.id::text),created_at,updated_at`, args...))
	if isUniqueViolation(err) {
		problem.Write(w, 409, "A project label with this name already exists", "")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Project label not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update project label failed", err.Error())
		return
	}
	problem.JSON(w, 200, projectLabelResponse{Label: label})
}

func (h Handler) DeleteProjectLabel(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Delete project label failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	var exists int
	if err := tx.QueryRow(r.Context(), `select 1 from project_label where id=$1::uuid and workspace_id=$2::uuid`, id, p.WorkspaceID).Scan(&exists); errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Project label not found", "")
		return
	} else if err != nil {
		problem.Write(w, 500, "Delete project label failed", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `
		update project
		set settings = jsonb_set(
			coalesce(settings, '{}'::jsonb),
			'{labelIds}',
			coalesce(
				(
					select jsonb_agg(label_id)
					from jsonb_array_elements(coalesce(settings->'labelIds', '[]'::jsonb)) as label_ids(label_id)
					where label_id <> to_jsonb($1::text)
				),
				'[]'::jsonb
			),
			true
		)
		where workspace_id=$2::uuid
		  and coalesce(settings->'labelIds', '[]'::jsonb) ? $1`, id, p.WorkspaceID); err != nil {
		problem.Write(w, 500, "Delete project label failed", err.Error())
		return
	}
	cmd, err := tx.Exec(r.Context(), `delete from project_label where id=$1::uuid and workspace_id=$2::uuid`, id, p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Delete project label failed", err.Error())
		return
	}
	if cmd.RowsAffected() == 0 {
		problem.Write(w, 404, "Project label not found", "")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Delete project label failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func scanLabel(row scanner) (Label, error) {
	var l Label
	var archived *time.Time
	var last *time.Time
	var created, updated time.Time
	if err := row.Scan(&l.ID, &l.Name, &l.Color, &l.Description, &l.ParentLabelID, &l.TeamID, &l.TeamName, &l.TeamKey, &archived, &l.IssueCount, &last, &created, &updated); err != nil {
		return Label{}, err
	}
	if l.TeamID != nil {
		l.Scope = "team"
	} else {
		l.Scope = "workspace"
	}
	if archived != nil {
		v := archived.UTC().Format(time.RFC3339Nano)
		l.ArchivedAt = &v
	}
	if last != nil && l.IssueCount > 0 {
		v := last.UTC().Format(time.RFC3339Nano)
		l.LastApplied = &v
	}
	l.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	l.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
	return l, nil
}
func scanProjectLabel(row scanner) (ProjectLabel, error) {
	var l ProjectLabel
	var created, updated time.Time
	if err := row.Scan(&l.ID, &l.Name, &l.Color, &l.Description, &l.ProjectCount, &created, &updated); err != nil {
		return ProjectLabel{}, err
	}
	l.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	l.UpdatedAt = updated.UTC().Format(time.RFC3339Nano)
	return l, nil
}

type scanner interface{ Scan(dest ...any) error }

func (h Handler) teamInWorkspace(ctx context.Context, workspaceID, teamID string) (bool, error) {
	var one int
	err := h.DB.QueryRow(ctx, `select 1 from team where id=$1::uuid and workspace_id=$2::uuid`, teamID, workspaceID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
func (h Handler) requireLabels(ctx context.Context, workspaceID string, labelIDs []string) error {
	var count int
	if err := h.DB.QueryRow(ctx, `select count(*)::int from label where workspace_id=$1::uuid and id=any($2::uuid[])`, workspaceID, labelIDs).Scan(&count); err != nil {
		return err
	}
	if count != len(labelIDs) {
		return pgx.ErrNoRows
	}
	return nil
}
func (h Handler) currentLabelTeam(ctx context.Context, workspaceID, id string) (*string, error) {
	var teamID *string
	err := h.DB.QueryRow(ctx, `select team_id::text from label where id=$1::uuid and workspace_id=$2::uuid`, id, workspaceID).Scan(&teamID)
	return teamID, err
}
func (h Handler) validateParent(ctx context.Context, workspaceID string, teamID, parentID *string, currentID string) error {
	if parentID == nil {
		return nil
	}
	if currentID != "" && *parentID == currentID {
		return errParent("Label cannot be its own parent")
	}
	var found string
	err := h.DB.QueryRow(ctx, `select id::text from label where id=$1::uuid and workspace_id=$2::uuid and (($3::uuid is null and team_id is null) or team_id=$3::uuid)`, *parentID, workspaceID, teamID).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return errParent("Parent label not found")
	}
	return err
}

type errParent string

func (e errParent) Error() string { return string(e) }
func writeParentErr(w http.ResponseWriter, err error) {
	problem.Write(w, 400, "Invalid parent label", err.Error())
}
func nullableTrim(v *string) *string {
	if v == nil {
		return nil
	}
	s := strings.TrimSpace(*v)
	if s == "" {
		return nil
	}
	return &s
}
func value(v *string) string {
	if v == nil {
		return ""
	}
	return *v
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

var hexColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func normalizeColor(v, fallback string) string {
	if hexColorRe.MatchString(v) {
		return strings.ToLower(v)
	}
	return fallback
}
func itoa(i int) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(time.Duration(i).String(), "ns", ""), "0s", "0"))
}
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
func insertOperation(ctx context.Context, tx pgx.Tx, workspaceID, entityType, entityID, opType string, payload any, createdBy string) error {
	return syncapi.InsertOperation(ctx, tx, workspaceID, entityType, entityID, opType, payload, createdBy)
}
