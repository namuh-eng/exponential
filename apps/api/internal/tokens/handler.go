package tokens

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type Token struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Prefix     string   `json:"token_prefix"`
	Scopes     []string `json:"scopes"`
	CreatedAt  string   `json:"created_at"`
	LastUsedAt *string  `json:"last_used_at"`
	RevokedAt  *string  `json:"revoked_at"`
}

type createRequest struct {
	Name   string   `json:"name"`
	Scopes []string `json:"scopes"`
}

type createResponse struct {
	Token Token  `json:"token"`
	Value string `json:"value"`
}

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Delete("/{id}", h.Revoke)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	rows, err := h.DB.Query(r.Context(), `select id::text, name, token_prefix, scopes, created_at, last_used_at, revoked_at from personal_access_token where user_id=$1 and workspace_id=$2::uuid order by created_at desc`, p.UserID, p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "List personal access tokens failed", err.Error())
		return
	}
	defer rows.Close()
	tokens := []Token{}
	for rows.Next() {
		token, err := scanToken(rows)
		if err != nil {
			problem.Write(w, 500, "List personal access tokens failed", err.Error())
			return
		}
		tokens = append(tokens, token)
	}
	problem.JSON(w, 200, map[string][]Token{"tokens": tokens})
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	var input createRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", err.Error())
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		problem.Write(w, 400, "Token name is required", "")
		return
	}
	if len(name) > 255 {
		problem.Write(w, 400, "Token name must be 255 characters or fewer", "")
		return
	}
	scopes := normalizeScopes(input.Scopes)
	if len(input.Scopes) > 0 && len(scopes) == 0 {
		problem.Write(w, 400, "Unsupported token scope", "Personal access token scopes must be read and/or write.")
		return
	}
	value, err := newPATSecret()
	if err != nil {
		problem.Write(w, 500, "Create personal access token failed", err.Error())
		return
	}
	hash := sha256.Sum256([]byte(value))
	scopesJSON, _ := json.Marshal(scopes)
	row := h.DB.QueryRow(r.Context(), `insert into personal_access_token (name, token_hash, token_prefix, user_id, workspace_id, scopes) values ($1,$2,$3,$4,$5::uuid,$6::jsonb) returning id::text, name, token_prefix, scopes, created_at, last_used_at, revoked_at`, name, hex.EncodeToString(hash[:]), value[:min(len(value), 20)], p.UserID, p.WorkspaceID, scopesJSON)
	token, err := scanToken(row)
	if err != nil {
		problem.Write(w, 500, "Create personal access token failed", err.Error())
		return
	}
	_, _ = h.DB.Exec(r.Context(), `insert into personal_access_token_audit_log (token_id, user_id, workspace_id, action) values ($1::uuid,$2,$3::uuid,'created')`, token.ID, p.UserID, p.WorkspaceID)
	problem.JSON(w, 201, createResponse{Token: token, Value: value})
}

func (h Handler) Revoke(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	id := chi.URLParam(r, "id")
	cmd, err := h.DB.Exec(r.Context(), `update personal_access_token set revoked_at=coalesce(revoked_at, now()) where id=$1::uuid and user_id=$2 and workspace_id=$3::uuid`, id, p.UserID, p.WorkspaceID)
	if err != nil {
		problem.Write(w, 500, "Revoke personal access token failed", err.Error())
		return
	}
	if cmd.RowsAffected() == 0 {
		problem.Write(w, 404, "Personal access token not found", "")
		return
	}
	_, _ = h.DB.Exec(r.Context(), `insert into personal_access_token_audit_log (token_id, user_id, workspace_id, action) values ($1::uuid,$2,$3::uuid,'revoked')`, id, p.UserID, p.WorkspaceID)
	problem.JSON(w, 200, map[string]bool{"success": true})
}

type scanner interface{ Scan(dest ...any) error }

func scanToken(row scanner) (Token, error) {
	var token Token
	var scopesRaw []byte
	var created time.Time
	var lastUsed *time.Time
	var revoked *time.Time
	if err := row.Scan(&token.ID, &token.Name, &token.Prefix, &scopesRaw, &created, &lastUsed, &revoked); err != nil {
		return Token{}, err
	}
	_ = json.Unmarshal(scopesRaw, &token.Scopes)
	if token.Scopes == nil {
		token.Scopes = []string{}
	}
	token.CreatedAt = created.UTC().Format(time.RFC3339Nano)
	if lastUsed != nil {
		v := lastUsed.UTC().Format(time.RFC3339Nano)
		token.LastUsedAt = &v
	}
	if revoked != nil {
		v := revoked.UTC().Format(time.RFC3339Nano)
		token.RevokedAt = &v
	}
	return token, nil
}

func normalizeScopes(scopes []string) []string {
	if len(scopes) == 0 {
		return []string{"read", "write"}
	}
	seen := map[string]bool{}
	out := []string{}
	for _, scope := range scopes {
		scope = strings.TrimSpace(strings.ToLower(scope))
		if (scope == "read" || scope == "write") && !seen[scope] {
			seen[scope] = true
			out = append(out, scope)
		}
	}
	return out
}

func newPATSecret() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "pat_" + hex.EncodeToString(buf), nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
