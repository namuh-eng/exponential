package authproviders

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

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
	r.Get("/provider-capabilities", h.ProviderCapabilities)
	return r
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
		"passkey":       emailPasskeyAllowed && passkeyAuthEnabled(),
		"googleAllowed": googleAllowed,
		"emailPasskey":  emailPasskeyAllowed,
	}
	w.Header().Set("Cache-Control", "no-store")
	problem.JSON(w, 200, capabilitiesResponse{Providers: providers, Workspace: policy})
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
	if slug == "" {
		return nil, nil
	}
	var settings []byte
	err := h.DB.QueryRow(r.Context(), `select coalesce(settings,'{}'::jsonb) from workspace where url_slug=$1 limit 1`, slug).Scan(&settings)
	if err != nil {
		return nil, nil
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
