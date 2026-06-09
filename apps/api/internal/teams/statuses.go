package teams

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

var statusCategories = []string{"triage", "backlog", "unstarted", "started", "completed", "canceled"}
var errDuplicateStatusMissing = errors.New("duplicate status missing")

type statusBehavior map[string]any

type workflowStatus struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	IssueCount  int64          `json:"issueCount"`
	Description *string        `json:"description"`
	Color       string         `json:"color"`
	Position    int32          `json:"position"`
	IsDefault   *bool          `json:"isDefault"`
	Behavior    statusBehavior `json:"behavior"`
}

type statusesResponse struct {
	Statuses          map[string][]workflowStatus `json:"statuses"`
	DuplicateStatusID *string                     `json:"duplicateStatusId"`
	CanManage         bool                        `json:"canManage"`
}

func (h Handler) ListStatuses(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeamRecord(r, p.WorkspaceID, chi.URLParam(r, "key"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Load team statuses failed", err.Error())
		return
	}
	h.writeStatuses(w, r, team)
}

func (h Handler) CreateStatus(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.requireStatusManage(w, r, p.WorkspaceID, chi.URLParam(r, "key"), p.Role)
	if !ok {
		return
	}
	body, ok := decodeStatusBody(w, r)
	if !ok {
		return
	}
	category, _ := body["category"].(string)
	if !isStatusCategory(category) {
		problem.Write(w, 400, "Invalid status category", "")
		return
	}
	name := normalizeStatusName(body["name"])
	if name == "" {
		problem.Write(w, 400, "Status name is required", "")
		return
	}
	color, colorOK := normalizeStatusColor(body["color"])
	if !colorOK {
		problem.Write(w, 400, "Color must be a hex value", "")
		return
	}
	behavior, behaviorOK, behaviorSet := normalizeStatusBehavior(body["behavior"])
	if !behaviorOK {
		problem.Write(w, 400, "Invalid status behavior", "")
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Create status failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err := lockTeamForWorkflowStateRepair(r.Context(), tx, team.ID); err != nil {
		problem.Write(w, 500, "Create status failed", err.Error())
		return
	}
	var nameExists bool
	if err := tx.QueryRow(r.Context(), `select exists(select 1 from workflow_state where team_id=$1::uuid and category=$2 and lower(name)=lower($3))`, team.ID, category, name).Scan(&nameExists); err != nil {
		problem.Write(w, 500, "Create status failed", err.Error())
		return
	}
	if nameExists {
		problem.Write(w, 409, "A status with that name already exists in this category", "")
		return
	}
	var statusCount int64
	var highestPosition int32
	if err := tx.QueryRow(r.Context(), `select count(*), coalesce(max(position), 0)::int from workflow_state where team_id=$1::uuid and category=$2`, team.ID, category).Scan(&statusCount, &highestPosition); err != nil {
		problem.Write(w, 500, "Create status failed", err.Error())
		return
	}
	nextPosition := int32(0)
	if statusCount > 0 {
		nextPosition = highestPosition + 1
	}
	isDefault := statusCount == 0
	description := normalizeStatusDescription(body["description"], true)
	var createdID string
	if err := tx.QueryRow(r.Context(), `insert into workflow_state (team_id,category,name,description,color,position,is_default,updated_at) values ($1::uuid,$2,$3,$4,$5,$6,$7,now()) returning id::text`, team.ID, category, name, description, valueOrString(color, "#6b6f76"), nextPosition, isDefault).Scan(&createdID); err != nil {
		problem.Write(w, 500, "Create status failed", err.Error())
		return
	}
	if behaviorSet {
		var settingsRaw []byte
		if err := tx.QueryRow(r.Context(), `select coalesce(settings,'{}'::jsonb) from team where id=$1::uuid`, team.ID).Scan(&settingsRaw); err != nil {
			problem.Write(w, 500, "Create status failed", err.Error())
			return
		}
		team.Settings = map[string]any{}
		_ = json.Unmarshal(settingsRaw, &team.Settings)
		team.Settings = setStatusBehavior(team.Settings, createdID, behavior)
		raw, _ := json.Marshal(team.Settings)
		if _, err := tx.Exec(r.Context(), `update team set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, team.ID); err != nil {
			problem.Write(w, 500, "Create status failed", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Create status failed", err.Error())
		return
	}
	h.writeStatuses(w, r, team)
}

func (h Handler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.requireStatusManage(w, r, p.WorkspaceID, chi.URLParam(r, "key"), p.Role)
	if !ok {
		return
	}
	body, ok := decodeStatusBody(w, r)
	if !ok {
		return
	}
	if duplicateID, ok := body["duplicateStatusId"].(string); ok {
		settings, err := h.mutateTeamSettingsLocked(r, team.ID, func(tx pgx.Tx, settings map[string]any) (map[string]any, error) {
			var exists bool
			if err := tx.QueryRow(r.Context(), `select exists(select 1 from workflow_state where team_id=$1::uuid and id=$2::uuid)`, team.ID, duplicateID).Scan(&exists); err != nil {
				return settings, err
			}
			if !exists {
				return settings, errDuplicateStatusMissing
			}
			settings["duplicateIssueStatusId"] = duplicateID
			return settings, nil
		})
		if errors.Is(err, errDuplicateStatusMissing) {
			problem.Write(w, 400, "Duplicate issue status must exist on this team", "")
			return
		} else if err != nil {
			problem.Write(w, 500, "Update statuses failed", err.Error())
			return
		}
		team.Settings = settings
		h.writeStatuses(w, r, team)
		return
	}
	if reorderRaw, ok := body["reorder"].(map[string]any); ok {
		h.reorderStatuses(w, r, team, reorderRaw)
		return
	}
	id, _ := body["id"].(string)
	if strings.TrimSpace(id) == "" {
		problem.Write(w, 400, "Status id is required", "")
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Update status failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err := lockTeamForWorkflowStateRepair(r.Context(), tx, team.ID); err != nil {
		problem.Write(w, 500, "Update status failed", err.Error())
		return
	}
	var settingsRaw []byte
	if err := tx.QueryRow(r.Context(), `select triage_enabled, coalesce(settings,'{}'::jsonb) from team where id=$1::uuid`, team.ID).Scan(&team.TriageEnabled, &settingsRaw); err != nil {
		problem.Write(w, 500, "Update status failed", err.Error())
		return
	}
	team.Settings = map[string]any{}
	_ = json.Unmarshal(settingsRaw, &team.Settings)
	var existing statusSummary
	err = tx.QueryRow(r.Context(), `select id::text,category::text,coalesce(is_default,false) from workflow_state where team_id=$1::uuid and id=$2::uuid for update`, team.ID, id).Scan(&existing.ID, &existing.Category, &existing.IsDefault)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Status not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update status failed", err.Error())
		return
	}
	nextCategory := existing.Category
	if raw, present := body["category"]; present {
		cat, _ := raw.(string)
		if !isStatusCategory(cat) {
			problem.Write(w, 400, "Invalid status category", "")
			return
		}
		nextCategory = cat
	}
	name := ""
	nameSet := false
	if _, present := body["name"]; present {
		nameSet = true
		name = normalizeStatusName(body["name"])
		if name == "" {
			problem.Write(w, 400, "Status name is required", "")
			return
		}
		var nameExists bool
		if err := tx.QueryRow(r.Context(), `select exists(select 1 from workflow_state where team_id=$1::uuid and category=$2 and lower(name)=lower($3) and id<>$4::uuid)`, team.ID, nextCategory, name, id).Scan(&nameExists); err != nil {
			problem.Write(w, 500, "Update status failed", err.Error())
			return
		}
		if nameExists {
			problem.Write(w, 409, "A status with that name already exists in this category", "")
			return
		}
	}
	color, colorOK := normalizeStatusColor(body["color"])
	if !colorOK {
		problem.Write(w, 400, "Color must be a hex value", "")
		return
	}
	behavior, behaviorOK, behaviorSet := normalizeStatusBehavior(body["behavior"])
	if !behaviorOK {
		problem.Write(w, 400, "Invalid status behavior", "")
		return
	}
	var targetStatusCount int64
	var targetMaxPosition int32
	if err := tx.QueryRow(r.Context(), `select count(*), coalesce(max(position), 0)::int from workflow_state where team_id=$1::uuid and category=$2`, team.ID, nextCategory).Scan(&targetStatusCount, &targetMaxPosition); err != nil {
		problem.Write(w, 500, "Update status failed", err.Error())
		return
	}
	nextIsDefault := existing.IsDefault
	if _, present := body["isDefault"]; present {
		nextIsDefault = body["isDefault"] == true
	}
	if targetStatusCount == 0 && nextCategory != existing.Category {
		nextIsDefault = true
	}
	if existing.Category == "triage" && nextCategory != "triage" && boolPtrVal(team.TriageEnabled, true) {
		var hasOtherTriage bool
		if err := tx.QueryRow(r.Context(), `select exists(select 1 from workflow_state where team_id=$1::uuid and category='triage' and id<>$2::uuid)`, team.ID, id).Scan(&hasOtherTriage); err != nil {
			problem.Write(w, 500, "Update status failed", err.Error())
			return
		}
		if shouldBlockTriageStatusDelete(team, existing, hasOtherTriage) {
			problem.Write(w, 400, "Teams with triage enabled must keep a Triage status", "")
			return
		}
	}
	if existing.IsDefault && (nextCategory != existing.Category || !nextIsDefault) {
		var hasOther bool
		if err := tx.QueryRow(r.Context(), `select exists(select 1 from workflow_state where team_id=$1::uuid and category=$2 and coalesce(is_default,false)=true and id<>$3::uuid)`, team.ID, existing.Category, id).Scan(&hasOther); err != nil {
			problem.Write(w, 500, "Update status failed", err.Error())
			return
		}
		if !hasOther {
			problem.Write(w, 400, "Each workflow category must have a default status", "")
			return
		}
	}
	setParts := []string{"updated_at=now()"}
	args := []any{}
	add := func(expr string, value any) {
		args = append(args, value)
		setParts = append(setParts, fmt.Sprintf(expr, len(args)))
	}
	if nameSet {
		add("name=$%d", name)
	}
	if _, present := body["description"]; present {
		add("description=$%d", normalizeStatusDescription(body["description"], true))
	}
	if color != nil {
		add("color=$%d", *color)
	}
	if _, present := body["category"]; present {
		add("category=$%d", nextCategory)
	}
	if _, present := body["category"]; present && nextCategory != existing.Category {
		add("position=$%d", targetMaxPosition+1)
	}
	if _, present := body["isDefault"]; present || (targetStatusCount == 0 && nextCategory != existing.Category) {
		add("is_default=$%d", nextIsDefault)
	}
	args = append(args, id, team.ID)
	query := fmt.Sprintf("update workflow_state set %s where id=$%d::uuid and team_id=$%d::uuid", strings.Join(setParts, ", "), len(args)-1, len(args))
	if _, err := tx.Exec(r.Context(), query, args...); err != nil {
		problem.Write(w, 500, "Update status failed", err.Error())
		return
	}
	if behaviorSet {
		existingBehavior := statusBehaviorFor(team.Settings, id)
		nextBehavior := statusBehavior{}
		for key, value := range behavior {
			nextBehavior[key] = value
		}
		if nextBehavior["slaBehavior"] == "inherit" {
			if existingSLA, ok := existingBehavior["slaBehavior"].(string); ok && existingSLA != "" && existingSLA != "inherit" {
				nextBehavior["slaBehavior"] = existingSLA
			}
		}
		team.Settings = setStatusBehavior(team.Settings, id, nextBehavior)
	}
	if nextCategory != existing.Category {
		clearInvalidTriageDestinationSettings(team.Settings, id, nextCategory)
	}
	if behaviorSet || nextCategory != existing.Category {
		if err := saveTeamSettingsTx(r.Context(), tx, team.ID, team.Settings); err != nil {
			problem.Write(w, 500, "Update status failed", err.Error())
			return
		}
	}
	if nextIsDefault {
		if _, err := tx.Exec(r.Context(), `update workflow_state set is_default=false, updated_at=now() where team_id=$1::uuid and category=$2 and id<>$3::uuid`, team.ID, nextCategory, id); err != nil {
			problem.Write(w, 500, "Update status failed", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Update status failed", err.Error())
		return
	}
	h.writeStatuses(w, r, team)
}

func (h Handler) DeleteStatus(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.requireStatusManage(w, r, p.WorkspaceID, chi.URLParam(r, "key"), p.Role)
	if !ok {
		return
	}
	body, ok := decodeStatusBody(w, r)
	if !ok {
		return
	}
	id, _ := body["id"].(string)
	if strings.TrimSpace(id) == "" {
		problem.Write(w, 400, "Status id is required", "")
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Delete status failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err := lockTeamForWorkflowStateRepair(r.Context(), tx, team.ID); err != nil {
		problem.Write(w, 500, "Delete status failed", err.Error())
		return
	}
	var settingsRaw []byte
	if err := tx.QueryRow(r.Context(), `select triage_enabled, coalesce(settings,'{}'::jsonb) from team where id=$1::uuid`, team.ID).Scan(&team.TriageEnabled, &settingsRaw); err != nil {
		problem.Write(w, 500, "Delete status failed", err.Error())
		return
	}
	team.Settings = map[string]any{}
	_ = json.Unmarshal(settingsRaw, &team.Settings)
	var existing statusSummary
	err = tx.QueryRow(r.Context(), `select id::text,category::text,coalesce(is_default,false) from workflow_state where team_id=$1::uuid and id=$2::uuid for update`, team.ID, id).Scan(&existing.ID, &existing.Category, &existing.IsDefault)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Status not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Delete status failed", err.Error())
		return
	}
	if existing.IsDefault {
		problem.Write(w, 400, "Default statuses cannot be deleted", "")
		return
	}
	if existing.Category == "triage" && boolPtrVal(team.TriageEnabled, true) {
		var hasOther bool
		if err := tx.QueryRow(r.Context(), `select exists(select 1 from workflow_state where team_id=$1::uuid and category='triage' and id<>$2::uuid)`, team.ID, id).Scan(&hasOther); err != nil {
			problem.Write(w, 500, "Delete status failed", err.Error())
			return
		}
		if shouldBlockTriageStatusDelete(team, existing, hasOther) {
			problem.Write(w, 400, "Teams with triage enabled must keep a Triage status", "")
			return
		}
	}
	var issueCount int64
	if err := tx.QueryRow(r.Context(), `select count(*) from issue where state_id=$1::uuid`, id).Scan(&issueCount); err != nil {
		problem.Write(w, 500, "Delete status failed", err.Error())
		return
	}
	if issueCount > 0 {
		replacementID, _ := body["replacementStatusId"].(string)
		if replacementID == "" || replacementID == id {
			problem.Write(w, 400, "Replacement status must exist on this team", "")
			return
		}
		var exists bool
		if err := tx.QueryRow(r.Context(), `select exists(select 1 from workflow_state where team_id=$1::uuid and id=$2::uuid)`, team.ID, replacementID).Scan(&exists); err != nil {
			problem.Write(w, 500, "Delete status failed", err.Error())
			return
		}
		if !exists {
			problem.Write(w, 400, "Replacement status must exist on this team", "")
			return
		}
		if _, err := tx.Exec(r.Context(), `update issue set state_id=$1::uuid where state_id=$2::uuid`, replacementID, id); err != nil {
			problem.Write(w, 500, "Delete status failed", err.Error())
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `delete from workflow_state where id=$1::uuid and team_id=$2::uuid`, id, team.ID); err != nil {
		problem.Write(w, 500, "Delete status failed", err.Error())
		return
	}
	team.Settings = deleteStatusBehavior(team.Settings, id)
	if team.Settings["duplicateIssueStatusId"] == id {
		fallback := ""
		err := tx.QueryRow(r.Context(), `select id::text from workflow_state where team_id=$1::uuid and category='canceled' order by coalesce(is_default,false) desc, position asc limit 1`, team.ID).Scan(&fallback)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			problem.Write(w, 500, "Delete status failed", err.Error())
			return
		}
		if fallback == "" {
			delete(team.Settings, "duplicateIssueStatusId")
		} else {
			team.Settings["duplicateIssueStatusId"] = fallback
		}
	}
	_ = clearStatusSettingIfMatches(team.Settings, "triageAcceptDestinationStateId", id)
	_ = clearStatusSettingIfMatches(team.Settings, "triageDeclineDestinationStateId", id)
	if err := saveTeamSettingsTx(r.Context(), tx, team.ID, team.Settings); err != nil {
		problem.Write(w, 500, "Delete status failed", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Delete status failed", err.Error())
		return
	}
	h.writeStatuses(w, r, team)
}

type statusSummary struct {
	ID, Category string
	IsDefault    bool
}

func (h Handler) writeStatuses(w http.ResponseWriter, r *http.Request, team teamRecordForSettings) {
	rows, err := h.DB.Query(r.Context(), `select id::text,name,category::text,description,color,position,is_default from workflow_state where team_id=$1::uuid order by position asc, name asc`, team.ID)
	if err != nil {
		problem.Write(w, 500, "Load team statuses failed", err.Error())
		return
	}
	defer rows.Close()
	statuses := map[string][]workflowStatus{}
	for _, category := range statusCategories {
		statuses[category] = []workflowStatus{}
	}
	ids := []string{}
	for rows.Next() {
		var s workflowStatus
		var category string
		if err := rows.Scan(&s.ID, &s.Name, &category, &s.Description, &s.Color, &s.Position, &s.IsDefault); err != nil {
			problem.Write(w, 500, "Load team statuses failed", err.Error())
			return
		}
		s.Behavior = statusBehaviorFor(team.Settings, s.ID)
		statuses[category] = append(statuses[category], s)
		ids = append(ids, s.ID)
	}
	if err := rows.Err(); err != nil {
		problem.Write(w, 500, "Load team statuses failed", err.Error())
		return
	}
	counts, err := h.statusIssueCounts(r, team.ID)
	if err != nil {
		problem.Write(w, 500, "Load team statuses failed", err.Error())
		return
	}
	for category, items := range statuses {
		for i := range items {
			items[i].IssueCount = counts[items[i].ID]
		}
		statuses[category] = items
	}
	duplicateID := duplicateIssueStatusID(team.Settings, statuses, ids)
	var duplicate *string
	if duplicateID != "" {
		duplicate = &duplicateID
	}
	problem.JSON(w, 200, statusesResponse{Statuses: statuses, DuplicateStatusID: duplicate, CanManage: true})
}

func duplicateIssueStatusID(settings map[string]any, statuses map[string][]workflowStatus, ids []string) string {
	duplicateID := stringSetting(settings, "duplicateIssueStatusId")
	if duplicateID != "" && contains(ids, duplicateID) {
		return duplicateID
	}
	if items := statuses["canceled"]; len(items) > 0 {
		return items[0].ID
	}
	return ""
}

func (h Handler) requireStatusManage(w http.ResponseWriter, r *http.Request, workspaceID, key, role string) (teamRecordForSettings, bool) {
	team, err := h.findTeamRecord(r, workspaceID, key)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "Team not found", "")
		return team, false
	}
	if err != nil {
		problem.Write(w, 500, "Load team statuses failed", err.Error())
		return team, false
	}
	if !isAdmin(role) {
		problem.Write(w, 403, "Only workspace admins can manage team statuses", "")
		return team, false
	}
	return team, true
}

func shouldBlockTriageStatusDelete(team teamRecordForSettings, existing statusSummary, hasOtherTriageStatus bool) bool {
	return existing.Category == "triage" && boolPtrVal(team.TriageEnabled, true) && !hasOtherTriageStatus
}

func (h Handler) reorderStatuses(w http.ResponseWriter, r *http.Request, team teamRecordForSettings, reorder map[string]any) {
	category, _ := reorder["category"].(string)
	orderedRaw, ok := reorder["orderedIds"].([]any)
	if !isStatusCategory(category) || !ok {
		problem.Write(w, 400, "Invalid reorder payload", "")
		return
	}
	ordered := []string{}
	for _, raw := range orderedRaw {
		id, ok := raw.(string)
		if !ok {
			problem.Write(w, 400, "Invalid reorder payload", "")
			return
		}
		ordered = append(ordered, id)
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problem.Write(w, 500, "Update statuses failed", err.Error())
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err := lockTeamForWorkflowStateRepair(r.Context(), tx, team.ID); err != nil {
		problem.Write(w, 500, "Update statuses failed", err.Error())
		return
	}
	rows, err := tx.Query(r.Context(), `select id::text from workflow_state where team_id=$1::uuid and category=$2`, team.ID, category)
	if err != nil {
		problem.Write(w, 500, "Update statuses failed", err.Error())
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			problem.Write(w, 500, "Update statuses failed", err.Error())
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		problem.Write(w, 500, "Update statuses failed", err.Error())
		return
	}
	if !sameStringSet(ids, ordered) {
		problem.Write(w, 400, "Reorder must include every status in the category", "")
		return
	}
	for position, id := range ordered {
		if _, err := tx.Exec(r.Context(), `update workflow_state set position=$1, updated_at=now() where id=$2::uuid`, position, id); err != nil {
			problem.Write(w, 500, "Update statuses failed", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		problem.Write(w, 500, "Update statuses failed", err.Error())
		return
	}
	h.writeStatuses(w, r, team)
}

func (h Handler) statusIssueCounts(r *http.Request, teamID string) (map[string]int64, error) {
	rows, err := h.DB.Query(r.Context(), `select state_id::text,count(*) from issue where team_id=$1::uuid group by state_id`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var id string
		var count int64
		if err := rows.Scan(&id, &count); err != nil {
			return nil, err
		}
		out[id] = count
	}
	return out, rows.Err()
}

func (h Handler) mutateTeamSettingsLocked(r *http.Request, teamID string, mutate func(pgx.Tx, map[string]any) (map[string]any, error)) (map[string]any, error) {
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if err := lockTeamForWorkflowStateRepair(r.Context(), tx, teamID); err != nil {
		return nil, err
	}
	var settingsRaw []byte
	if err := tx.QueryRow(r.Context(), `select coalesce(settings,'{}'::jsonb) from team where id=$1::uuid`, teamID).Scan(&settingsRaw); err != nil {
		return nil, err
	}
	settings := map[string]any{}
	_ = json.Unmarshal(settingsRaw, &settings)
	settings, err = mutate(tx, settings)
	if err != nil {
		return settings, err
	}
	raw, _ := json.Marshal(settings)
	if _, err := tx.Exec(r.Context(), `update team set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, teamID); err != nil {
		return settings, err
	}
	return settings, tx.Commit(r.Context())
}

func decodeStatusBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body == nil {
		problem.Write(w, 400, "Invalid JSON body", "")
		return nil, false
	}
	return body, true
}

func isStatusCategory(value string) bool {
	for _, category := range statusCategories {
		if value == category {
			return true
		}
	}
	return false
}
func normalizeStatusName(value any) string {
	if s, ok := value.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}
func normalizeStatusDescription(value any, present bool) *string {
	if !present || value == nil {
		return nil
	}
	s, ok := value.(string)
	if !ok {
		return nil
	}
	t := strings.TrimSpace(s)
	if t == "" {
		return nil
	}
	return &t
}
func normalizeStatusColor(value any) (*string, bool) {
	if value == nil {
		return nil, true
	}
	s, ok := value.(string)
	if !ok {
		return nil, false
	}
	s = strings.ToLower(strings.TrimSpace(s))
	if len(s) != 7 || s[0] != '#' {
		return nil, false
	}
	for _, c := range s[1:] {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return nil, false
		}
	}
	return &s, true
}
func normalizeStatusBehavior(value any) (statusBehavior, bool, bool) {
	if value == nil {
		return nil, true, false
	}
	m, ok := value.(map[string]any)
	if !ok {
		return nil, false, true
	}
	terminal, _ := m["terminalBehavior"].(string)
	if terminal == "" {
		terminal = "standard"
	}
	if !contains([]string{"standard", "completed", "canceled"}, terminal) {
		return nil, false, true
	}
	sla, _ := m["slaBehavior"].(string)
	if sla == "" {
		sla = "inherit"
	}
	if !contains([]string{"inherit", "pause", "complete", "ignore"}, sla) {
		return nil, false, true
	}
	var archive any
	if v, ok := m["autoArchiveDays"]; ok && v != nil {
		n, ok := v.(float64)
		if !ok || math.Trunc(n) != n || n < 0 || n > 3650 {
			return nil, false, true
		}
		archive = n
	} else {
		archive = nil
	}
	return statusBehavior{"terminalBehavior": terminal, "autoArchiveDays": archive, "slaBehavior": sla}, true, true
}
func statusBehaviorFor(settings map[string]any, id string) statusBehavior {
	behaviors, _ := settings["statusBehaviors"].(map[string]any)
	if b, ok := behaviors[id].(map[string]any); ok {
		return b
	}
	return statusBehavior{}
}
func setStatusBehavior(settings map[string]any, id string, behavior statusBehavior) map[string]any {
	if settings == nil {
		settings = map[string]any{}
	}
	behaviors, _ := settings["statusBehaviors"].(map[string]any)
	if behaviors == nil {
		behaviors = map[string]any{}
	}
	behaviors[id] = behavior
	settings["statusBehaviors"] = behaviors
	return settings
}
func deleteStatusBehavior(settings map[string]any, id string) map[string]any {
	if settings == nil {
		return map[string]any{}
	}
	behaviors, _ := settings["statusBehaviors"].(map[string]any)
	if behaviors != nil {
		delete(behaviors, id)
		settings["statusBehaviors"] = behaviors
	}
	return settings
}
func clearInvalidTriageDestinationSettings(settings map[string]any, id, category string) {
	if !triageAcceptCategories[category] {
		_ = clearStatusSettingIfMatches(settings, "triageAcceptDestinationStateId", id)
	}
	if category != "canceled" {
		_ = clearStatusSettingIfMatches(settings, "triageDeclineDestinationStateId", id)
	}
}

func reconcileTriageDestinationSettings(ctx context.Context, tx pgx.Tx, teamID string, settings map[string]any) error {
	if err := reconcileTriageDestinationSetting(ctx, tx, teamID, settings, "triageAcceptDestinationStateId", triageAcceptCategories); err != nil {
		return err
	}
	return reconcileTriageDestinationSetting(ctx, tx, teamID, settings, "triageDeclineDestinationStateId", map[string]bool{"canceled": true})
}

func reconcileTriageDestinationSetting(ctx context.Context, tx pgx.Tx, teamID string, settings map[string]any, key string, allowed map[string]bool) error {
	value, ok := settings[key].(string)
	value = strings.TrimSpace(value)
	if !ok || value == "" {
		delete(settings, key)
		return nil
	}
	var category string
	err := tx.QueryRow(ctx, `select category::text from workflow_state where team_id=$1::uuid and id=$2::uuid`, teamID, value).Scan(&category)
	if errors.Is(err, pgx.ErrNoRows) {
		delete(settings, key)
		return nil
	}
	if err != nil {
		return err
	}
	if !allowed[category] {
		delete(settings, key)
		return nil
	}
	settings[key] = value
	return nil
}

func clearStatusSettingIfMatches(settings map[string]any, key, id string) bool {
	if value, ok := settings[key].(string); ok && value == id {
		delete(settings, key)
		return true
	}
	return false
}

func saveTeamSettingsTx(ctx context.Context, tx pgx.Tx, teamID string, settings map[string]any) error {
	raw, _ := json.Marshal(settings)
	_, err := tx.Exec(ctx, `update team set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, teamID)
	return err
}
func stringSetting(settings map[string]any, key string) string {
	if v, ok := settings[key].(string); ok {
		return v
	}
	return ""
}
func maxPosition(values []int32) int32 {
	max := int32(-1)
	for _, value := range values {
		if value > max {
			max = value
		}
	}
	return max
}
func valueOrString(value *string, fallback string) string {
	if value == nil {
		return fallback
	}
	return *value
}
func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func sameStringSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	aa := append([]string{}, a...)
	bb := append([]string{}, b...)
	sort.Strings(aa)
	sort.Strings(bb)
	for i := range aa {
		if aa[i] != bb[i] {
			return false
		}
	}
	return true
}
