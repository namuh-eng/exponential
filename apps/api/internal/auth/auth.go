package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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

func FromContext(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(principalKey).(Principal)
	return principal, ok
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
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey, principal)))
	})
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
	return m.authenticateKratosEmail(ctx, email, requestedWorkspaceID(r))
}

func (m Middleware) authenticateKratosEmail(ctx context.Context, email string, workspaceID string) (Principal, error) {
	var p Principal
	if workspaceID != "" {
		err := m.DB.QueryRow(ctx, `
			select u.id, m.workspace_id::text, m.role::text
			from "user" u
			join member m on m.user_id = u.id
			where lower(u.email)=lower($1) and m.workspace_id=$2::uuid
			limit 1`, email, workspaceID).Scan(&p.UserID, &p.WorkspaceID, &p.Role)
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

func requestedWorkspaceID(r *http.Request) string {
	for _, value := range []string{r.Header.Get("X-Workspace-Id"), r.Header.Get("X-Workspace-ID"), r.URL.Query().Get("workspace_id")} {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
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
