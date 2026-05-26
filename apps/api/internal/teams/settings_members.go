package teams

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type teamRecord struct {
	ID                 string
	WorkspaceID        string
	Name               string
	Key                string
	Icon               *string
	Timezone           *string
	EstimateType       *string
	TriageEnabled      *bool
	CyclesEnabled      *bool
	CycleStartDay      *int
	CycleDurationWeeks *int
	Settings           map[string]any
}

type teamMemberEntry struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind"`
	UserID    *string  `json:"userId"`
	Name      string   `json:"name"`
	Email     string   `json:"email"`
	Role      string   `json:"role"`
	Status    string   `json:"status"`
	Actions   []string `json:"actions"`
	InvitedAt *string  `json:"invitedAt,omitempty"`
}

func (h Handler) TeamMembers(w http.ResponseWriter, r *http.Request) {
	team, ok := h.requireTeamAccess(w, r, false)
	if !ok {
		return
	}
	members, err := h.teamMemberList(r, team)
	if err != nil {
		problem.Write(w, 500, "List team members failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"members": members})
}

func (h Handler) UpdateTeamMembers(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.requireTeamAccess(w, r, true)
	if !ok {
		return
	}
	var body struct {
		UserIDs       []string `json:"userIds"`
		InvitationIDs []string `json:"invitationIds"`
		InviteEmails  []string `json:"inviteEmails"`
		Role          string   `json:"role"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	added := []string{}
	for _, userID := range uniqueStringsLocal(body.UserIDs) {
		if !h.userInWorkspace(r, team.WorkspaceID, userID) {
			problem.Write(w, 400, "Some users are not workspace members", "")
			return
		}
		if _, err := h.DB.Exec(r.Context(), `insert into team_member (team_id,user_id) values ($1::uuid,$2) on conflict do nothing`, team.ID, userID); err != nil {
			problem.Write(w, 500, "Update team members failed", err.Error())
			return
		}
		added = append(added, userID)
	}
	invited := []string{}
	role := body.Role
	if role != "admin" && role != "guest" {
		role = "member"
	}
	for _, email := range uniqueStringsLocal(body.InviteEmails) {
		email = strings.ToLower(strings.TrimSpace(email))
		if !strings.Contains(email, "@") {
			problem.Write(w, 400, "Enter a valid email address", "")
			return
		}
		token := "headless-" + strings.ReplaceAll(email, "@", "-") + "-" + team.Key
		_, err := h.DB.Exec(r.Context(), `insert into workspace_invitation (workspace_id,email,role,invited_by_user_id,token,status,accepted_at,updated_at) values ($1::uuid,$2,$3,$4,$5,'pending',null,now()) on conflict (workspace_id,email) do update set role=excluded.role, invited_by_user_id=excluded.invited_by_user_id, token=excluded.token, status='pending', accepted_at=null, updated_at=now()`, team.WorkspaceID, email, role, p.UserID, token)
		if err != nil {
			problem.Write(w, 500, "Invite team member failed", err.Error())
			return
		}
		invited = append(invited, email)
	}
	members, _ := h.teamMemberList(r, team)
	problem.JSON(w, 200, map[string]any{"success": true, "addedUserIds": added, "updatedInvitationIds": []string{}, "invitedEmails": invited, "members": members})
}

func (h Handler) PatchTeamMemberInvitation(w http.ResponseWriter, r *http.Request) {
	team, ok := h.requireTeamAccess(w, r, true)
	if !ok {
		return
	}
	var body struct {
		InvitationID string `json:"invitationId"`
		Action       string `json:"action"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.InvitationID == "" || body.Action != "resend" {
		problem.Write(w, 400, "Invalid invitation action", "")
		return
	}
	ct, err := h.DB.Exec(r.Context(), `update workspace_invitation set updated_at=now() where id=$1::uuid and workspace_id=$2::uuid and status='pending'`, body.InvitationID, team.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Resend invitation failed", err.Error())
		return
	}
	if ct.RowsAffected() == 0 {
		problem.Write(w, 404, "Pending invitation not found", "")
		return
	}
	members, _ := h.teamMemberList(r, team)
	problem.JSON(w, 200, map[string]any{"success": true, "members": members})
}

func (h Handler) DeleteTeamMember(w http.ResponseWriter, r *http.Request) {
	team, ok := h.requireTeamAccess(w, r, true)
	if !ok {
		return
	}
	var body struct {
		UserID       string `json:"userId"`
		InvitationID string `json:"invitationId"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.InvitationID != "" {
		ct, err := h.DB.Exec(r.Context(), `update workspace_invitation set status='revoked', updated_at=now() where id=$1::uuid and workspace_id=$2::uuid and status='pending'`, body.InvitationID, team.WorkspaceID)
		if err != nil {
			problem.Write(w, 500, "Remove invitation failed", err.Error())
			return
		}
		if ct.RowsAffected() == 0 {
			problem.Write(w, 404, "Pending invitation not found", "")
			return
		}
		members, _ := h.teamMemberList(r, team)
		problem.JSON(w, 200, map[string]any{"success": true, "removedInvitationId": body.InvitationID, "members": members})
		return
	}
	if body.UserID == "" {
		problem.Write(w, 400, "User ID or invitation ID is required", "")
		return
	}
	var count int
	_ = h.DB.QueryRow(r.Context(), `select count(*)::int from team_member where team_id=$1::uuid`, team.ID).Scan(&count)
	if count <= 1 {
		problem.Write(w, 400, "Teams must keep at least one member", "")
		return
	}
	ct, err := h.DB.Exec(r.Context(), `delete from team_member where team_id=$1::uuid and user_id=$2`, team.ID, body.UserID)
	if err != nil {
		problem.Write(w, 500, "Remove team member failed", err.Error())
		return
	}
	if ct.RowsAffected() == 0 {
		problem.Write(w, 404, "User is not a member of this team", "")
		return
	}
	members, _ := h.teamMemberList(r, team)
	problem.JSON(w, 200, map[string]any{"success": true, "removedUserId": body.UserID, "members": members})
}

func (h Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.requireTeamAccess(w, r, false)
	if !ok {
		return
	}
	problem.JSON(w, 200, map[string]any{"team": h.teamSettingsResponse(r, team, p.UserID)})
}

func (h Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	team, ok := h.requireTeamAccess(w, r, true)
	if !ok {
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		problem.Write(w, 400, "Invalid JSON body", err.Error())
		return
	}
	name := stringFromAny(body["name"], team.Name)
	key := strings.ToUpper(stringFromAny(body["key"], team.Key))
	icon := stringFromAny(body["icon"], stringPtrVal(team.Icon, "•"))
	timezone := team.Timezone
	if raw, ok := body["timezone"]; ok {
		next := strings.TrimSpace(stringFromAny(raw, ""))
		timezone = nullIfEmpty(next)
	}
	estimateType := stringPtrVal(team.EstimateType, "not_in_use")
	if raw, ok := body["estimateType"]; ok {
		estimateType = strings.TrimSpace(stringFromAny(raw, estimateType))
		if estimateType == "none" {
			estimateType = "not_in_use"
		}
	}
	if !validEstimateType(estimateType) {
		problem.Write(w, 400, "Estimate type is invalid", "")
		return
	}
	triageEnabled := boolFromAny(body["triageEnabled"], boolPtrVal(team.TriageEnabled, true))
	cyclesEnabled := boolFromAny(body["cyclesEnabled"], boolPtrVal(team.CyclesEnabled, false))
	var cycleStartDay *int
	var cycleDurationWeeks *int
	if cyclesEnabled {
		startDay := intFromAny(body["cycleStartDay"], intPtrVal(team.CycleStartDay, 1))
		if startDay < 1 || startDay > 7 {
			problem.Write(w, 400, "Cycle start day must be between 1 and 7", "")
			return
		}
		durationWeeks := intFromAny(body["cycleDurationWeeks"], intPtrVal(team.CycleDurationWeeks, 2))
		if durationWeeks < 1 || durationWeeks > 8 {
			problem.Write(w, 400, "Cycle duration must be between 1 and 8 weeks", "")
			return
		}
		cycleStartDay = &startDay
		cycleDurationWeeks = &durationWeeks
	}
	if strings.TrimSpace(name) == "" {
		problem.Write(w, 400, "Name is required", "")
		return
	}
	if err := validateKey(key); err != nil {
		problem.Write(w, 400, "Key must be 2-10 uppercase letters or numbers", "")
		return
	}
	settings := team.Settings
	if settings == nil {
		settings = map[string]any{}
	}
	for _, k := range []string{"emailEnabled", "detailedHistory", "agentGuidance", "autoAssignment", "autoAssignMode", "defaultAssigneeId", "gitBranchFormat", "gitPrAutomationEnabled", "gitPrMergeTargetStatusId", "gitBranchCreateTargetStatusId", "statusTransitionRules", "workflowAutomation", "discussionSummariesEnabled", "discussionSummaryMinComments", "discussionSummaryRefreshMode", "triageAcceptDestinationStateId", "triageDeclineDestinationStateId"} {
		if v, ok := body[k]; ok {
			settings[k] = v
		}
	}
	_, err := h.DB.Exec(r.Context(), `update team set name=$1,key=$2,icon=$3,timezone=$4,estimate_type=$5,triage_enabled=$6,cycles_enabled=$7,cycle_start_day=$8,cycle_duration_weeks=$9,settings=$10,updated_at=now() where id=$11::uuid and workspace_id=$12::uuid`, strings.TrimSpace(name), key, icon, timezone, estimateType, triageEnabled, cyclesEnabled, cycleStartDay, cycleDurationWeeks, settings, team.ID, team.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Update team settings failed", err.Error())
		return
	}
	updated, _ := h.findTeam(r, key, false)
	problem.JSON(w, 200, map[string]any{"team": h.teamSettingsResponse(r, updated, p.UserID)})
}

func (h Handler) TeamLifecycleAction(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var body struct {
		Action string `json:"action"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	team, ok := h.requireTeamAccess(w, r, body.Action == "restore")
	if !ok {
		return
	}
	now := time.Now().UTC()
	switch body.Action {
	case "leave":
		_, err := h.DB.Exec(r.Context(), `delete from team_member where team_id=$1::uuid and user_id=$2`, team.ID, p.UserID)
		if err != nil {
			problem.Write(w, 500, "Leave team failed", err.Error())
			return
		}
		problem.JSON(w, 200, map[string]any{"success": true, "redirectTo": "/settings", "message": "Left " + team.Name + "."})
	case "retire":
		_, err := h.DB.Exec(r.Context(), `update team set retired_at=$1, updated_at=$1 where id=$2::uuid`, now, team.ID)
		if err != nil {
			problem.Write(w, 500, "Retire team failed", err.Error())
			return
		}
		problem.JSON(w, 200, map[string]any{"success": true, "message": team.Name + " is now retired.", "team": h.teamSettingsResponse(r, team, p.UserID)})
	case "delete":
		until := now.Add(30 * 24 * time.Hour)
		_, err := h.DB.Exec(r.Context(), `update team set deleted_at=$1, delete_scheduled_at=$1, restorable_until=$2, updated_at=$1 where id=$3::uuid`, now, until, team.ID)
		if err != nil {
			problem.Write(w, 500, "Delete team failed", err.Error())
			return
		}
		problem.JSON(w, 200, map[string]any{"success": true, "redirectTo": "/settings", "message": team.Name + " was scheduled for deletion and can be restored for 30 days."})
	case "restore":
		_, err := h.DB.Exec(r.Context(), `update team set deleted_at=null, delete_scheduled_at=null, restorable_until=null, restored_at=$1, updated_at=$1 where id=$2::uuid`, now, team.ID)
		if err != nil {
			problem.Write(w, 500, "Restore team failed", err.Error())
			return
		}
		problem.JSON(w, 200, map[string]any{"success": true, "message": team.Name + " was restored.", "team": h.teamSettingsResponse(r, team, p.UserID)})
	default:
		problem.Write(w, 400, "Unsupported action", "")
	}
}

func (h Handler) requireTeamAccess(w http.ResponseWriter, r *http.Request, manage bool) (teamRecord, bool) {
	p, _ := auth.FromContext(r.Context())
	team, err := h.findTeam(r, chi.URLParam(r, "key"), false)
	if err == pgx.ErrNoRows {
		problem.Write(w, 404, "Team not found", "")
		return team, false
	}
	if err != nil {
		problem.Write(w, 500, "Load team failed", err.Error())
		return team, false
	}
	if manage && !isAdmin(p.Role) {
		problem.Write(w, 403, "You do not have permission to manage team members", "")
		return team, false
	}
	return team, true
}
func (h Handler) findTeam(r *http.Request, key string, includeDeleted bool) (teamRecord, error) {
	p, _ := auth.FromContext(r.Context())
	var t teamRecord
	var raw []byte
	q := `select id::text,workspace_id::text,name,key,icon,timezone,estimate_type,triage_enabled,cycles_enabled,cycle_start_day,cycle_duration_weeks,coalesce(settings,'{}'::jsonb) from team where workspace_id=$1::uuid and key=$2`
	if !includeDeleted {
		q += ` and deleted_at is null`
	}
	q += ` limit 1`
	err := h.DB.QueryRow(r.Context(), q, p.WorkspaceID, strings.ToUpper(key)).Scan(&t.ID, &t.WorkspaceID, &t.Name, &t.Key, &t.Icon, &t.Timezone, &t.EstimateType, &t.TriageEnabled, &t.CyclesEnabled, &t.CycleStartDay, &t.CycleDurationWeeks, &raw)
	_ = json.Unmarshal(raw, &t.Settings)
	return t, err
}
func (h Handler) teamMemberList(r *http.Request, team teamRecord) ([]teamMemberEntry, error) {
	rows, err := h.DB.Query(r.Context(), `select tm.id::text, tm.user_id, u.name, u.email, m.role::text from team_member tm join "user" u on u.id=tm.user_id join member m on m.user_id=tm.user_id and m.workspace_id=$2::uuid where tm.team_id=$1::uuid order by u.name,u.email`, team.ID, team.WorkspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []teamMemberEntry{}
	for rows.Next() {
		var e teamMemberEntry
		e.Kind = "member"
		e.Status = "active"
		e.Actions = []string{"remove"}
		if err := rows.Scan(&e.ID, &e.UserID, &e.Name, &e.Email, &e.Role); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	inv, err := h.DB.Query(r.Context(), `select id::text,email,role::text,created_at from workspace_invitation where workspace_id=$1::uuid and status='pending' order by created_at desc,email`, team.WorkspaceID)
	if err == nil {
		defer inv.Close()
		for inv.Next() {
			var e teamMemberEntry
			var created time.Time
			e.Kind = "invitation"
			e.Name = "Pending invite"
			e.Status = "pending"
			e.Actions = []string{"resend", "cancel"}
			if err := inv.Scan(&e.ID, &e.Email, &e.Role, &created); err != nil {
				return nil, err
			}
			s := created.UTC().Format(time.RFC3339Nano)
			e.InvitedAt = &s
			out = append(out, e)
		}
	}
	return out, rows.Err()
}
func (h Handler) userInWorkspace(r *http.Request, workspaceID, userID string) bool {
	var ok bool
	_ = h.DB.QueryRow(r.Context(), `select true from member where workspace_id=$1::uuid and user_id=$2`, workspaceID, userID).Scan(&ok)
	return ok
}
func (h Handler) teamSettingsResponse(r *http.Request, team teamRecord, userID string) map[string]any {
	var memberCount, labelCount, statusCount int
	_ = h.DB.QueryRow(r.Context(), `select count(*)::int from team_member where team_id=$1::uuid`, team.ID).Scan(&memberCount)
	_ = h.DB.QueryRow(r.Context(), `select count(*)::int from label where team_id=$1::uuid`, team.ID).Scan(&labelCount)
	_ = h.DB.QueryRow(r.Context(), `select count(*)::int from workflow_state where team_id=$1::uuid`, team.ID).Scan(&statusCount)
	estimateType := stringPtrVal(team.EstimateType, "not_in_use")
	if estimateType == "not_in_use" {
		estimateType = "none"
	}
	return map[string]any{"id": team.ID, "name": team.Name, "key": team.Key, "icon": stringPtrVal(team.Icon, "•"), "timezone": stringPtrVal(team.Timezone, ""), "estimateType": estimateType, "triageEnabled": boolPtrVal(team.TriageEnabled, true), "cyclesEnabled": boolPtrVal(team.CyclesEnabled, false), "cycleStartDay": intPtrVal(team.CycleStartDay, 1), "cycleDurationWeeks": intPtrVal(team.CycleDurationWeeks, 2), "memberCount": memberCount, "labelCount": labelCount, "statusCount": statusCount, "settings": team.Settings, "emailEnabled": team.Settings["emailEnabled"], "detailedHistory": team.Settings["detailedHistory"], "agentGuidance": team.Settings["agentGuidance"]}
}
func uniqueStringsLocal(in []string) []string {
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
func stringFromAny(v any, fallback string) string {
	if s, ok := v.(string); ok {
		return s
	}
	return fallback
}
func stringPtrVal(v *string, fallback string) string {
	if v == nil || *v == "" {
		return fallback
	}
	return *v
}
func boolFromAny(v any, fallback bool) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return fallback
}
func boolPtrVal(v *bool, fallback bool) bool {
	if v == nil {
		return fallback
	}
	return *v
}
func intFromAny(v any, fallback int) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float64:
		return int(n)
	case json.Number:
		i, err := strconv.Atoi(n.String())
		if err == nil {
			return i
		}
	case string:
		i, err := strconv.Atoi(strings.TrimSpace(n))
		if err == nil {
			return i
		}
	}
	return fallback
}
func intPtrVal(v *int, fallback int) int {
	if v == nil {
		return fallback
	}
	return *v
}
func validEstimateType(value string) bool {
	switch value {
	case "not_in_use", "linear", "exponential", "tshirt":
		return true
	default:
		return false
	}
}
