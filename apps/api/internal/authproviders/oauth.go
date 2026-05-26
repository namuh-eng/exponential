package authproviders

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

var oauthScopes = map[string]bool{"read": true, "write": true, "issues:read": true, "issues:write": true, "comments:write": true, "webhooks:write": true}

type oauthWorkspace struct {
	ID       string
	Settings map[string]any
	API      map[string]any
	App      map[string]any
}

func (h Handler) AuthorizeOAuth(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	q := r.URL.Query()
	responseType := q.Get("response_type")
	clientID := strings.TrimSpace(q.Get("client_id"))
	redirectURI := q.Get("redirect_uri")
	state := q.Get("state")
	scopeParam := q.Get("scope")
	if responseType != "code" {
		oauthError(w, redirectURI, "unsupported_response_type", state)
		return
	}
	if clientID == "" || redirectURI == "" {
		problem.JSON(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	if hasUnsupportedOAuthScopesGo(scopeParam) {
		oauthError(w, redirectURI, "invalid_scope", state)
		return
	}
	found, err := h.findOAuthApplication(r, clientID)
	if err != nil {
		problem.Write(w, 500, "OAuth authorization failed", err.Error())
		return
	}
	if found.App == nil {
		problem.JSON(w, 400, map[string]string{"error": "invalid_client"})
		return
	}
	allowedRedirects := stringArray(firstNonNilOAuth(found.App["redirectUrls"], []any{found.App["redirectUrl"]}))
	if !containsOAuthString(allowedRedirects, redirectURI) {
		oauthError(w, redirectURI, "invalid_redirect_uri", state)
		return
	}
	allowedScopes := stringArray(firstNonNilOAuth(found.App["scopes"], []any{"read"}))
	requestedScopes := parseOAuthScopesGo(scopeParam)
	scopes := requestedScopes
	if len(scopes) == 0 {
		scopes = allowedScopes
	}
	for _, scope := range scopes {
		if !containsOAuthString(allowedScopes, scope) {
			oauthError(w, redirectURI, "invalid_scope", state)
			return
		}
	}
	code := "lincode_" + randomHexOAuth(24)
	now := time.Now().UTC()
	codes := mapSliceOAuth(found.API["oauthAuthorizationCodes"])
	codes = append([]any{map[string]any{"codeHash": hashOAuthSecret(code), "applicationId": asStringOAuth(found.App["id"]), "clientId": clientID, "workspaceId": found.ID, "userId": p.UserID, "redirectUri": redirectURI, "scopes": scopes, "createdAt": now.Format(time.RFC3339Nano), "expiresAt": now.Add(10 * time.Minute).Format(time.RFC3339Nano)}}, codes...)
	found.API["oauthAuthorizationCodes"] = codes
	found.Settings["api"] = found.API
	if err := h.saveOAuthWorkspace(r, found); err != nil {
		problem.Write(w, 500, "OAuth authorization failed", err.Error())
		return
	}
	_, _ = h.DB.Exec(r.Context(), `insert into authorized_application_grant (id,workspace_id,user_id,app_id,client_id,name,scopes) values ($1,$2::uuid,$3,$4,$5,$6,$7::jsonb) on conflict (user_id,app_id) do update set workspace_id=excluded.workspace_id, name=excluded.name, scopes=excluded.scopes, updated_at=now()`, "grant_"+randomHexOAuth(8), found.ID, p.UserID, asStringOAuth(found.App["id"]), clientID, asStringOAuth(found.App["name"]), mustJSON(scopes))
	callback, _ := url.Parse(redirectURI)
	values := callback.Query()
	values.Set("code", code)
	if state != "" {
		values.Set("state", state)
	}
	callback.RawQuery = values.Encode()
	http.Redirect(w, r, callback.String(), http.StatusTemporaryRedirect)
}

func (h Handler) ExchangeOAuthToken(w http.ResponseWriter, r *http.Request) {
	body := map[string]any{}
	if strings.Contains(r.Header.Get("content-type"), "application/json") {
		_ = json.NewDecoder(r.Body).Decode(&body)
	} else if err := r.ParseForm(); err == nil {
		for key, values := range r.PostForm {
			if len(values) > 0 {
				body[key] = values[0]
			}
		}
	}
	if body["grant_type"] != "authorization_code" {
		problem.JSON(w, 400, map[string]string{"error": "unsupported_grant_type"})
		return
	}
	code := asStringOAuth(body["code"])
	clientID := asStringOAuth(body["client_id"])
	clientSecret := asStringOAuth(body["client_secret"])
	redirectURI := asStringOAuth(body["redirect_uri"])
	if code == "" || clientID == "" || clientSecret == "" || redirectURI == "" {
		problem.JSON(w, 400, map[string]string{"error": "invalid_request"})
		return
	}
	found, codeRecord, err := h.findOAuthCode(r, hashOAuthSecret(code))
	if err != nil {
		problem.Write(w, 500, "OAuth token exchange failed", err.Error())
		return
	}
	if codeRecord == nil {
		problem.JSON(w, 400, map[string]string{"error": "invalid_grant"})
		return
	}
	app := findOAuthApp(found.API, clientID, asStringOAuth(codeRecord["applicationId"]))
	if app == nil || asStringOAuth(app["clientSecretHash"]) == "" || asStringOAuth(app["clientSecretHash"]) != hashOAuthSecret(clientSecret) {
		problem.JSON(w, 401, map[string]string{"error": "invalid_client"})
		return
	}
	expiresAt, _ := time.Parse(time.RFC3339Nano, asStringOAuth(codeRecord["expiresAt"]))
	if asStringOAuth(codeRecord["redirectUri"]) != redirectURI || expiresAt.Before(time.Now()) {
		problem.JSON(w, 400, map[string]string{"error": "invalid_grant"})
		return
	}
	accessToken := "lin_oauth_at_" + randomHexOAuth(24)
	refreshToken := "lin_oauth_rt_" + randomHexOAuth(24)
	now := time.Now().UTC()
	found.API["oauthAuthorizationCodes"] = filterOAuthCodes(found.API["oauthAuthorizationCodes"], hashOAuthSecret(code))
	found.API["oauthTokens"] = append([]any{map[string]any{"id": "tok_" + randomHexOAuth(8), "tokenHash": hashOAuthSecret(accessToken), "refreshTokenHash": hashOAuthSecret(refreshToken), "applicationId": asStringOAuth(app["id"]), "clientId": clientID, "workspaceId": found.ID, "userId": asStringOAuth(codeRecord["userId"]), "scopes": stringArray(codeRecord["scopes"]), "revokedAt": nil, "createdAt": now.Format(time.RFC3339Nano), "expiresAt": now.Add(time.Hour).Format(time.RFC3339Nano)}}, mapSliceOAuth(found.API["oauthTokens"])...)
	found.Settings["api"] = found.API
	if err := h.saveOAuthWorkspace(r, found); err != nil {
		problem.Write(w, 500, "OAuth token exchange failed", err.Error())
		return
	}
	problem.JSON(w, 200, map[string]any{"access_token": accessToken, "refresh_token": refreshToken, "token_type": "Bearer", "expires_in": 3600, "scope": strings.Join(stringArray(codeRecord["scopes"]), " ")})
}

func (h Handler) findOAuthApplication(r *http.Request, clientID string) (oauthWorkspace, error) {
	rows, err := h.DB.Query(r.Context(), `select id::text,coalesce(settings,'{}'::jsonb) from workspace`)
	if err != nil {
		return oauthWorkspace{}, err
	}
	defer rows.Close()
	for rows.Next() {
		ws, err := scanOAuthWorkspace(rows)
		if err != nil {
			return oauthWorkspace{}, err
		}
		for _, app := range mapSliceOAuth(ws.API["oauthApplications"]) {
			appMap := recordOAuth(app)
			if asStringOAuth(appMap["clientId"]) == clientID {
				ws.App = appMap
				return ws, nil
			}
		}
	}
	return oauthWorkspace{}, rows.Err()
}

func (h Handler) findOAuthCode(r *http.Request, codeHash string) (oauthWorkspace, map[string]any, error) {
	rows, err := h.DB.Query(r.Context(), `select id::text,coalesce(settings,'{}'::jsonb) from workspace`)
	if err != nil {
		return oauthWorkspace{}, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		ws, err := scanOAuthWorkspace(rows)
		if err != nil {
			return oauthWorkspace{}, nil, err
		}
		for _, code := range mapSliceOAuth(ws.API["oauthAuthorizationCodes"]) {
			codeMap := recordOAuth(code)
			if asStringOAuth(codeMap["codeHash"]) == codeHash {
				return ws, codeMap, nil
			}
		}
	}
	return oauthWorkspace{}, nil, rows.Err()
}

func scanOAuthWorkspace(rows pgx.Rows) (oauthWorkspace, error) {
	var ws oauthWorkspace
	var raw []byte
	if err := rows.Scan(&ws.ID, &raw); err != nil {
		return ws, err
	}
	ws.Settings = map[string]any{}
	_ = json.Unmarshal(raw, &ws.Settings)
	ws.API = recordOAuth(ws.Settings["api"])
	return ws, nil
}

func (h Handler) saveOAuthWorkspace(r *http.Request, ws oauthWorkspace) error {
	raw, _ := json.Marshal(ws.Settings)
	_, err := h.DB.Exec(r.Context(), `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, raw, ws.ID)
	return err
}

func oauthError(w http.ResponseWriter, redirectURI, errorName, state string) {
	if redirectURI == "" {
		problem.JSON(w, 400, map[string]string{"error": errorName})
		return
	}
	u, err := url.Parse(redirectURI)
	if err != nil {
		problem.JSON(w, 400, map[string]string{"error": errorName})
		return
	}
	q := u.Query()
	q.Set("error", errorName)
	if state != "" {
		q.Set("state", state)
	}
	u.RawQuery = q.Encode()
	w.Header().Set("Location", u.String())
	w.WriteHeader(http.StatusTemporaryRedirect)
}

func hashOAuthSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
func randomHexOAuth(size int) string {
	b := make([]byte, size)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
func mustJSON(value any) []byte { raw, _ := json.Marshal(value); return raw }
func recordOAuth(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}
func asStringOAuth(value any) string {
	if s, ok := value.(string); ok {
		return strings.TrimSpace(s)
	}
	return ""
}
func firstNonNilOAuth(values ...any) any {
	for _, v := range values {
		if v != nil {
			return v
		}
	}
	return nil
}
func containsOAuthString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func mapSliceOAuth(value any) []any {
	if v, ok := value.([]any); ok {
		return v
	}
	return []any{}
}

func stringArray(value any) []string {
	items, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]string); ok {
			return typed
		}
		return []string{}
	}
	out := []string{}
	for _, item := range items {
		if s := asStringOAuth(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func parseOAuthScopesGo(value string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, scope := range strings.FieldsFunc(value, func(r rune) bool { return r == ' ' || r == ',' || r == '\t' || r == '\n' }) {
		if oauthScopes[scope] && !seen[scope] {
			out = append(out, scope)
			seen[scope] = true
		}
	}
	return out
}

func hasUnsupportedOAuthScopesGo(value string) bool {
	for _, scope := range strings.FieldsFunc(value, func(r rune) bool { return r == ' ' || r == ',' || r == '\t' || r == '\n' }) {
		if !oauthScopes[scope] {
			return true
		}
	}
	return false
}

func findOAuthApp(api map[string]any, clientID, appID string) map[string]any {
	for _, app := range mapSliceOAuth(api["oauthApplications"]) {
		appMap := recordOAuth(app)
		if asStringOAuth(appMap["clientId"]) == clientID && asStringOAuth(appMap["id"]) == appID {
			return appMap
		}
	}
	return nil
}

func filterOAuthCodes(value any, codeHash string) []any {
	out := []any{}
	for _, item := range mapSliceOAuth(value) {
		if asStringOAuth(recordOAuth(item)["codeHash"]) != codeHash {
			out = append(out, item)
		}
	}
	return out
}
