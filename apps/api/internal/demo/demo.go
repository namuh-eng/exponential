package demo

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

const (
	WorkspaceSlug = "foreverbrowsing"
	WorkspaceName = "Forever Browsing"
	guestDomain   = "demo.exponential.local"
)

type Handler struct{ DB *pgxpool.Pool }

type workspace struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	URLSlug string `json:"urlSlug"`
}

type team struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Key  string `json:"key"`
}

type demoInitiativeSeed struct {
	ID, Name, Status, Health string
}

var demoInitiatives = []demoInitiativeSeed{
	{"77777777-0000-4000-8000-000000000001", "Make hosted evaluation effortless", "active", "onTrack"},
	{"77777777-0000-4000-8000-000000000002", "Operator-grade self hosting", "planned", "atRisk"},
}

type sessionResponse struct {
	Success     bool      `json:"success"`
	SessionURL  string    `json:"sessionUrl"`
	ExpiresAt   time.Time `json:"expiresAt"`
	Workspace   workspace `json:"workspace"`
	DefaultTeam team      `json:"defaultTeam"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/session", h.Session)
	return r
}

func (h Handler) Session(w http.ResponseWriter, r *http.Request) {
	if !Enabled() {
		problem.JSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
		return
	}
	ws, defaultTeam, err := EnsureSeeded(r.Context(), h.DB)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create demo session failed", err.Error())
		return
	}
	guest, err := h.ensureGuest(r.Context(), ws.ID, defaultTeam.ID)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create demo session failed", err.Error())
		return
	}
	if err := h.ensureGuestNotifications(r.Context(), guest.ID, ws.ID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create demo session failed", err.Error())
		return
	}
	rawToken := randomBase64URL(24)
	expires := time.Now().UTC().Add(24 * time.Hour)
	sum := sha256.Sum256([]byte(rawToken))
	if _, err := h.DB.Exec(r.Context(), `insert into session (id,expires_at,token_hash,created_at,updated_at,ip_address,user_agent,user_id) values ($1,$2,$3,now(),now(),$4,$5,$6)`, randomBase64URL(16), expires, hex.EncodeToString(sum[:]), clientIP(r), userAgent(r), guest.ID); err != nil {
		problem.Write(w, http.StatusInternalServerError, "Create demo session failed", err.Error())
		return
	}
	sessionURL := "/" + ws.URLSlug + "/team/" + defaultTeam.Key + "/all"
	setBrowserSessionCookies(w, r, ws, auth.SignSessionToken(rawToken), expires)
	if wantsHTML(r) {
		http.Redirect(w, r, sessionURL, http.StatusFound)
		return
	}
	problem.JSON(w, http.StatusOK, sessionResponse{Success: true, SessionURL: sessionURL, ExpiresAt: expires, Workspace: ws, DefaultTeam: defaultTeam})
}

type guestUser struct {
	ID    string
	Email string
	Name  string
}

func (h Handler) ensureGuest(ctx context.Context, workspaceID string, teamID string) (guestUser, error) {
	suffix := randomHex(8)
	guest := guestUser{
		ID:    "demo-guest-" + suffix,
		Email: "guest-" + suffix + "@" + guestDomain,
		Name:  "Demo Guest",
	}
	if _, err := h.DB.Exec(ctx, `insert into "user" (id,email,name,email_verified,settings) values ($1,$2,$3,true,'{"demoGuest":true}'::jsonb)`, guest.ID, guest.Email, guest.Name); err != nil {
		return guestUser{}, err
	}
	if _, err := h.DB.Exec(ctx, `insert into member (user_id,workspace_id,role) values ($1,$2::uuid,'guest') on conflict (user_id,workspace_id) do update set role='guest'`, guest.ID, workspaceID); err != nil {
		return guestUser{}, err
	}
	_, err := h.DB.Exec(ctx, `insert into team_member (team_id,user_id) values ($1::uuid,$2) on conflict (team_id,user_id) do nothing`, teamID, guest.ID)
	return guest, err
}

func (h Handler) ensureGuestNotifications(ctx context.Context, userID, workspaceID string) error {
	rows, err := h.DB.Query(ctx, `
		select i.id::text, coalesce(i.creator_id, 'demo-product-lead')
		from issue i
		join team t on t.id = i.team_id
		where t.workspace_id = $1::uuid
		order by i.created_at desc
		limit 4`, workspaceID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var issueID, actorID string
		if err := rows.Scan(&issueID, &actorID); err != nil {
			return err
		}
		if _, err := h.DB.Exec(ctx, `insert into notification (user_id,issue_id,actor_id,type,created_at) values ($1,$2::uuid,$3,'assigned',now()) on conflict do nothing`, userID, issueID, actorID); err != nil {
			return err
		}
	}
	return rows.Err()
}

func Enabled() bool {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("EXPONENTIAL_API_ENVIRONMENT")))
	node := strings.ToLower(strings.TrimSpace(os.Getenv("NODE_ENV")))
	flag := strings.ToLower(strings.TrimSpace(os.Getenv("EXPONENTIAL_PUBLIC_DEMO_ENABLED")))
	if flag == "true" || flag == "1" || flag == "yes" {
		return true
	}
	return env != "production" && node != "production"
}

func setBrowserSessionCookies(w http.ResponseWriter, r *http.Request, ws workspace, signedToken string, expires time.Time) {
	secure := r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
	for _, cookie := range []*http.Cookie{
		{Name: "activeWorkspaceId", Value: ws.ID, Path: "/", SameSite: http.SameSiteLaxMode, Secure: secure},
		{Name: "activeWorkspaceSlug", Value: ws.URLSlug, Path: "/", SameSite: http.SameSiteLaxMode, Secure: secure},
		{Name: auth.BrowserSessionCookieName, Value: signedToken, Path: "/", Expires: expires, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure},
	} {
		http.SetCookie(w, cookie)
	}
}

func wantsHTML(r *http.Request) bool {
	return strings.Contains(strings.ToLower(r.Header.Get("accept")), "text/html")
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
	return "Public demo browser session"
}

func randomBase64URL(size int) string {
	b := make([]byte, size)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func randomHex(size int) string {
	b := make([]byte, size)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func IsWorkspaceID(ctx context.Context, db *pgxpool.Pool, workspaceID string) bool {
	if db == nil || strings.TrimSpace(workspaceID) == "" {
		return false
	}
	var raw []byte
	err := db.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid`, workspaceID).Scan(&raw)
	if err != nil {
		return false
	}
	return settingsMarkDemo(raw)
}

func settingsMarkDemo(raw []byte) bool {
	settings := map[string]any{}
	_ = json.Unmarshal(raw, &settings)
	demo, _ := settings["demo"].(map[string]any)
	if enabled, ok := demo["enabled"].(bool); ok {
		return enabled
	}
	return false
}

type SideEffectGuard struct{ DB *pgxpool.Pool }

func (g SideEffectGuard) Block(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := auth.FromContext(r.Context())
		if !ok || !sideEffectPath(r) || !IsWorkspaceID(r.Context(), g.DB, p.WorkspaceID) {
			next.ServeHTTP(w, r)
			return
		}
		problem.Write(w, http.StatusForbidden, "Demo side effect disabled", "This public demo disables attachments, outbound integrations, OAuth applications, API tokens, and billing changes.")
	})
}

func sideEffectPath(r *http.Request) bool {
	path := strings.TrimPrefix(r.URL.Path, "/v1")
	path = strings.TrimPrefix(path, "/api")
	if strings.HasPrefix(path, "/attachments/presigned-upload") && r.Method == http.MethodPost {
		return true
	}
	if strings.HasPrefix(path, "/personal-access-tokens") && r.Method != http.MethodGet {
		return true
	}
	if strings.HasPrefix(path, "/oauth/authorize") {
		return true
	}
	if strings.HasPrefix(path, "/integrations") && r.Method != http.MethodGet {
		return true
	}
	if strings.HasPrefix(path, "/workspaces/current/billing") && r.Method != http.MethodGet {
		return true
	}
	if strings.HasPrefix(path, "/workspaces/current/api") && r.Method != http.MethodGet {
		return true
	}
	return false
}

func Reset(ctx context.Context, db *pgxpool.Pool) (workspace, team, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return workspace{}, team{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := resetTx(ctx, tx); err != nil {
		return workspace{}, team{}, err
	}
	ws, defaultTeam, err := seedTx(ctx, tx)
	if err != nil {
		return workspace{}, team{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return workspace{}, team{}, err
	}
	return ws, defaultTeam, nil
}

func EnsureSeeded(ctx context.Context, db *pgxpool.Pool) (workspace, team, error) {
	var ws workspace
	var defaultTeam team
	err := db.QueryRow(ctx, `
		select w.id::text,w.name,w.url_slug,t.id::text,t.name,t.key
		from workspace w
		join team t on t.workspace_id = w.id
		where w.url_slug=$1 and coalesce(w.settings->'demo'->>'enabled','false')='true'
		order by case when t.key='ENG' then 0 else 1 end, t.key
		limit 1`, WorkspaceSlug).Scan(&ws.ID, &ws.Name, &ws.URLSlug, &defaultTeam.ID, &defaultTeam.Name, &defaultTeam.Key)
	if err == nil {
		return ws, defaultTeam, nil
	}
	if err != pgx.ErrNoRows {
		return workspace{}, team{}, err
	}
	return Reset(ctx, db)
}

func resetTx(ctx context.Context, tx pgx.Tx) error {
	var workspaceID string
	err := tx.QueryRow(ctx, `select id::text from workspace where url_slug=$1`, WorkspaceSlug).Scan(&workspaceID)
	if err == pgx.ErrNoRows {
		return deleteDemoUsers(ctx, tx)
	}
	if err != nil {
		return err
	}
	statements := []string{
		`delete from provider_event where workspace_id=$1::uuid`,
		`delete from provider_job where workspace_id=$1::uuid`,
		`delete from provider_credential where workspace_integration_id in (select id from workspace_integration where workspace_id=$1::uuid)`,
		`delete from integration_thread_link where workspace_id=$1::uuid`,
		`delete from zendesk_ticket_link where workspace_id=$1::uuid`,
		`delete from team_notification_integration where team_id in (select id from team where workspace_id=$1::uuid)`,
		`delete from workspace_integration where workspace_id=$1::uuid`,
		`delete from personal_access_token_audit_log where workspace_id=$1::uuid`,
		`delete from personal_access_token where workspace_id=$1::uuid`,
		`delete from operation where workspace_id=$1::uuid`,
		`delete from authorized_application_grant where workspace_id=$1::uuid`,
		`delete from api_key where workspace_id=$1::uuid`,
		`delete from webhook where workspace_id=$1::uuid`,
		`delete from notification where issue_id in (select i.id from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid) or user_id in (select user_id from member where workspace_id=$1::uuid)`,
		`delete from reaction where comment_id in (select c.id from comment c join issue i on i.id=c.issue_id join team t on t.id=i.team_id where t.workspace_id=$1::uuid)`,
		`delete from issue_reaction where issue_id in (select i.id from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid)`,
		`delete from issue_subscription where issue_id in (select i.id from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid)`,
		`delete from issue_discussion_summary where workspace_id=$1::uuid`,
		`delete from comment_attachment where comment_id in (select c.id from comment c join issue i on i.id=c.issue_id join team t on t.id=i.team_id where t.workspace_id=$1::uuid)`,
		`delete from comment where issue_id in (select i.id from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid)`,
		`delete from issue_history where issue_id in (select i.id from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid)`,
		`delete from customer_request where workspace_id=$1::uuid`,
		`delete from issue_label where issue_id in (select i.id from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid)`,
		`delete from issue_relation where issue_id in (select i.id from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid) or related_issue_id in (select i.id from issue i join team t on t.id=i.team_id where t.workspace_id=$1::uuid)`,
		`delete from recurring_issue where workspace_id=$1::uuid`,
		`delete from issue where team_id in (select id from team where workspace_id=$1::uuid)`,
		`delete from customer where workspace_id=$1::uuid`,
		`delete from cycle where team_id in (select id from team where workspace_id=$1::uuid)`,
		`delete from initiative_project where initiative_id in (select id from initiative where workspace_id=$1::uuid)`,
		`delete from initiative_team where initiative_id in (select id from initiative where workspace_id=$1::uuid)`,
		`delete from initiative where workspace_id=$1::uuid`,
		`delete from project_member where project_id in (select id from project where workspace_id=$1::uuid)`,
		`delete from project_milestone where project_id in (select id from project where workspace_id=$1::uuid)`,
		`delete from project_team where project_id in (select id from project where workspace_id=$1::uuid)`,
		`delete from project where workspace_id=$1::uuid`,
		`delete from project_template where workspace_id=$1::uuid`,
		`delete from issue_template where workspace_id=$1::uuid`,
		`delete from project_label where workspace_id=$1::uuid`,
		`delete from label where workspace_id=$1::uuid`,
		`delete from custom_view where workspace_id=$1::uuid`,
		`delete from workflow_state where team_id in (select id from team where workspace_id=$1::uuid)`,
		`delete from team_member where team_id in (select id from team where workspace_id=$1::uuid) or user_id in (select user_id from member where workspace_id=$1::uuid)`,
		`delete from team where workspace_id=$1::uuid`,
		`delete from workspace_invitation where workspace_id=$1::uuid`,
		`delete from member where workspace_id=$1::uuid`,
		`delete from workspace where id=$1::uuid`,
	}
	for _, stmt := range statements {
		if _, err := tx.Exec(ctx, stmt, workspaceID); err != nil {
			return err
		}
	}
	return deleteDemoUsers(ctx, tx)
}

func deleteDemoUsers(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, `delete from session where user_id in (select id from "user" where email like '%@`+guestDomain+`' or settings->>'demoGuest'='true' or settings->>'demoSeed'='true')`); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `delete from "user" where email like '%@`+guestDomain+`' or settings->>'demoGuest'='true' or settings->>'demoSeed'='true'`)
	return err
}

func seedTx(ctx context.Context, tx pgx.Tx) (workspace, team, error) {
	now := time.Now().UTC()
	ws := workspace{ID: "11111111-1111-4111-8111-111111111111", Name: WorkspaceName, URLSlug: WorkspaceSlug}
	settings := []byte(`{"demo":{"enabled":true,"sideEffectsDisabled":true,"resetSchedule":"nightly"},"region":"United States","fiscalMonth":"january","billing":{"plan":"free","issuesUsed":48,"usageLimit":250},"security":{"authentication":{"google":true,"emailPasskey":true},"permissions":{"apiKeyCreationRole":"admin"}}}`)
	if _, err := tx.Exec(ctx, `insert into workspace (id,name,url_slug,settings,invite_link_enabled,created_at,updated_at) values ($1::uuid,$2,$3,$4::jsonb,false,$5,$5)`, ws.ID, ws.Name, ws.URLSlug, settings, now.Add(-30*24*time.Hour)); err != nil {
		return workspace{}, team{}, err
	}
	users := []struct {
		ID, Email, Name string
	}{
		{"demo-founder", "avery@foreverbrowsing.test", "Avery Stone"},
		{"demo-eng-lead", "mira@foreverbrowsing.test", "Mira Patel"},
		{"demo-product-lead", "jules@foreverbrowsing.test", "Jules Kim"},
		{"demo-designer", "noah@foreverbrowsing.test", "Noah Rivera"},
	}
	for _, u := range users {
		if _, err := tx.Exec(ctx, `insert into "user" (id,email,name,email_verified,settings) values ($1,$2,$3,true,'{"demoSeed":true}'::jsonb) on conflict (email) do update set name=excluded.name,email_verified=true`, u.ID, u.Email, u.Name); err != nil {
			return workspace{}, team{}, err
		}
		role := "member"
		if u.ID == "demo-founder" {
			role = "owner"
		}
		if _, err := tx.Exec(ctx, `insert into member (user_id,workspace_id,role) values ($1,$2::uuid,$3::member_role)`, u.ID, ws.ID, role); err != nil {
			return workspace{}, team{}, err
		}
	}
	teams := []team{
		{ID: "22222222-2222-4222-8222-222222222222", Name: "Engineering", Key: "ENG"},
		{ID: "33333333-3333-4333-8333-333333333333", Name: "Product", Key: "PROD"},
	}
	for _, t := range teams {
		if _, err := tx.Exec(ctx, `insert into team (id,name,key,workspace_id,triage_enabled,cycles_enabled,cycle_start_day,cycle_duration_weeks,settings) values ($1::uuid,$2,$3,$4::uuid,true,true,1,2,'{"emailEnabled":false}'::jsonb)`, t.ID, t.Name, t.Key, ws.ID); err != nil {
			return workspace{}, team{}, err
		}
		for _, u := range users {
			if _, err := tx.Exec(ctx, `insert into team_member (team_id,user_id) values ($1::uuid,$2)`, t.ID, u.ID); err != nil {
				return workspace{}, team{}, err
			}
		}
		if err := seedStates(ctx, tx, t.ID); err != nil {
			return workspace{}, team{}, err
		}
	}
	if err := seedProjectsInitiatives(ctx, tx, ws.ID, teams[0], now); err != nil {
		return workspace{}, team{}, err
	}
	if err := seedIssues(ctx, tx, teams[0], now); err != nil {
		return workspace{}, team{}, err
	}
	if err := seedIssues(ctx, tx, teams[1], now); err != nil {
		return workspace{}, team{}, err
	}
	return ws, teams[0], nil
}

func seedStates(ctx context.Context, tx pgx.Tx, teamID string) error {
	states := []struct {
		ID, Name, Category, Color string
		Position                  int
	}{
		{"44444444-0000-4000-8000-000000000001", "Triage", "triage", "#f59e0b", 0},
		{"44444444-0000-4000-8000-000000000002", "Backlog", "backlog", "#6b6f76", 1},
		{"44444444-0000-4000-8000-000000000003", "Todo", "unstarted", "#8b5cf6", 2},
		{"44444444-0000-4000-8000-000000000004", "In Progress", "started", "#2563eb", 3},
		{"44444444-0000-4000-8000-000000000005", "Done", "completed", "#22c55e", 4},
	}
	if strings.HasPrefix(teamID, "33333333") {
		for i := range states {
			states[i].ID = strings.Replace(states[i].ID, "44444444", "55555555", 1)
		}
	}
	for _, s := range states {
		if _, err := tx.Exec(ctx, `insert into workflow_state (id,name,team_id,category,color,position,is_default) values ($1::uuid,$2,$3::uuid,$4::workflow_state_category,$5,$6,true)`, s.ID, s.Name, teamID, s.Category, s.Color, s.Position); err != nil {
			return err
		}
	}
	return nil
}

func seedProjectsInitiatives(ctx context.Context, tx pgx.Tx, workspaceID string, eng team, now time.Time) error {
	projects := []struct {
		ID, Name, Slug, Status, Priority, LeadID string
	}{
		{"66666666-0000-4000-8000-000000000001", "Public launch demo polish", "public-launch-demo-polish", "started", "urgent", "demo-product-lead"},
		{"66666666-0000-4000-8000-000000000002", "Realtime sync hardening", "realtime-sync-hardening", "started", "high", "demo-eng-lead"},
		{"66666666-0000-4000-8000-000000000003", "Import and export operator flow", "import-export-operator-flow", "planned", "medium", "demo-founder"},
	}
	for i, p := range projects {
		if _, err := tx.Exec(ctx, `insert into project (id,name,description,slug,status,priority,lead_id,workspace_id,start_date,target_date,created_at,updated_at) values ($1::uuid,$2,'Seeded public demo project.',$3,$4::project_status,$5::project_priority,$6,$7::uuid,$8,$9,$10,$10)`, p.ID, p.Name, p.Slug, p.Status, p.Priority, p.LeadID, workspaceID, now.AddDate(0, 0, -21+i*4), now.AddDate(0, 0, 21+i*14), now.AddDate(0, 0, -20+i)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into project_team (project_id,team_id) values ($1::uuid,$2::uuid)`, p.ID, eng.ID); err != nil {
			return err
		}
	}
	for _, in := range demoInitiatives {
		if _, err := tx.Exec(ctx, `insert into initiative (id,name,description,status,health,owner_id,workspace_id,timeframe,created_at,updated_at) values ($1::uuid,$2,'Seeded public demo initiative.',$3::initiative_status,$4,'demo-founder',$5::uuid,'H1 Launch',$6,$6)`, in.ID, in.Name, in.Status, in.Health, workspaceID, now.AddDate(0, 0, -18)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into initiative_team (initiative_id,team_id) values ($1::uuid,$2::uuid)`, in.ID, eng.ID); err != nil {
			return err
		}
	}
	for _, pair := range [][2]string{{"77777777-0000-4000-8000-000000000001", "66666666-0000-4000-8000-000000000001"}, {"77777777-0000-4000-8000-000000000001", "66666666-0000-4000-8000-000000000002"}, {"77777777-0000-4000-8000-000000000002", "66666666-0000-4000-8000-000000000003"}} {
		if _, err := tx.Exec(ctx, `insert into initiative_project (initiative_id,project_id) values ($1::uuid,$2::uuid)`, pair[0], pair[1]); err != nil {
			return err
		}
	}
	return nil
}

func seedIssues(ctx context.Context, tx pgx.Tx, t team, now time.Time) error {
	cycleID := "88888888-0000-4000-8000-000000000001"
	start := now.AddDate(0, 0, -3).Truncate(24 * time.Hour)
	if t.Key == "PROD" {
		cycleID = "88888888-0000-4000-8000-000000000002"
	}
	if _, err := tx.Exec(ctx, `insert into cycle (id,name,number,team_id,start_date,end_date) values ($1::uuid,'Current cycle',14,$2::uuid,$3,$4)`, cycleID, t.ID, start, start.AddDate(0, 0, 14)); err != nil {
		return err
	}
	stateIDs := map[string]string{
		"triage":    "44444444-0000-4000-8000-000000000001",
		"backlog":   "44444444-0000-4000-8000-000000000002",
		"unstarted": "44444444-0000-4000-8000-000000000003",
		"started":   "44444444-0000-4000-8000-000000000004",
		"completed": "44444444-0000-4000-8000-000000000005",
	}
	if t.Key == "PROD" {
		for k, v := range stateIDs {
			stateIDs[k] = strings.Replace(v, "44444444", "55555555", 1)
		}
	}
	issues := []struct {
		Number                       int
		Title, Category, Priority    string
		ProjectID, Assignee, Creator string
		DaysAgo                      int
	}{
		{241, "Public demo guest session should open without OAuth", "started", "urgent", "66666666-0000-4000-8000-000000000001", "demo-eng-lead", "demo-product-lead", 2},
		{240, "Seed believable triage queue for screenshots", "triage", "high", "66666666-0000-4000-8000-000000000001", "demo-designer", "demo-product-lead", 1},
		{238, "Reset demo workspace before morning launch checks", "unstarted", "medium", "66666666-0000-4000-8000-000000000001", "demo-founder", "demo-eng-lead", 4},
		{233, "Disable upload and outbound integration side effects", "started", "high", "66666666-0000-4000-8000-000000000002", "demo-eng-lead", "demo-founder", 6},
		{229, "Document the one-command ECS demo reset", "completed", "medium", "66666666-0000-4000-8000-000000000003", "demo-product-lead", "demo-founder", 8},
	}
	if t.Key == "PROD" {
		issues = []struct {
			Number                       int
			Title, Category, Priority    string
			ProjectID, Assignee, Creator string
			DaysAgo                      int
		}{
			{87, "Tighten onboarding copy for public evaluators", "started", "high", "66666666-0000-4000-8000-000000000001", "demo-product-lead", "demo-founder", 2},
			{86, "Collect launch feedback into triage", "triage", "medium", "66666666-0000-4000-8000-000000000001", "demo-designer", "demo-product-lead", 1},
			{82, "Prepare roadmap screenshots for README", "completed", "low", "66666666-0000-4000-8000-000000000003", "demo-designer", "demo-product-lead", 7},
		}
	}
	for i, issue := range issues {
		identifier := t.Key + "-" + intString(issue.Number)
		var issueID string
		err := tx.QueryRow(ctx, `insert into issue (number,identifier,title,description,team_id,state_id,assignee_id,creator_id,priority,project_id,cycle_id,sort_order,created_at,updated_at) values ($1,$2,$3,'Seeded demo issue with realistic project context.',$4::uuid,$5::uuid,$6,$7,$8::issue_priority,$9::uuid,$10::uuid,$11,$12,$12) returning id::text`, issue.Number, identifier, issue.Title, t.ID, stateIDs[issue.Category], issue.Assignee, issue.Creator, issue.Priority, issue.ProjectID, cycleID, float64(i), now.AddDate(0, 0, -issue.DaysAgo)).Scan(&issueID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into issue_history (issue_id,actor_id,event_type,metadata,created_at) values ($1::uuid,$2,'created',$3::jsonb,$4)`, issueID, issue.Creator, []byte(`{"source":"demo_seed"}`), now.AddDate(0, 0, -issue.DaysAgo)); err != nil {
			return err
		}
		if issue.Category == "triage" || issue.Category == "started" {
			if _, err := tx.Exec(ctx, `insert into comment (body,issue_id,user_id,created_at,updated_at) values ('This is sample discussion content for the public demo workspace.',$1::uuid,$2,$3,$3)`, issueID, issue.Creator, now.AddDate(0, 0, -issue.DaysAgo).Add(2*time.Hour)); err != nil {
				return err
			}
		}
	}
	return nil
}

func intString(value int) string {
	return strconv.Itoa(value)
}
