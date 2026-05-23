package account

import (
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

type Profile struct {
	Name          string  `json:"name"`
	Email         string  `json:"email"`
	Username      string  `json:"username"`
	Pronouns      string  `json:"pronouns"`
	Title         string  `json:"title"`
	Location      string  `json:"location"`
	Timezone      string  `json:"timezone"`
	ShowLocalTime bool    `json:"showLocalTime"`
	Image         *string `json:"image"`
}

type WorkspaceAccess struct {
	CurrentWorkspaceID   *string `json:"currentWorkspaceId"`
	CurrentWorkspaceName *string `json:"currentWorkspaceName"`
}

type profilePayload struct {
	Profile         Profile         `json:"profile"`
	WorkspaceAccess WorkspaceAccess `json:"workspaceAccess"`
}

type profilePatch struct {
	Name          any `json:"name"`
	Username      any `json:"username"`
	Image         any `json:"image"`
	Pronouns      any `json:"pronouns"`
	Title         any `json:"title"`
	Location      any `json:"location"`
	Timezone      any `json:"timezone"`
	ShowLocalTime any `json:"showLocalTime"`
}

type preferencesPayload struct {
	AccountPreferences map[string]any `json:"accountPreferences"`
}

type leaveWorkspacePayload struct {
	Success    bool   `json:"success"`
	RedirectTo string `json:"redirectTo"`
}

type preferencesPatch struct {
	AccountPreferences map[string]any `json:"accountPreferences"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/profile", h.GetProfile)
	r.Patch("/profile", h.UpdateProfile)
	r.Get("/preferences", h.GetPreferences)
	r.Patch("/preferences", h.UpdatePreferences)
	r.Get("/notifications", h.GetNotifications)
	r.Patch("/notifications", h.UpdateNotifications)
	r.Delete("/profile/workspace", h.LeaveWorkspace)
	return r
}

func (h Handler) GetProfile(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	payload, err := h.profile(r, p)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "User not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get profile failed", err.Error())
		return
	}
	problem.JSON(w, 200, payload)
}

func (h Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	payload, err := h.profile(r, p)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "User not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update profile failed", err.Error())
		return
	}
	var input profilePatch
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name, ok := input.Name.(string)
	name = strings.TrimSpace(name)
	if !ok || name == "" {
		problem.Write(w, 400, "Full name is required", "")
		return
	}
	username := normalizeUsername(input.Username)
	if strings.Contains(username, " ") {
		problem.Write(w, 400, "Username must be a single word", "")
		return
	}
	tz := normalizeTimezone(input.Timezone)
	if input.Timezone != nil && input.Timezone != "" && tz != strings.TrimSpace(asString(input.Timezone)) {
		problem.Write(w, 400, "Timezone must be a valid IANA timezone", "")
		return
	}
	image := payload.Profile.Image
	if input.Image != nil {
		if s, ok := input.Image.(string); ok {
			s = strings.TrimSpace(s)
			if s == "" {
				image = nil
			} else if len(s) > 2_000_000 && strings.HasPrefix(s, "data:image/") {
				problem.Write(w, 400, "Profile image is too large", "")
				return
			} else if !isSupportedImage(s) {
				problem.Write(w, 400, "Unsupported profile image", "")
				return
			} else {
				image = &s
			}
		} else {
			problem.Write(w, 400, "Unsupported profile image", "")
			return
		}
	}
	profile := map[string]any{"username": username, "pronouns": normalizeText(input.Pronouns, 80), "title": normalizeText(input.Title, 120), "location": normalizeText(input.Location, 120), "timezone": tz, "showLocalTime": boolValue(input.ShowLocalTime)}
	rawSettings, err := h.userSettings(r, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Update profile failed", err.Error())
		return
	}
	settings := asMap(rawSettings)
	settings["accountProfile"] = profile
	settingsBody, _ := json.Marshal(settings)
	_, err = h.DB.Exec(r.Context(), `update "user" set name=$1, image=$2, settings=$3::jsonb, updated_at=now() where id=$4`, name, image, settingsBody, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Update profile failed", err.Error())
		return
	}
	payload.Profile.Name = name
	payload.Profile.Username = username
	payload.Profile.Pronouns = profile["pronouns"].(string)
	payload.Profile.Title = profile["title"].(string)
	payload.Profile.Location = profile["location"].(string)
	payload.Profile.Timezone = tz
	payload.Profile.ShowLocalTime = profile["showLocalTime"].(bool)
	payload.Profile.Image = image
	problem.JSON(w, 200, payload)
}

func (h Handler) LeaveWorkspace(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	if p.WorkspaceID == "" {
		problem.Write(w, 404, "No active workspace found", "")
		return
	}

	if _, err := h.DB.Exec(r.Context(), `delete from member where user_id=$1 and workspace_id=$2::uuid`, p.UserID, p.WorkspaceID); err != nil {
		problem.Write(w, 500, "Leave workspace failed", err.Error())
		return
	}

	nextWorkspaceID, err := h.nextWorkspaceID(r, p.UserID)
	if err != nil {
		problem.Write(w, 500, "Leave workspace failed", err.Error())
		return
	}

	redirectTo := leaveWorkspaceRedirect(nextWorkspaceID)
	if nextWorkspaceID != nil {
		http.SetCookie(w, &http.Cookie{Name: "activeWorkspaceId", Value: *nextWorkspaceID, Path: "/", SameSite: http.SameSiteLaxMode})
	} else {
		http.SetCookie(w, &http.Cookie{Name: "activeWorkspaceId", Value: "", Path: "/", MaxAge: -1, SameSite: http.SameSiteLaxMode})
	}
	problem.JSON(w, 200, leaveWorkspacePayload{Success: true, RedirectTo: redirectTo})
}

func (h Handler) GetNotifications(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.userSettings(r, p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "User not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get notification settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"accountNotifications": readAccountNotifications(settings)})
}

func (h Handler) UpdateNotifications(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.userSettings(r, p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "User not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update notification settings failed", err.Error())
		return
	}
	var input map[string]any
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	patch, ok := input["accountNotifications"].(map[string]any)
	if !ok || patch == nil {
		problem.Write(w, 400, "accountNotifications is required", "")
		return
	}
	nextNotifications := mergeRecords(readAccountNotifications(settings), patch)
	nextNotifications = normalizeAccountNotifications(nextNotifications)
	nextSettings := asMap(settings)
	nextSettings["accountNotifications"] = nextNotifications
	body, _ := json.Marshal(nextSettings)
	if _, err := h.DB.Exec(r.Context(), `update "user" set settings=$1::jsonb, updated_at=now() where id=$2`, body, p.UserID); err != nil {
		problem.Write(w, 500, "Update notification settings failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"accountNotifications": nextNotifications})
}

func (h Handler) GetPreferences(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.userSettings(r, p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "User not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Get preferences failed", err.Error())
		return
	}
	problem.JSON(w, 200, preferencesPayload{AccountPreferences: readPreferences(settings)})
}

func (h Handler) UpdatePreferences(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, err := h.userSettings(r, p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem.Write(w, 404, "User not found", "")
		return
	}
	if err != nil {
		problem.Write(w, 500, "Update preferences failed", err.Error())
		return
	}
	var input preferencesPatch
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	if input.AccountPreferences == nil {
		problem.Write(w, 400, "accountPreferences is required", "")
		return
	}
	prefs := mergePreferences(readPreferences(settings), input.AccountPreferences)
	next := asMap(settings)
	next["accountPreferences"] = prefs
	body, _ := json.Marshal(next)
	if _, err := h.DB.Exec(r.Context(), `update "user" set settings=$1::jsonb, updated_at=now() where id=$2`, body, p.UserID); err != nil {
		problem.Write(w, 500, "Update preferences failed", err.Error())
		return
	}
	problem.JSON(w, 200, preferencesPayload{AccountPreferences: prefs})
}

func (h Handler) profile(r *http.Request, p auth.Principal) (profilePayload, error) {
	var name, email string
	var image *string
	var settings []byte
	if err := h.DB.QueryRow(r.Context(), `select name,email,image,coalesce(settings,'{}'::jsonb) from "user" where id=$1`, p.UserID).Scan(&name, &email, &image, &settings); err != nil {
		return profilePayload{}, err
	}
	profile := readProfile(settings)
	profile.Name = name
	profile.Email = email
	profile.Image = image
	var wsID, wsName *string
	_ = h.DB.QueryRow(r.Context(), `select id::text,name from workspace where id=$1::uuid`, p.WorkspaceID).Scan(&wsID, &wsName)
	return profilePayload{Profile: profile, WorkspaceAccess: WorkspaceAccess{CurrentWorkspaceID: wsID, CurrentWorkspaceName: wsName}}, nil
}

func (h Handler) userSettings(r *http.Request, userID string) ([]byte, error) {
	var settings []byte
	err := h.DB.QueryRow(r.Context(), `select coalesce(settings,'{}'::jsonb) from "user" where id=$1`, userID).Scan(&settings)
	return settings, err
}
func readProfile(settings []byte) Profile {
	p := asMap(settings)
	ap := asRecord(p["accountProfile"])
	return Profile{Username: normalizeUsername(ap["username"]), Pronouns: normalizeText(ap["pronouns"], 80), Title: normalizeText(ap["title"], 120), Location: normalizeText(ap["location"], 120), Timezone: normalizeTimezone(ap["timezone"]), ShowLocalTime: boolValue(ap["showLocalTime"])}
}
func readPreferences(settings []byte) map[string]any {
	p := asMap(settings)
	prefs := asRecord(p["accountPreferences"])
	defaults := defaultPreferences()
	return mergePreferences(defaults, prefs)
}
func mergePreferences(current, patch map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range current {
		out[k] = v
	}
	for k, v := range patch {
		if sub, ok := v.(map[string]any); ok {
			base := asRecord(out[k])
			merged := map[string]any{}
			for bk, bv := range base {
				merged[bk] = bv
			}
			for sk, sv := range sub {
				merged[sk] = sv
			}
			out[k] = merged
		} else {
			out[k] = v
		}
	}
	return normalizePreferences(out)
}
func defaultPreferences() map[string]any {
	return map[string]any{"defaultHomeView": "my-issues", "displayNames": "full", "firstDayOfWeek": "sunday", "convertEmoticons": true, "sendCommentShortcut": "cmd-enter", "theme": "system", "fontSize": "default", "pointerCursors": false, "openInDesktopApp": false, "sidebarBadgeStyle": "count", "sidebarVisibility": map[string]any{"inbox": true, "myIssues": true, "projects": true, "views": true, "initiatives": true, "cycles": true}, "inboxDisplay": map[string]any{"showReadItems": true, "showUnreadItemsFirst": false, "showSnoozedItems": false}, "agentPersonalization": map[string]any{"instructions": "", "autoFix": false}, "automations": map[string]any{"autoAssignment": "off", "gitBranchFormat": "team-id-title", "statusTransitions": "manual"}}
}
func normalizePreferences(v map[string]any) map[string]any {
	d := defaultPreferences()
	for k, val := range v {
		d[k] = val
	}
	return d
}
func asMap(raw []byte) map[string]any { m := map[string]any{}; _ = json.Unmarshal(raw, &m); return m }
func asRecord(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}
func normalizeUsername(v any) string { return strings.ToLower(strings.TrimSpace(asString(v))) }
func normalizeText(v any, max int) string {
	s := strings.TrimSpace(asString(v))
	if len(s) > max {
		return s[:max]
	}
	return s
}
func normalizeTimezone(v any) string {
	s := normalizeText(v, 80)
	if s == "" {
		return ""
	}
	if _, err := time.LoadLocation(s); err == nil {
		return s
	}
	return ""
}
func asString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
func boolValue(v any) bool { b, ok := v.(bool); return ok && b }
func isSupportedImage(v string) bool {
	l := strings.ToLower(v)
	return strings.HasPrefix(l, "http://") || strings.HasPrefix(l, "https://") || strings.HasPrefix(l, "data:image/png;base64,") || strings.HasPrefix(l, "data:image/jpeg;base64,") || strings.HasPrefix(l, "data:image/jpg;base64,") || strings.HasPrefix(l, "data:image/webp;base64,") || strings.HasPrefix(l, "data:image/gif;base64,") || strings.HasPrefix(l, "data:image/svg+xml;base64,")
}

func (h Handler) nextWorkspaceID(r *http.Request, userID string) (*string, error) {
	var workspaceID *string
	err := h.DB.QueryRow(r.Context(), `select workspace_id::text from member where user_id=$1 order by created_at desc limit 1`, userID).Scan(&workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return workspaceID, err
}

func leaveWorkspaceRedirect(nextWorkspaceID *string) string {
	if nextWorkspaceID == nil || *nextWorkspaceID == "" {
		return "/create-workspace"
	}
	return "/"
}

func readAccountNotifications(settings []byte) map[string]any {
	root := asMap(settings)
	return normalizeAccountNotifications(asRecord(root["accountNotifications"]))
}

func normalizeAccountNotifications(value map[string]any) map[string]any {
	defaults := defaultAccountNotifications()
	merged := mergeRecords(defaults, value)
	if updates, ok := merged["updatesFromLinear"].(map[string]any); ok {
		if _, exists := updates["changelogNewsletter"]; !exists {
			if newsletter, ok := updates["newsletter"].(bool); ok {
				updates["changelogNewsletter"] = newsletter
			}
		}
	}
	merged["channels"] = normalizeNotificationChannels(asRecord(merged["channels"]))
	return merged
}

func normalizeNotificationChannels(value map[string]any) map[string]any {
	defaults := defaultNotificationChannels()
	return mergeRecords(defaults, value)
}

func defaultAccountNotifications() map[string]any {
	return map[string]any{
		"channels":          defaultNotificationChannels(),
		"inbox":             map[string]any{"assignedToMe": true, "mentionsAndReplies": true, "subscribedIssues": true, "teamUpdates": true},
		"email":             map[string]any{"issueActivity": true, "mentionsAndReplies": true, "dailyDigest": false, "weeklyDigest": true, "productUpdates": false, "workspaceInvites": true},
		"desktop":           map[string]any{"enabled": true, "permission": "default", "issueActivity": true, "mentionsAndReplies": true, "reminders": true, "sound": false},
		"slack":             map[string]any{"enabled": false, "destination": "not_connected", "mentionsAndReplies": true, "assignedToMe": false, "triageActivity": false, "projectUpdates": false},
		"updatesFromLinear": map[string]any{"showInSidebar": true, "changelogNewsletter": false, "marketing": false},
		"other":             map[string]any{"inviteAccepted": true, "privacyAndLegalUpdates": true, "dpa": false},
	}
}

func defaultNotificationChannels() map[string]any {
	events := []string{"assignments", "statusChanges", "mentions", "comments", "dueDates", "relations", "triage", "projectUpdates", "teamUpdates", "productUpdates", "workspaceAdmin"}
	out := map[string]any{}
	for _, channel := range []string{"desktop", "mobile", "email", "slack"} {
		channelEvents := map[string]any{}
		for _, event := range events {
			channelEvents[event] = true
		}
		if channel == "slack" {
			channelEvents["assignments"] = false
		}
		out[channel] = map[string]any{"events": channelEvents}
	}
	return out
}

func mergeRecords(current map[string]any, patch map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range current {
		out[k] = v
	}
	for k, v := range patch {
		if sub, ok := v.(map[string]any); ok {
			out[k] = mergeRecords(asRecord(out[k]), sub)
		} else {
			out[k] = v
		}
	}
	return out
}
