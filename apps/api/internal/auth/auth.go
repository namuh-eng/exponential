package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type contextKey string

const principalKey contextKey = "principal"

const BrowserSessionCookieName = "exponential_session"

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

func (m Middleware) Session(w http.ResponseWriter, r *http.Request) {
	if session, _, err := m.BrowserSession(r.Context(), r); err == nil {
		problem.JSON(w, http.StatusOK, session)
		return
	}
	p, ok := FromContext(r.Context())
	if !ok {
		problem.Write(w, http.StatusUnauthorized, "Unauthorized", "browser session not found")
		return
	}
	var session BrowserSession
	err := m.DB.QueryRow(r.Context(), `
		select id, name, email, image
		from "user"
		where id = $1
		limit 1`, p.UserID).Scan(
		&session.User.ID,
		&session.User.Name,
		&session.User.Email,
		&session.User.Image,
	)
	if err != nil {
		problem.Write(w, http.StatusUnauthorized, "Unauthorized", "browser session not found")
		return
	}
	problem.JSON(w, http.StatusOK, session)
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

func (m Middleware) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		isCookieAuth := bearerToken(r) == ""
		principal, err := m.authenticate(r.Context(), r)
		if err != nil {
			problem.Write(w, http.StatusUnauthorized, "Unauthorized", err.Error())
			return
		}
		// CSRF: for browser-session (cookie) auth on state-mutating methods,
		// verify the Origin or Referer header against the app's known origin.
		if isCookieAuth && isUnsafeMethod(r.Method) {
			if denied, detail := csrfDenied(r); denied {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"error":  "CSRF check failed",
					"code":   "csrf_rejected",
					"reason": detail,
				})
				return
			}
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

// isUnsafeMethod reports whether the HTTP method mutates server state.
func isUnsafeMethod(method string) bool {
	switch strings.ToUpper(method) {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	}
	return false
}

// csrfDenied checks the Origin/Referer header against the configured app URL(s).
// Returns (true, reason) when the request should be rejected.
func csrfDenied(r *http.Request) (bool, string) {
	allowed := csrfAllowedOrigins()
	if len(allowed) == 0 {
		// No app URL configured — allow (fail-open in unconfigured envs).
		return false, ""
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		// Fall back to Referer.
		ref := strings.TrimSpace(r.Header.Get("Referer"))
		if ref != "" {
			if u, err := url.Parse(ref); err == nil {
				origin = u.Scheme + "://" + u.Host
			}
		}
	}
	if origin == "" {
		// No origin information at all — reject to be safe.
		return true, "missing_origin"
	}
	for _, a := range allowed {
		if strings.EqualFold(origin, a) {
			return false, ""
		}
	}
	return true, "origin_not_allowed"
}

// csrfAllowedOrigins returns the set of origins that are permitted to make
// cookie-authenticated state-mutating requests.
func csrfAllowedOrigins() []string {
	seen := map[string]bool{}
	out := []string{}
	for _, env := range []string{"EXPONENTIAL_APP_URL", "PUBLIC_BASE_URL"} {
		raw := strings.TrimRight(strings.TrimSpace(os.Getenv(env)), "/")
		if raw == "" {
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" {
			continue
		}
		origin := u.Scheme + "://" + u.Host
		if !seen[origin] {
			seen[origin] = true
			out = append(out, origin)
		}
	}
	return out
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

// trustedProxyState holds the parsed EXPONENTIAL_TRUSTED_PROXIES CIDRs and
// a once-guard so the one-time warning is emitted exactly once at startup.
var (
	trustedProxyOnce     sync.Once
	trustedProxyNetworks []*net.IPNet
)

// loadTrustedProxies parses EXPONENTIAL_TRUSTED_PROXIES and logs a one-time
// warning when the variable is unset (so operators notice in production).
func loadTrustedProxies() []*net.IPNet {
	trustedProxyOnce.Do(func() {
		raw := strings.TrimSpace(os.Getenv("EXPONENTIAL_TRUSTED_PROXIES"))
		if raw == "" {
			log.Println("[WARN] EXPONENTIAL_TRUSTED_PROXIES is not set — X-Forwarded-For will be ignored and RemoteAddr will be used for all client IP resolution. Set this to your ECS task subnet / ALB CIDRs in production.")
			return
		}
		for _, entry := range strings.Split(raw, ",") {
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}
			if !strings.Contains(entry, "/") {
				entry = entry + "/32"
			}
			_, network, err := net.ParseCIDR(entry)
			if err == nil {
				trustedProxyNetworks = append(trustedProxyNetworks, network)
			}
		}
	})
	return trustedProxyNetworks
}

func clientIP(r *http.Request) string {
	// X-Test-Client-IP is only used in tests.
	if TestMode() {
		if testIP := strings.TrimSpace(strings.Split(r.Header.Get("X-Test-Client-IP"), ",")[0]); testIP != "" {
			return testIP
		}
	}

	// Resolve the direct peer IP from RemoteAddr.
	peerHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		peerHost = strings.TrimSpace(r.RemoteAddr)
	}

	// Only honour XFF / X-Real-IP when the direct peer is a trusted proxy.
	proxies := loadTrustedProxies()
	if len(proxies) > 0 {
		peerIP := net.ParseIP(peerHost)
		isTrusted := peerIP != nil && func() bool {
			for _, network := range proxies {
				if network.Contains(peerIP) {
					return true
				}
			}
			return false
		}()
		if isTrusted {
			for _, value := range []string{r.Header.Get("X-Forwarded-For"), r.Header.Get("X-Real-IP")} {
				if first := strings.TrimSpace(strings.Split(value, ",")[0]); first != "" {
					return first
				}
			}
		}
	}

	return peerHost
}

func ClientIP(r *http.Request) string {
	return clientIP(r)
}

func ipInRange(ip net.IP, value string) bool {
	if strings.Contains(value, "/") {
		_, network, err := net.ParseCIDR(value)
		return err == nil && network.Contains(ip)
	}
	parsed := net.ParseIP(value)
	return parsed != nil && parsed.Equal(ip)
}

func bearerToken(r *http.Request) string {
	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	parts := strings.Fields(authorization)
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return parts[1]
	}
	// Only honour ?access_token= for WebSocket upgrade requests to avoid
	// leaking tokens into server logs, Referer headers, and analytics.
	if isWebSocketUpgrade(r) {
		return strings.TrimSpace(r.URL.Query().Get("access_token"))
	}
	return ""
}

// isWebSocketUpgrade reports whether the request is a WebSocket upgrade.
func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") &&
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}

func (m Middleware) authenticate(ctx context.Context, r *http.Request) (Principal, error) {
	token := bearerToken(r)
	if token == "" {
		_, principal, err := m.BrowserSession(ctx, r)
		return principal, err
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

func TestMode() bool {
	return os.Getenv("NODE_ENV") == "test" || os.Getenv("PLAYWRIGHT_TEST") == "true"
}

func DevSessionSecret() string {
	if s := os.Getenv("EXPONENTIAL_SESSION_SECRET"); s != "" {
		return s
	}
	if s := os.Getenv("EXPONENTIAL_DEV_SESSION_SECRET"); s != "" {
		return s
	}
	return "dev-only-exponential-session-secret-not-for-production"
}

func BrowserSessionCookie(r *http.Request) string {
	for _, name := range []string{BrowserSessionCookieName, "session_token"} {
		cookie, err := r.Cookie(name)
		if err == nil && strings.TrimSpace(cookie.Value) != "" {
			return strings.TrimSpace(cookie.Value)
		}
	}
	return strings.TrimSpace(r.Header.Get("X-Session-Token"))
}

func SignSessionToken(raw string) string {
	mac := hmac.New(sha256.New, []byte(DevSessionSecret()))
	mac.Write([]byte(raw))
	return raw + "." + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func VerifySignedSessionToken(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	raw, sig, ok := strings.Cut(value, ".")
	if !ok {
		// Session cookies are already high-entropy opaque tokens. Signing is
		// supported for test/dev helpers, but unsigned DB-backed opaque tokens are
		// valid for production browser sessions.
		return value, true
	}
	if raw == "" || sig == "" {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(DevSessionSecret()))
	mac.Write([]byte(raw))
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return "", false
	}
	return raw, true
}

func (m Middleware) BrowserSession(ctx context.Context, r *http.Request) (BrowserSession, Principal, error) {
	rawToken, ok := VerifySignedSessionToken(BrowserSessionCookie(r))
	if !ok {
		return BrowserSession{}, Principal{}, errUnauthorized("missing bearer token")
	}
	return m.browserSessionByToken(ctx, r, rawToken)
}

func (m Middleware) TestBrowserSession(ctx context.Context, r *http.Request) (BrowserSession, Principal, error) {
	if !TestMode() {
		return BrowserSession{}, Principal{}, errUnauthorized("test sessions are disabled")
	}
	return m.BrowserSession(ctx, r)
}

// sessionTokenHash returns the hex-encoded SHA-256 hash of rawToken.
// This is the value stored in the session.token_hash column.
func sessionTokenHash(rawToken string) string {
	sum := sha256.Sum256([]byte(rawToken))
	return hex.EncodeToString(sum[:])
}

func (m Middleware) browserSessionByToken(ctx context.Context, r *http.Request, rawToken string) (BrowserSession, Principal, error) {
	var session BrowserSession
	var principal Principal
	tokenHash := sessionTokenHash(rawToken)
	requested := requestedWorkspace(r)
	if requested.ID != "" {
		err := m.DB.QueryRow(ctx, `
			select u.id, u.name, u.email, u.image, m.workspace_id::text, m.role::text
			from session s
			join "user" u on u.id = s.user_id
			join member m on m.user_id = u.id
			where s.token_hash = $1 and s.expires_at > now() and m.workspace_id = $2::uuid
			limit 1`, tokenHash, requested.ID).Scan(
			&session.User.ID,
			&session.User.Name,
			&session.User.Email,
			&session.User.Image,
			&principal.WorkspaceID,
			&principal.Role,
		)
		if err == nil {
			principal.UserID = session.User.ID
			principal.APIKeyID = "browser_session"
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
			where s.token_hash = $1 and s.expires_at > now() and w.url_slug = $2
			limit 1`, tokenHash, requested.Slug).Scan(
			&session.User.ID,
			&session.User.Name,
			&session.User.Email,
			&session.User.Image,
			&principal.WorkspaceID,
			&principal.Role,
		)
		if err == nil {
			principal.UserID = session.User.ID
			principal.APIKeyID = "browser_session"
			return session, principal, nil
		}
	}
	var workspaceID, role *string
	err := m.DB.QueryRow(ctx, `
		select u.id, u.name, u.email, u.image, m.workspace_id::text, m.role::text
		from session s
		join "user" u on u.id = s.user_id
		left join member m on m.user_id = u.id
		where s.token_hash = $1 and s.expires_at > now()
		order by m.created_at desc nulls last
		limit 1`, tokenHash).Scan(
		&session.User.ID,
		&session.User.Name,
		&session.User.Email,
		&session.User.Image,
		&workspaceID,
		&role,
	)
	if err != nil {
		return BrowserSession{}, Principal{}, errUnauthorized("browser session not found")
	}
	if workspaceID != nil {
		principal.WorkspaceID = *workspaceID
	}
	if role != nil {
		principal.Role = *role
	}
	principal.UserID = session.User.ID
	principal.APIKeyID = "browser_session"
	return session, principal, nil
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
