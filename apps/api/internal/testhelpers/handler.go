package testhelpers

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/authorized-application", h.CreateAuthorizedApplication)
	r.Delete("/authorized-application", h.ClearAuthorizedApplications)
	r.Post("/slack-integration", h.CreateSlackIntegration)
	r.Delete("/slack-integration", h.DeleteSlackIntegration)
	return r
}

func allowed() bool {
	if strings.EqualFold(os.Getenv("EXPONENTIAL_API_ENVIRONMENT"), "production") {
		return false
	}
	return os.Getenv("NODE_ENV") == "test" || os.Getenv("PLAYWRIGHT_TEST") == "true"
}

func (h Handler) CreateAuthorizedApplication(w http.ResponseWriter, r *http.Request) {
	if !allowed() {
		problem.JSON(w, 404, map[string]string{"error": "Not found"})
		return
	}
	p, _ := auth.FromContext(r.Context())
	var body struct {
		Action string   `json:"action"`
		Name   string   `json:"name"`
		Scopes []string `json:"scopes"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Action == "clear" {
		_, _ = h.DB.Exec(r.Context(), `delete from authorized_application_grant where user_id=$1`, p.UserID)
		problem.JSON(w, 200, map[string]bool{"success": true})
		return
	}
	id := helperID("grant")
	appID := helperID("app")
	clientID := "lin_" + randomHex(12)
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "E2E OAuth App"
	}
	scopes := body.Scopes
	if len(scopes) == 0 {
		scopes = []string{"read", "write"}
	}
	raw, _ := json.Marshal(scopes)
	_, err := h.DB.Exec(r.Context(), `insert into authorized_application_grant (id,workspace_id,user_id,app_id,client_id,name,image_url,scopes,webhooks_enabled) values ($1,$2::uuid,$3,$4,$5,$6,null,$7::jsonb,true)`, id, p.WorkspaceID, p.UserID, appID, clientID, name, raw)
	if err != nil {
		problem.Write(w, 500, "Create authorized application failed", err.Error())
		return
	}
	problem.JSON(w, 201, map[string]any{"id": id, "appId": appID, "clientId": clientID, "name": name, "scopes": scopes, "webhooksEnabled": true})
}

func (h Handler) ClearAuthorizedApplications(w http.ResponseWriter, r *http.Request) {
	if !allowed() {
		problem.JSON(w, 404, map[string]string{"error": "Not found"})
		return
	}
	p, _ := auth.FromContext(r.Context())
	_, _ = h.DB.Exec(r.Context(), `delete from authorized_application_grant where user_id=$1`, p.UserID)
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) CreateSlackIntegration(w http.ResponseWriter, r *http.Request) {
	if !allowed() {
		problem.JSON(w, 404, map[string]string{"error": "Not found"})
		return
	}
	p, _ := auth.FromContext(r.Context())
	now := time.Now().UTC()
	var id string
	err := h.DB.QueryRow(r.Context(), `insert into workspace_integration (workspace_id,provider,status,display_name,external_id,metadata,connected_by_user_id,connected_at,updated_at) values ($1::uuid,'slack','connected','E2E Slack Workspace',$2,$3::jsonb,$4,$5,$5) on conflict (workspace_id,provider) do update set status='connected', display_name='E2E Slack Workspace', connected_by_user_id=excluded.connected_by_user_id, connected_at=excluded.connected_at, updated_at=excluded.updated_at returning id::text`, p.WorkspaceID, "T_"+p.WorkspaceID, []byte(`{"createdBy":"playwright"}`), p.UserID, now).Scan(&id)
	if err != nil {
		problem.Write(w, 500, "Create Slack integration failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"success": true, "id": id})
}

func (h Handler) DeleteSlackIntegration(w http.ResponseWriter, r *http.Request) {
	if !allowed() {
		problem.JSON(w, 404, map[string]string{"error": "Not found"})
		return
	}
	p, _ := auth.FromContext(r.Context())
	_, _ = h.DB.Exec(r.Context(), `delete from workspace_integration where workspace_id=$1::uuid and provider='slack'`, p.WorkspaceID)
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func helperID(prefix string) string { return prefix + "_" + randomHex(8) }
func randomHex(size int) string {
	b := make([]byte, size)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type createSessionRequest struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

func (h Handler) CreateSession(w http.ResponseWriter, r *http.Request) {
	if !allowed() {
		problem.JSON(w, 404, map[string]string{"error": "Not found"})
		return
	}
	var input createSessionRequest
	_ = json.NewDecoder(r.Body).Decode(&input)
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if email == "" {
		problem.JSON(w, 400, map[string]string{"error": "Email is required"})
		return
	}
	user, err := h.ensureUser(r, email, input.Name)
	if err != nil {
		problem.Write(w, 500, "Create test session failed", err.Error())
		return
	}
	workspace, team, err := h.ensureCanonicalWorkspace(r, user.ID)
	if err != nil {
		problem.Write(w, 500, "Create test session failed", err.Error())
		return
	}
	rawToken := randomBase64URL(24)
	expires := time.Now().UTC().Add(7 * 24 * time.Hour)
	tokenHash := func() string {
		sum := sha256.Sum256([]byte(rawToken))
		return hex.EncodeToString(sum[:])
	}()
	_, err = h.DB.Exec(r.Context(), `insert into session (id,expires_at,token_hash,created_at,updated_at,ip_address,user_agent,user_id) values ($1,$2,$3,now(),now(),$4,$5,$6)`, randomBase64URL(16), expires, tokenHash, clientIP(r), userAgent(r), user.ID)
	if err != nil {
		problem.Write(w, 500, "Create test session failed", err.Error())
		return
	}
	signed := auth.SignSessionToken(rawToken)
	if shouldSetBrowserSessionCookies(r) {
		setBrowserSessionCookies(w, r, workspace, signed, expires)
	}
	problem.JSON(w, 200, map[string]any{"success": true, "user": user, "sessionToken": signed, "expiresAt": expires.Format(time.RFC3339Nano), "workspace": workspace, "team": team})
}

type testUser struct {
	ID            string  `json:"id"`
	Email         string  `json:"email"`
	Name          string  `json:"name"`
	Image         *string `json:"image"`
	EmailVerified bool    `json:"emailVerified"`
}

type publicWorkspace struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URLSlug string `json:"urlSlug"`
}
type publicTeam struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Key  string `json:"key"`
}

type canonicalIssueSeed struct {
	Number     int
	Identifier string
	Title      string
	Priority   string
	Type       string
	CreatedAt  time.Time
}

var canonicalIssueSeeds = []canonicalIssueSeed{
	{Number: 1, Identifier: "ENG-1", Title: "Welcome to Forever Browsing", Priority: "medium", CreatedAt: time.Date(2026, 5, 1, 16, 0, 0, 0, time.UTC)},
	{Number: 179, Identifier: "ENG-179", Title: "Issue added to FOREVER-AGENT", Priority: "medium", Type: "status_change", CreatedAt: time.Date(2026, 5, 6, 17, 30, 0, 0, time.UTC)},
	{Number: 138, Identifier: "ENG-138", Title: "Figure out latest strategy for browser session memory", Priority: "high", Type: "assigned", CreatedAt: time.Date(2026, 5, 2, 20, 15, 0, 0, time.UTC)},
	{Number: 137, Identifier: "ENG-137", Title: "Audit autonomous navigation edge cases", Priority: "high", Type: "assigned", CreatedAt: time.Date(2026, 5, 2, 19, 45, 0, 0, time.UTC)},
	{Number: 136, Identifier: "ENG-136", Title: "Improve Forever Browsing agent inbox handoff", Priority: "medium", Type: "assigned", CreatedAt: time.Date(2026, 5, 2, 19, 0, 0, 0, time.UTC)},
}

func setBrowserSessionCookies(w http.ResponseWriter, r *http.Request, workspace publicWorkspace, signedToken string, expires time.Time) {
	secure := r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
	for _, cookie := range []*http.Cookie{
		{Name: "activeWorkspaceId", Value: workspace.ID, Path: "/", SameSite: http.SameSiteLaxMode, Secure: secure},
		{Name: "activeWorkspaceSlug", Value: workspace.URLSlug, Path: "/", SameSite: http.SameSiteLaxMode, Secure: secure},
		{Name: auth.BrowserSessionCookieName, Value: signedToken, Path: "/", Expires: expires, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure},
	} {
		http.SetCookie(w, cookie)
	}
}

func shouldSetBrowserSessionCookies(r *http.Request) bool {
	return r.Header.Get("X-Set-Test-Session-Cookies") == "true" || strings.TrimSpace(r.Referer()) != ""
}

func (h Handler) ensureUser(r *http.Request, email, name string) (testUser, error) {
	var u testUser
	err := h.DB.QueryRow(r.Context(), `select id,email,name,image,email_verified from "user" where email=$1 limit 1`, email).Scan(&u.ID, &u.Email, &u.Name, &u.Image, &u.EmailVerified)
	if err == nil {
		return u, nil
	}
	id := randomBase64URL(24)
	if strings.TrimSpace(name) == "" {
		parts := strings.Split(email, "@")
		name = strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(parts[0], ".", " "), "_", " "), "-", " ")
	}
	err = h.DB.QueryRow(r.Context(), `insert into "user" (id,email,name,email_verified) values ($1,$2,$3,true) returning id,email,name,image,email_verified`, id, email, name).Scan(&u.ID, &u.Email, &u.Name, &u.Image, &u.EmailVerified)
	return u, err
}

func (h Handler) ensureCanonicalWorkspace(r *http.Request, userID string) (publicWorkspace, publicTeam, error) {
	var ws publicWorkspace
	err := h.DB.QueryRow(r.Context(), `insert into workspace (name,url_slug,settings) values ('Forever Browsing','foreverbrowsing','{"region":"United States","fiscalMonth":"january"}'::jsonb) on conflict (url_slug) do update set name=excluded.name returning id::text,name,url_slug`).Scan(&ws.ID, &ws.Name, &ws.URLSlug)
	if err != nil {
		return ws, publicTeam{}, err
	}
	_, err = h.DB.Exec(r.Context(), `insert into member (user_id,workspace_id,role) values ($1,$2::uuid,'owner') on conflict (user_id,workspace_id) do nothing`, userID, ws.ID)
	if err != nil {
		return ws, publicTeam{}, err
	}
	var team publicTeam
	err = h.DB.QueryRow(r.Context(), `insert into team (name,key,workspace_id,cycles_enabled,cycle_start_day,cycle_duration_weeks) values ('Engineering','ENG',$1::uuid,true,1,2) on conflict (workspace_id,key) do update set name=excluded.name returning id::text,name,key`, ws.ID).Scan(&team.ID, &team.Name, &team.Key)
	if err != nil {
		return ws, team, err
	}
	_, err = h.DB.Exec(r.Context(), `insert into team_member (team_id,user_id) values ($1::uuid,$2) on conflict (team_id,user_id) do nothing`, team.ID, userID)
	if err != nil {
		return ws, team, err
	}
	_, err = h.DB.Exec(r.Context(), `insert into workflow_state (name,team_id,category,color,position,is_default) select name,$1::uuid,category::workflow_state_category,color,position,true from (values ('Triage','triage','#f59e0b',0),('Backlog','backlog','#6b6f76',1),('Todo','unstarted','#6b6f76',2),('In Progress','started','#f59e0b',3),('Done','completed','#22c55e',4),('Canceled','canceled','#6b6f76',5)) as v(name,category,color,position) where not exists (select 1 from workflow_state where team_id=$1::uuid)`, team.ID)
	if err != nil {
		return ws, team, err
	}
	err = h.ensureCanonicalSeeds(r, userID, team.ID)
	return ws, team, err
}

func (h Handler) ensureCanonicalSeeds(r *http.Request, userID, teamID string) error {
	var stateID string
	err := h.DB.QueryRow(r.Context(), `select id::text from workflow_state where team_id=$1::uuid and category='triage' order by position asc limit 1`, teamID).Scan(&stateID)
	if err != nil {
		err = h.DB.QueryRow(r.Context(), `select id::text from workflow_state where team_id=$1::uuid order by position asc limit 1`, teamID).Scan(&stateID)
	}
	if err != nil {
		return err
	}
	var actorID string
	err = h.DB.QueryRow(r.Context(), `insert into "user" (id,email,name,email_verified) values ('canonical-notification-actor','notifications@foreverbrowsing.test','Ashley Ha',true) on conflict (email) do update set name=excluded.name returning id`).Scan(&actorID)
	if err != nil {
		return err
	}
	for _, seed := range canonicalIssueSeeds {
		issueID, err := h.ensureCanonicalIssue(r, seed, teamID, stateID, userID, actorID)
		if err != nil {
			return err
		}
		if seed.Type != "" {
			_, err = h.DB.Exec(r.Context(), `insert into notification (user_id,issue_id,actor_id,type,read_at,created_at) select $1,$2::uuid,$3,$4::notification_type,$5,$6 where not exists (select 1 from notification where user_id=$1 and issue_id=$2::uuid and type=$4::notification_type)`, userID, issueID, actorID, seed.Type, seed.CreatedAt.Add(time.Hour), seed.CreatedAt)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func (h Handler) ensureCanonicalIssue(r *http.Request, seed canonicalIssueSeed, teamID, stateID, userID, actorID string) (string, error) {
	var issueID string
	err := h.DB.QueryRow(r.Context(), `select id::text from issue where team_id=$1::uuid and number=$2 limit 1`, teamID, seed.Number).Scan(&issueID)
	if err == nil {
		_, err = h.DB.Exec(r.Context(), `update issue set identifier=$3,title=$4,description=coalesce(description,'Canonical Forever Browsing seed issue.'),state_id=$5::uuid,assignee_id=$6,creator_id=coalesce(creator_id,$7),priority=$8,created_at=$9,updated_at=greatest(updated_at,$9) where team_id=$1::uuid and number=$2`, teamID, seed.Number, seed.Identifier, seed.Title, stateID, userID, actorID, seed.Priority, seed.CreatedAt)
		return issueID, err
	}
	err = h.DB.QueryRow(r.Context(), `insert into issue (number,identifier,title,description,team_id,state_id,assignee_id,creator_id,priority,created_at,updated_at) values ($1,$2,$3,'Canonical Forever Browsing seed issue.',$4::uuid,$5::uuid,$6,$7,$8,$9,$9) returning id::text`, seed.Number, seed.Identifier, seed.Title, teamID, stateID, userID, actorID, seed.Priority, seed.CreatedAt).Scan(&issueID)
	return issueID, err
}

func randomBase64URL(size int) string {
	b := make([]byte, size)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
func clientIP(r *http.Request) string {
	if v := strings.TrimSpace(strings.Split(r.Header.Get("x-forwarded-for"), ",")[0]); v != "" {
		return v
	}
	if v := strings.TrimSpace(r.Header.Get("x-real-ip")); v != "" {
		return v
	}
	return ""
}
func userAgent(r *http.Request) string {
	if v := strings.TrimSpace(r.Header.Get("user-agent")); v != "" {
		return v
	}
	return "Playwright test browser session"
}
