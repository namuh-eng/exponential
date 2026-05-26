package teams

import (
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
	unique, err := h.statusNameUnique(r, team.ID, category, name, "")
	if err != nil {
		problem.Write(w, 500, "Create status failed", err.Error())
		return
	}
	if !unique {
		problem.Write(w, 409, "A status with that name already exists in this category", "")
		return
	}
	positions, err := h.categoryStatusPositions(r, team.ID, category)
	if err != nil {
		problem.Write(w, 500, "Create status failed", err.Error())
		return
	}
	nextPosition := int32(0)
	if len(positions) > 0 {
		nextPosition = maxPosition(positions) + 1
	}
	isDefault := len(positions) == 0
	description := normalizeStatusDescription(body["description"], true)
	var createdID string
	if err := h.DB.QueryRow(r.Context(), `insert into workflow_state (team_id,category,name,description,color,position,is_default,updated_at) values ($1::uuid,$2,$3,$4,$5,$6,$7,now()) returning id::text`, team.ID, category, name, description, valueOrString(color, "#6b6f76"), nextPosition, isDefault).Scan(&createdID); err != nil {
		problem.Write(w, 500, "Create status failed", err.Error())
		return
	}
	if behaviorSet {
		team.Settings = setStatusBehavior(team.Settings, createdID, behavior)
		if err := h.saveTeamSettings(r, team.ID, team.Settings); err != nil {
			problem.Write(w, 500, "Create status failed", err.Error())
			return
		}
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
		exists, err := h.statusExists(r, team.ID, duplicateID)
		if err != nil {
			problem.Write(w, 500, "Update statuses failed", err.Error())
			return
		}
		if !exists {
			problem.Write(w, 400, "Duplicate issue status must exist on this team", "")
			return
		}
		team.Settings["duplicateIssueStatusId"] = duplicateID
		if err := h.saveTeamSettings(r, team.ID, team.Settings); err != nil {
			problem.Write(w, 500, "Update statuses failed", err.Error())
			return
		}
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
	existing, err := h.statusSummary(r, team.ID, id)
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
		unique, err := h.statusNameUnique(r, team.ID, nextCategory, name, id)
		if err != nil {
			problem.Write(w, 500, "Update status failed", err.Error())
			return
		}
		if !unique {
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
	targetPositions, err := h.categoryStatusPositions(r, team.ID, nextCategory)
	if err != nil {
		problem.Write(w, 500, "Update status failed", err.Error())
		return
	}
	nextIsDefault := existing.IsDefault
	if _, present := body["isDefault"]; present {
		nextIsDefault = body["isDefault"] == true
	}
	if len(targetPositions) == 0 && nextCategory != existing.Category {
		nextIsDefault = true
	}
	if existing.IsDefault && (nextCategory != existing.Category || !nextIsDefault) {
		hasOther, err := h.categoryHasOtherDefault(r, team.ID, existing.Category, id)
		if err != nil {
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
		add("position=$%d", maxPosition(targetPositions)+1)
	}
	if _, present := body["isDefault"]; present || (len(targetPositions) == 0 && nextCategory != existing.Category) {
		add("is_default=$%d", nextIsDefault)
	}
	args = append(args, id, team.ID)
	query := fmt.Sprintf("update workflow_state set %s where id=$%d::uuid and team_id=$%d::uuid", strings.Join(setParts, ", "), len(args)-1, len(args))
	if _, err := h.DB.Exec(r.Context(), query, args...); err != nil {
		problem.Write(w, 500, "Update status failed", err.Error())
		return
	}
	if behaviorSet {
		existingBehavior := statusBehaviorFor(team.Settings, id)
		if behavior["slaBehavior"] == "inherit" {
			if existingSLA, ok := existingBehavior["slaBehavior"].(string); ok && existingSLA != "" && existingSLA != "inherit" {
				behavior["slaBehavior"] = existingSLA
			}
		}
		team.Settings = setStatusBehavior(team.Settings, id, behavior)
		if err := h.saveTeamSettings(r, team.ID, team.Settings); err != nil {
			problem.Write(w, 500, "Update status failed", err.Error())
			return
		}
	}
	if nextIsDefault {
		if _, err := h.DB.Exec(r.Context(), `update workflow_state set is_default=false, updated_at=now() where team_id=$1::uuid and category=$2 and id<>$3::uuid`, team.ID, nextCategory, id); err != nil {
			problem.Write(w, 500, "Update status failed", err.Error())
			return
		}
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
	existing, err := h.statusSummary(r, team.ID, id)
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
	var issueCount int64
	if err := h.DB.QueryRow(r.Context(), `select count(*) from issue where state_id=$1::uuid`, id).Scan(&issueCount); err != nil {
		problem.Write(w, 500, "Delete status failed", err.Error())
		return
	}
	if issueCount > 0 {
		replacementID, _ := body["replacementStatusId"].(string)
		exists, err := h.statusExists(r, team.ID, replacementID)
		if err != nil {
			problem.Write(w, 500, "Delete status failed", err.Error())
			return
		}
		if replacementID == "" || replacementID == id || !exists {
			problem.Write(w, 400, "Replacement status must exist on this team", "")
			return
		}
		if _, err := h.DB.Exec(r.Context(), `update issue set state_id=$1::uuid where state_id=$2::uuid`, replacementID, id); err != nil {
			problem.Write(w, 500, "Delete status failed", err.Error())
			return
		}
	}
	if _, err := h.DB.Exec(r.Context(), `delete from workflow_state where id=$1::uuid and team_id=$2::uuid`, id, team.ID); err != nil {
		problem.Write(w, 500, "Delete status failed", err.Error())
		return
	}
	team.Settings = deleteStatusBehavior(team.Settings, id)
	if team.Settings["duplicateIssueStatusId"] == id {
		fallback, _ := h.firstStatusID(r, team.ID)
		if fallback == "" {
			delete(team.Settings, "duplicateIssueStatusId")
		} else {
			team.Settings["duplicateIssueStatusId"] = fallback
		}
	}
	if err := h.saveTeamSettings(r, team.ID, team.Settings); err != nil {
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
	duplicateID := stringSetting(team.Settings, "duplicateIssueStatusId")
	if duplicateID == "" || !contains(ids, duplicateID) {
		duplicateID = ""
		if items := statuses["canceled"]; len(items) > 0 {
			duplicateID = items[0].ID
		} else if len(ids) > 0 {
			duplicateID = ids[0]
		}
	}
	var duplicate *string
	if duplicateID != "" {
		duplicate = &duplicateID
	}
	problem.JSON(w, 200, statusesResponse{Statuses: statuses, DuplicateStatusID: duplicate, CanManage: true})
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

func (h Handler) statusSummary(r *http.Request, teamID, id string) (statusSummary, error) {
	var out statusSummary
	err := h.DB.QueryRow(r.Context(), `select id::text,category::text,coalesce(is_default,false) from workflow_state where team_id=$1::uuid and id=$2::uuid`, teamID, id).Scan(&out.ID, &out.Category, &out.IsDefault)
	return out, err
}

func (h Handler) statusExists(r *http.Request, teamID, id string) (bool, error) {
	if id == "" {
		return false, nil
	}
	var exists bool
	err := h.DB.QueryRow(r.Context(), `select exists(select 1 from workflow_state where team_id=$1::uuid and id=$2::uuid)`, teamID, id).Scan(&exists)
	return exists, err
}

func (h Handler) statusNameUnique(r *http.Request, teamID, category, name, ignoreID string) (bool, error) {
	rows, err := h.DB.Query(r.Context(), `select id::text,name from workflow_state where team_id=$1::uuid and category=$2`, teamID, category)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, existing string
		if err := rows.Scan(&id, &existing); err != nil {
			return false, err
		}
		if id != ignoreID && strings.EqualFold(existing, name) {
			return false, nil
		}
	}
	return true, rows.Err()
}

func (h Handler) categoryStatusPositions(r *http.Request, teamID, category string) ([]int32, error) {
	rows, err := h.DB.Query(r.Context(), `select position from workflow_state where team_id=$1::uuid and category=$2`, teamID, category)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []int32{}
	for rows.Next() {
		var position int32
		if err := rows.Scan(&position); err != nil {
			return nil, err
		}
		out = append(out, position)
	}
	return out, rows.Err()
}

func (h Handler) categoryHasOtherDefault(r *http.Request, teamID, category, ignoreID string) (bool, error) {
	var exists bool
	err := h.DB.QueryRow(r.Context(), `select exists(select 1 from workflow_state where team_id=$1::uuid and category=$2 and coalesce(is_default,false)=true and id<>$3::uuid)`, teamID, category, ignoreID).Scan(&exists)
	return exists, err
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
	rows, err := h.DB.Query(r.Context(), `select id::text from workflow_state where team_id=$1::uuid and category=$2`, team.ID, category)
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
	if !sameStringSet(ids, ordered) {
		problem.Write(w, 400, "Reorder must include every status in the category", "")
		return
	}
	for position, id := range ordered {
		if _, err := h.DB.Exec(r.Context(), `update workflow_state set position=$1, updated_at=now() where id=$2::uuid`, position, id); err != nil {
			problem.Write(w, 500, "Update statuses failed", err.Error())
			return
		}
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

func (h Handler) firstStatusID(r *http.Request, teamID string) (string, error) {
	var id string
	err := h.DB.QueryRow(r.Context(), `select id::text from workflow_state where team_id=$1::uuid order by position asc limit 1`, teamID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func (h Handler) saveTeamSettings(r *http.Request, teamID string, settings map[string]any) error {
	raw, _ := json.Marshal(settings)
	_, err := h.DB.Exec(r.Context(), `update team set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, teamID)
	return err
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
