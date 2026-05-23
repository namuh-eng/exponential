package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"

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
	DB *pgxpool.Pool
}

func (m Middleware) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, err := m.authenticate(r.Context(), r.Header)
		if err != nil {
			problem.Write(w, http.StatusUnauthorized, "Unauthorized", err.Error())
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey, principal)))
	})
}

func (m Middleware) authenticate(ctx context.Context, headers http.Header) (Principal, error) {
	authorization := strings.TrimSpace(headers.Get("Authorization"))
	parts := strings.Fields(authorization)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return Principal{}, errUnauthorized("missing bearer token")
	}
	token := parts[1]
	if !(strings.HasPrefix(token, "lin_api_") || strings.HasPrefix(token, "pat_")) {
		return Principal{}, errUnauthorized("unsupported token prefix")
	}

	hash := sha256.Sum256([]byte(token))
	keyHash := hex.EncodeToString(hash[:])
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

type unauthorized string

func errUnauthorized(message string) error { return unauthorized(message) }
func (e unauthorized) Error() string       { return string(e) }
