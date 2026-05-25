package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type contextKey string

const principalKey contextKey = "principal"

type Principal struct {
	UserID      string
	WorkspaceID string
	Role        string
	APIKeyID    string
}

type BrowserSession struct {
	User BrowserSessionUser `json:"user"`
}

type BrowserSessionUser struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Email string  `json:"email"`
	Image *string `json:"image"`
}

func FromContext(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(principalKey).(Principal)
	return principal, ok
}

func WithPrincipal(ctx context.Context, principal Principal) context.Context {
	return context.WithValue(ctx, principalKey, principal)
}

type Middleware struct {
	DB     *pgxpool.Pool
	Client *http.Client
}

var defaultHTTPClient = &http.Client{Timeout: 5 * time.Second}

func (m Middleware) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, err := m.authenticate(r.Context(), r)
		if err != nil {
			problem.Write(w, http.StatusUnauthorized, "Unauthorized", err.Error())
			return
		}
		if denied, detail := m.workspaceIPDenied(r.Context(), r, principal.WorkspaceID); denied {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error":  "Workspace access denied by IP restrictions",
				"code":   "workspace_ip_restricted",
				"reason": detail,
			})
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey, principal)))
	})
}

func (m Middleware) workspaceIPDenied(ctx context.Context, r *http.Request, workspaceID string) (bool, string) {
	if strings.TrimSpace(workspaceID) == "" {
		return false, ""
	}
	var raw []byte
	if err := m.DB.QueryRow(ctx, `select coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid`, workspaceID).Scan(&raw); err != nil {
		return false, ""
	}
	var settings map[string]any
	_ = json.Unmarshal(raw, &settings)
	security := record(settings["security"])
	restrictions, _ := security["ipRestrictions"].([]any)
	enabled := []string{}
	for _, item := range restrictions {
		rec := record(item)
		if rec == nil || rec["enabled"] == false {
			continue
		}
		if value, ok := rec["range"].(string); ok && strings.TrimSpace(value) != "" {
			enabled = append(enabled, strings.TrimSpace(value))
		}
	}
	if len(enabled) == 0 {
		return false, ""
	}
	clientIP := clientIP(r)
	if clientIP == "" {
		return true, "missing_client_ip"
	}
	parsed := net.ParseIP(clientIP)
	if parsed == nil {
		return true, "invalid_client_ip"
	}
	for _, cidr := range enabled {
		if ipInRange(parsed, cidr) {
			return false, ""
		}
	}
	return true, "ip_not_allowed"
}

func record(value any) map[string]any {
	if rec, ok := value.(map[string]any); ok {
		return rec
	}
	return map[string]any{}
}

func clientIP(r *http.Request) string {
	for _, value := range []string{r.Header.Get("X-Test-Client-IP"), r.Header.Get("X-Forwarded-For"), r.Header.Get("X-Real-IP")} {
		if first := strings.TrimSpace(strings.Split(value, ",")[0]); first != "" {
			return first
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func ipInRange(ip net.IP, value string) bool {
	if strings.Contains(value, "/") {
		_, network, err := net.ParseCIDR(value)
		return err == nil && network.Contains(ip)
	}
	return net.ParseIP(value).Equal(ip)
}

func bearerToken(r *http.Request) string {
	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	parts := strings.Fields(authorization)
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return parts[1]
	}
	return strings.TrimSpace(r.URL.Query().Get("access_token"))
}

func (m Middleware) authenticate(ctx context.Context, r *http.Request) (Principal, error) {
	token := bearerToken(r)
	if token == "" {
		if TestMode() {
			_, principal, err := m.TestBrowserSession(ctx, r)
			if err == nil {
				return principal, nil
			}
		}
		return m.authenticateKratosSession(ctx, r)
	}
	if !(strings.HasPrefix(token, "lin_api_") || strings.HasPrefix(token, "pat_")) {
		return Principal{}, errUnauthorized("unsupported token prefix")
	}

	hash := sha256.Sum256([]byte(token))
	keyHash := hex.EncodeToString(hash[:])
	if strings.HasPrefix(token, "pat_") {
		return m.authenticatePAT(ctx, keyHash)
	}
	return m.authenticateLegacyAPIKey(ctx, keyHash)
}

func (m Middleware) authenticateKratosSession(ctx context.Context, r *http.Request) (Principal, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("EXPONENTIAL_API_KRATOS_URL")), "/")
	if baseURL == "" {
		baseURL = strings.TrimRight(strings.TrimSpace(os.Getenv("KRATOS_PUBLIC_URL")), "/")
	}
	if baseURL == "" {
		return Principal{}, errUnauthorized("missing bearer token")
	}
	if r.Header.Get("Cookie") == "" && r.Header.Get("X-Session-Token") == "" {
		return Principal{}, errUnauthorized("missing bearer token")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/sessions/whoami", nil)
	if err != nil {
		return Principal{}, errUnauthorized("invalid kratos configuration")
	}
	request.Header.Set("Accept", "application/json")
	if cookie := r.Header.Get("Cookie"); cookie != "" {
		request.Header.Set("Cookie", cookie)
	}
	if token := r.Header.Get("X-Session-Token"); token != "" {
		request.Header.Set("X-Session-Token", token)
	}
	client := m.Client
	if client == nil {
		client = defaultHTTPClient
	}
	response, err := client.Do(request)
	if err != nil {
		return Principal{}, errUnauthorized("kratos session verification failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Principal{}, errUnauthorized("invalid kratos session")
	}
	var payload kratosWhoami
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return Principal{}, errUnauthorized("invalid kratos session payload")
	}
	email := payload.Email()
	if email == "" {
		return Principal{}, errUnauthorized("kratos identity missing email")
	}
	return m.authenticateKratosEmail(ctx, email, requestedWorkspace(r))
}

func TestMode() bool {
	return os.Getenv("NODE_ENV") == "test" || os.Getenv("PLAYWRIGHT_TEST") == "true"
}

func BetterAuthSecret() string {
	if s := os.Getenv("BETTER_AUTH_SECRET"); s != "" {
		return s
	}
	return "dev-only-better-auth-secret-not-for-production"
}

func signedBrowserSessionCookie(r *http.Request) string {
	for _, name := range []string{"ory_kratos_session", "better-auth.session_token", "better-auth.session-token"} {
		cookie, err := r.Cookie(name)
		if err == nil && strings.TrimSpace(cookie.Value) != "" {
			return strings.TrimSpace(cookie.Value)
		}
	}
	return ""
}

func VerifySignedSessionToken(value string) (string, bool) {
	raw, sig, ok := strings.Cut(strings.TrimSpace(value), ".")
	if !ok || raw == "" || sig == "" {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(BetterAuthSecret()))
	mac.Write([]byte(raw))
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return "", false
	}
	return raw, true
}

func (m Middleware) TestBrowserSession(ctx context.Context, r *http.Request) (BrowserSession, Principal, error) {
	if !TestMode() {
		return BrowserSession{}, Principal{}, errUnauthorized("test sessions are disabled")
	}
	rawToken, ok := VerifySignedSessionToken(signedBrowserSessionCookie(r))
	if !ok {
		return BrowserSession{}, Principal{}, errUnauthorized("invalid test session")
	}
	var session BrowserSession
	var principal Principal
	requested := requestedWorkspace(r)
	if requested.ID != "" {
		err := m.DB.QueryRow(ctx, `
			select u.id, u.name, u.email, u.image, m.workspace_id::text, m.role::text
			from session s
			join "user" u on u.id = s.user_id
			join member m on m.user_id = u.id
			where s.token = $1 and s.expires_at > now() and m.workspace_id = $2::uuid
			limit 1`, rawToken, requested.ID).Scan(
			&session.User.ID,
			&session.User.Name,
			&session.User.Email,
			&session.User.Image,
			&principal.WorkspaceID,
			&principal.Role,
		)
		if err == nil {
			principal.UserID = session.User.ID
			principal.APIKeyID = "playwright_test_session"
			return session, principal, nil
		}
	}
	if requested.Slug != "" {
		err := m.DB.QueryRow(ctx, `
			select u.id, u.name, u.email, u.image, m.workspace_id::text, m.role::text
			from session s
			join "user" u on u.id = s.user_id
			join member m on m.user_id = u.id
			join workspace w on w.id = m.workspace_id
			where s.token = $1 and s.expires_at > now() and w.url_slug = $2
			limit 1`, rawToken, requested.Slug).Scan(
			&session.User.ID,
			&session.User.Name,
			&session.User.Email,
			&session.User.Image,
			&principal.WorkspaceID,
			&principal.Role,
		)
		if err == nil {
			principal.UserID = session.User.ID
			principal.APIKeyID = "playwright_test_session"
			return session, principal, nil
		}
	}
	err := m.DB.QueryRow(ctx, `
		select u.id, u.name, u.email, u.image, m.workspace_id::text, m.role::text
		from session s
		join "user" u on u.id = s.user_id
		join member m on m.user_id = u.id
		where s.token = $1 and s.expires_at > now()
		order by m.created_at desc
		limit 1`, rawToken).Scan(
		&session.User.ID,
		&session.User.Name,
		&session.User.Email,
		&session.User.Image,
		&principal.WorkspaceID,
		&principal.Role,
	)
	if err != nil {
		return BrowserSession{}, Principal{}, errUnauthorized("test session not found")
	}
	principal.UserID = session.User.ID
	principal.APIKeyID = "playwright_test_session"
	return session, principal, nil
}

func (m Middleware) authenticateKratosEmail(ctx context.Context, email string, requested requestedWorkspaceChoice) (Principal, error) {
	var p Principal
	if requested.ID != "" {
		err := m.DB.QueryRow(ctx, `
			select u.id, m.workspace_id::text, m.role::text
			from "user" u
			join member m on m.user_id = u.id
			where lower(u.email)=lower($1) and m.workspace_id=$2::uuid
			limit 1`, email, requested.ID).Scan(&p.UserID, &p.WorkspaceID, &p.Role)
		if err == nil {
			p.APIKeyID = "kratos_session"
			return p, nil
		}
	}
	if requested.Slug != "" {
		err := m.DB.QueryRow(ctx, `
			select u.id, m.workspace_id::text, m.role::text
			from "user" u
			join member m on m.user_id = u.id
			join workspace w on w.id = m.workspace_id
			where lower(u.email)=lower($1) and w.url_slug=$2
			limit 1`, email, requested.Slug).Scan(&p.UserID, &p.WorkspaceID, &p.Role)
		if err == nil {
			p.APIKeyID = "kratos_session"
			return p, nil
		}
	}
	err := m.DB.QueryRow(ctx, `
		select u.id, m.workspace_id::text, m.role::text
		from "user" u
		join member m on m.user_id = u.id
		where lower(u.email)=lower($1)
		order by m.created_at desc
		limit 1`, email).Scan(&p.UserID, &p.WorkspaceID, &p.Role)
	if err != nil {
		return Principal{}, errUnauthorized("kratos identity is not linked to a local workspace")
	}
	p.APIKeyID = "kratos_session"
	return p, nil
}

type kratosWhoami struct {
	Identity struct {
		ID     string         `json:"id"`
		Traits map[string]any `json:"traits"`
	} `json:"identity"`
}

func (w kratosWhoami) Email() string {
	if email, ok := w.Identity.Traits["email"].(string); ok {
		return strings.TrimSpace(email)
	}
	return ""
}

type requestedWorkspaceChoice struct {
	ID   string
	Slug string
}

func requestedWorkspace(r *http.Request) requestedWorkspaceChoice {
	if id := requestedWorkspaceID(r); id != "" {
		return requestedWorkspaceChoice{ID: id}
	}
	if slug := requestedWorkspaceSlug(r); slug != "" {
		return requestedWorkspaceChoice{Slug: slug}
	}
	if id := cookieValue(r, "activeWorkspaceId"); id != "" {
		return requestedWorkspaceChoice{ID: id}
	}
	if slug := cookieValue(r, "activeWorkspaceSlug"); slug != "" {
		return requestedWorkspaceChoice{Slug: slug}
	}
	return requestedWorkspaceChoice{}
}

func requestedWorkspaceID(r *http.Request) string {
	for _, value := range []string{
		r.Header.Get("X-Workspace-Id"),
		r.Header.Get("X-Workspace-ID"),
		r.URL.Query().Get("workspace_id"),
	} {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func requestedWorkspaceSlug(r *http.Request) string {
	for _, value := range []string{
		r.Header.Get("X-Workspace-Slug"),
		r.URL.Query().Get("workspace_slug"),
		workspaceSlugFromReferer(r.Header.Get("Referer")),
	} {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func cookieValue(r *http.Request, name string) string {
	cookie, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(cookie.Value)
}

func workspaceSlugFromReferer(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	request, err := http.NewRequest(http.MethodGet, value, nil)
	if err != nil {
		return ""
	}
	segments := strings.Split(strings.Trim(request.URL.Path, "/"), "/")
	if len(segments) == 0 || segments[0] == "" {
		return ""
	}
	first := segments[0]
	switch first {
	case "api", "v1", "login", "signup", "homepage", "pricing", "customers", "changelog", "now":
		return ""
	default:
		return first
	}
}

func (m Middleware) authenticateLegacyAPIKey(ctx context.Context, keyHash string) (Principal, error) {
	var p Principal
	err := m.DB.QueryRow(ctx, `
		select ak.id::text, ak.user_id, ak.workspace_id::text, m.role::text
		from api_key ak
		join member m on m.user_id = ak.user_id and m.workspace_id = ak.workspace_id
		where ak.key_hash = $1
		limit 1`, keyHash).Scan(&p.APIKeyID, &p.UserID, &p.WorkspaceID, &p.Role)
	if err != nil {
		return Principal{}, errUnauthorized("invalid token")
	}
	_, _ = m.DB.Exec(ctx, `update api_key set last_used_at = now() where id = $1::uuid`, p.APIKeyID)
	return p, nil
}

func (m Middleware) authenticatePAT(ctx context.Context, keyHash string) (Principal, error) {
	var p Principal
	err := m.DB.QueryRow(ctx, `
		select pat.id::text, pat.user_id, pat.workspace_id::text, m.role::text
		from personal_access_token pat
		join member m on m.user_id = pat.user_id and m.workspace_id = pat.workspace_id
		where pat.token_hash = $1 and pat.revoked_at is null
		limit 1`, keyHash).Scan(&p.APIKeyID, &p.UserID, &p.WorkspaceID, &p.Role)
	if err != nil {
		return Principal{}, errUnauthorized("invalid token")
	}
	_, _ = m.DB.Exec(ctx, `update personal_access_token set last_used_at = now() where id = $1::uuid`, p.APIKeyID)
	_, _ = m.DB.Exec(ctx, `insert into personal_access_token_audit_log (token_id, user_id, workspace_id, action) values ($1::uuid, $2, $3::uuid, 'used')`, p.APIKeyID, p.UserID, p.WorkspaceID)
	return p, nil
}

type unauthorized string

func errUnauthorized(message string) error { return unauthorized(message) }
func (e unauthorized) Error() string       { return string(e) }
