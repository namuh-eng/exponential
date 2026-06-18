package authproviders

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/email"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct {
	DB    *pgxpool.Pool
	Email email.Sender
}

type providerCapability struct {
	Supported         bool    `json:"supported"`
	Configured        bool    `json:"configured"`
	DevLinking        bool    `json:"devLinking"`
	UnavailableReason *string `json:"unavailableReason"`
}

type authSettings struct {
	Google       bool `json:"google"`
	EmailPasskey bool `json:"emailPasskey"`
}

type workspaceInfo struct {
	Slug           string       `json:"slug"`
	Authentication authSettings `json:"authentication"`
}

type capabilitiesResponse struct {
	Providers map[string]any `json:"providers"`
	Workspace *workspaceInfo `json:"workspace"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/get-session", h.GetSession)
	r.Get("/provider-capabilities", h.ProviderCapabilities)
	r.Get("/google/start", h.StartGoogle)
	r.Get("/google/callback", h.GoogleCallback)
	r.Get("/discord/start", h.StartDiscord)
	r.Get("/discord/callback", h.DiscordCallback)
	r.Get("/microsoft/start", h.StartMicrosoft)
	r.Get("/microsoft/callback", h.MicrosoftCallback)
	r.Post("/magic-link", h.StartMagicLink)
	r.Get("/magic-link/callback", h.MagicLinkCallback)
	r.Post("/sign-out", h.SignOut)
	r.Post("/saml/discovery", h.SAMLDiscovery)
	r.Post("/saml/acs", h.SAMLACS)
	r.Get("/saml/metadata", h.SAMLMetadata)
	r.Post("/oidc/discovery", h.OIDCDiscovery)
	r.Get("/oidc/callback", h.OIDCCallback)
	return r
}

func (h Handler) GetSession(w http.ResponseWriter, r *http.Request) {
	session, _, err := (auth.Middleware{DB: h.DB}).BrowserSession(r.Context(), r)
	if err == nil {
		problem.JSON(w, 200, session)
		return
	}
	problem.JSON(w, 200, nil)
}

func (h Handler) ProviderCapabilities(w http.ResponseWriter, r *http.Request) {
	policy, err := h.resolvePolicy(r)
	if err != nil {
		problem.Write(w, 500, "Resolve provider capabilities failed", err.Error())
		return
	}
	googleAllowed := authMethodAllowed(policy, "google")
	emailPasskeyAllowed := authMethodAllowed(policy, "emailPasskey")
	providers := map[string]any{
		"google":        accountProviderCapability(googleAllowed && oauthConfigured("AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"), "Google"),
		"github":        accountProviderCapability(oauthConfigured("AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"), "GitHub"),
		"gitlab":        accountProviderCapability(oauthConfigured("AUTH_GITLAB_ID", "AUTH_GITLAB_SECRET"), "GitLab"),
		"slack":         accountProviderCapability(oauthConfigured("AUTH_SLACK_ID", "AUTH_SLACK_SECRET"), "Slack"),
		"discord":      accountProviderCapability(oauthConfigured("AUTH_DISCORD_ID", "AUTH_DISCORD_SECRET"), "Discord"),
		"microsoft":     accountProviderCapability(oauthConfigured("AUTH_MICROSOFT_ID", "AUTH_MICROSOFT_SECRET"), "Microsoft"),
		"saml":          h.samlCapability(r, policy),
		"oidc":          h.oidcCapability(r, policy),
		"passkey":       emailPasskeyAllowed && passkeyAuthEnabled(),
		"googleAllowed": googleAllowed,
		"emailPasskey":  emailPasskeyAllowed,
	}
	w.Header().Set("Cache-Control", "no-store")
	problem.JSON(w, 200, capabilitiesResponse{Providers: providers, Workspace: policy})
}

type samlDiscoveryRequest struct {
	Email       string `json:"email"`
	CallbackURL string `json:"callbackURL"`
}

func (h Handler) SAMLDiscovery(w http.ResponseWriter, r *http.Request) {
	var input samlDiscoveryRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.JSON(w, 400, map[string]string{"error": "Request body must be valid JSON."})
		return
	}
	domain := extractEmailDomain(input.Email)
	if domain == "" {
		problem.JSON(w, 400, map[string]string{"error": "Enter a valid email address."})
		return
	}
	discoveredURL, err := h.samlDiscoveryRedirect(r.Context(), r, domain, input.CallbackURL)
	if err != nil {
		problem.Write(w, 500, "Discover SAML URL failed", err.Error())
		return
	}
	if discoveredURL == "" {
		problem.JSON(w, 404, map[string]string{"error": "No SAML SSO enabled workspace could be found."})
		return
	}
	problem.JSON(w, 200, map[string]string{"url": discoveredURL})
}

func accountProviderCapability(configured bool, label string) providerCapability {
	devLinking := configured || os.Getenv("NODE_ENV") != "production"
	var reason *string
	if !configured {
		message := label + " OAuth is not configured. Dev and e2e can still exercise the linking surface."
		reason = &message
	}
	return providerCapability{Supported: true, Configured: configured, DevLinking: devLinking, UnavailableReason: reason}
}

func enterpriseProviderCapability(configured bool, label string) providerCapability {
	var reason *string
	if !configured {
		message := label + " is not configured for any matching workspace."
		reason = &message
	}
	return providerCapability{Supported: true, Configured: configured, DevLinking: false, UnavailableReason: reason}
}

func (h Handler) samlCapability(r *http.Request, policy *workspaceInfo) providerCapability {
	return enterpriseProviderCapability(h.anySSOConfigured(r, policy, "saml"), "SAML SSO")
}

func (h Handler) oidcCapability(r *http.Request, policy *workspaceInfo) providerCapability {
	return enterpriseProviderCapability(h.anySSOConfigured(r, policy, "oidc"), "OIDC SSO")
}

func (h Handler) anySSOConfigured(r *http.Request, policy *workspaceInfo, provider string) bool {
	if h.DB == nil {
		return false
	}
	if policy != nil && policy.Slug != "" {
		var raw []byte
		err := h.DB.QueryRow(r.Context(), `select coalesce(settings,'{}'::jsonb) from workspace where url_slug=$1 limit 1`, policy.Slug).Scan(&raw)
		if err != nil {
			return false
		}
		return ssoSettingsConfigured(provider, raw)
	}
	rows, err := h.DB.Query(r.Context(), `select coalesce(settings,'{}'::jsonb) from workspace`)
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return false
		}
		if ssoSettingsConfigured(provider, raw) {
			return true
		}
	}
	return false
}

func ssoSettingsConfigured(provider string, raw []byte) bool {
	if provider == "saml" {
		settings := readSAMLWorkspaceSettings(raw)
		return settings.Enabled && len(settings.Domains) > 0 && (settings.IDPSSOURL != "" || settings.MetadataURL != "" || settings.MetadataXML != "")
	}
	settings := readOIDCWorkspaceSettings(raw)
	return settings.Enabled && settings.configured()
}

func oauthConfigured(idKey, secretKey string) bool {
	return strings.TrimSpace(os.Getenv(idKey)) != "" && strings.TrimSpace(os.Getenv(secretKey)) != ""
}

func passkeyAuthEnabled() bool { return os.Getenv("PASSKEY_AUTH_DISABLED") != "true" }

func authMethodAllowed(policy *workspaceInfo, method string) bool {
	if policy == nil {
		return true
	}
	if method == "google" {
		return policy.Authentication.Google
	}
	if method == "emailPasskey" {
		return policy.Authentication.EmailPasskey
	}
	return true
}

func (h Handler) resolvePolicy(r *http.Request) (*workspaceInfo, error) {
	slug := workspaceSlugFromCallbackURL(r.URL.Query().Get("callbackUrl"), requestBaseURL(r))
	return h.resolvePolicyForSlug(r, slug)
}

func (h Handler) authMethodAllowedForCallback(r *http.Request, callbackURL string, method string) bool {
	slug := workspaceSlugFromCallbackURL(callbackURL, requestBaseURL(r))
	policy, err := h.resolvePolicyForSlug(r, slug)
	if err != nil {
		return false
	}
	return authMethodAllowed(policy, method)
}

func (h Handler) resolvePolicyForSlug(r *http.Request, slug string) (*workspaceInfo, error) {
	if slug == "" {
		return nil, nil
	}
	var settings []byte
	err := h.DB.QueryRow(r.Context(), `select coalesce(settings,'{}'::jsonb) from workspace where url_slug=$1 limit 1`, slug).Scan(&settings)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &workspaceInfo{Slug: slug, Authentication: readAuthSettings(settings)}, nil
}

func readAuthSettings(settings []byte) authSettings {
	root := asRecordJSON(settings)
	security := asRecordAny(root["security"])
	authentication := asRecordAny(security["authentication"])
	return authSettings{Google: boolValueDefault(authentication["google"], true), EmailPasskey: boolValueDefault(authentication["emailPasskey"], true)}
}

func workspaceSlugFromCallbackURL(callbackURL, baseURL string) string {
	if strings.TrimSpace(callbackURL) == "" {
		return ""
	}
	parsed, err := url.Parse(callbackURL)
	if err != nil {
		return ""
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		return ""
	}
	resolved := base.ResolveReference(parsed)
	if resolved.Scheme != base.Scheme || resolved.Host != base.Host {
		return ""
	}
	return workspaceSlugFromPath(resolved.Path)
}

func requestBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		scheme = strings.Split(forwarded, ",")[0]
	}
	return scheme + "://" + r.Host
}

func workspaceSlugFromPath(pathname string) string {
	segments := []string{}
	for _, part := range strings.Split(pathname, "/") {
		if part != "" {
			segments = append(segments, part)
		}
	}
	if len(segments) > 1 && !isAppRoutePrefix(segments[0]) && !isPublicRoutePrefix(segments[0]) && isAppRoutePrefix(segments[1]) {
		slug, err := url.PathUnescape(segments[0])
		if err != nil {
			return ""
		}
		return slug
	}
	return ""
}

func isAppRoutePrefix(segment string) bool {
	switch segment {
	case "inbox", "my-issues", "projects", "project", "views", "team", "members", "teams", "agent", "issue", "initiatives", "cycles", "roadmap", "settings", "search":
		return true
	default:
		return false
	}
}

func isPublicRoutePrefix(segment string) bool {
	switch segment {
	case "login", "signup", "homepage", "pricing", "customers", "changelog", "now", "api", "onboarding", "accept-invite", "create-workspace", "_next", "favicon.ico":
		return true
	default:
		return false
	}
}

func asRecordJSON(raw []byte) map[string]any {
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return out
}

func asRecordAny(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return map[string]any{}
}

func boolValueDefault(value any, fallback bool) bool {
	if b, ok := value.(bool); ok {
		return b
	}
	return fallback
}

func extractEmailDomain(email string) string {
	normalized := strings.ToLower(strings.TrimSpace(email))
	parts := strings.Split(normalized, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" || !strings.Contains(parts[1], ".") || strings.ContainsAny(normalized, " \t\n") {
		return ""
	}
	domain := parts[1]
	if ok, _ := regexp.MatchString(`^[a-z0-9.-]+\.[a-z]{2,}$`, domain); !ok {
		return ""
	}
	return domain
}


type samlDiscoverySettings struct {
	enabled bool
	domains []string
	url     string
}

func readSAMLDiscoverySettings(raw []byte) samlDiscoverySettings {
	root := map[string]any{}
	_ = json.Unmarshal(raw, &root)
	security := asRecordAny(root["security"])
	saml := asRecordAny(firstNonNilAuth(security["saml"], root["saml"], root["sso"]))
	return samlDiscoverySettings{enabled: boolValueDefault(saml["enabled"], false), domains: normalizeSAMLDiscoveryDomains(firstNonNilAuth(saml["domains"], saml["emailDomains"])), url: firstStringAuth(saml["idpSsoUrl"], saml["ssoUrl"], saml["ssoURL"], saml["url"])}
}

func normalizeSAMLDiscoveryDomains(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return []string{}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, item := range items {
		domain := strings.TrimLeft(strings.ToLower(strings.TrimSpace(firstStringAuth(item))), "@")
		if ok, _ := regexp.MatchString(`^[a-z0-9.-]+\.[a-z]{2,}$`, domain); !ok || seen[domain] {
			continue
		}
		seen[domain] = true
		out = append(out, domain)
	}
	return out
}

func firstNonNilAuth(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstStringAuth(values ...any) string {
	for _, value := range values {
		if s, ok := value.(string); ok {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}
